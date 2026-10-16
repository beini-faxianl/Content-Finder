import { AhoCorasick } from './ahoCorasick';
import { decodeForMatching, mapToOriginal, type DecodeResult } from './decode';
import { foldCase, isWordChar, normalizeWidth } from './normalize';
import { compact, stripSeparators, supportsVariants, type StrippedText } from './separators';
import type {
  AnalysisResult,
  Category,
  DecodedCounts,
  Hit,
  HitEntry,
  KeywordLibrary,
  KeywordType,
  MatchOptions,
  OverlapStrategy,
  RuleError,
} from './types';

/** 单条正则最多保留的命中数，防止 `.` 之类的模式把页面拖垮 */
export const MAX_REGEX_MATCHES = 5000;

/** 变体写法最多被干扰字符撑开到关键词长度的几倍；更稀疏的不算，避免把不相干的字凑成命中 */
const MAX_VARIANT_SPREAD = 4;

interface CompiledRule {
  categoryId: string;
  keywordId: string;
  type: KeywordType;
  /** 全局顺序：分类顺序优先，其次关键词顺序。用于确定主分类 */
  order: number;
  needLeftBoundary: boolean;
  needRightBoundary: boolean;
  /** 是否参与变体写法识别（仅含中文的普通关键词） */
  variants: boolean;
  regex?: RegExp;
}

/**
 * 一组普通关键词的自动机。区分大小写与忽略大小写的关键词分属两组，
 * 分别在原样文本与小写折叠后的文本上查找（分类可以单独设置大小写）。
 */
interface PatternGroup {
  caseSensitive: boolean;
  automaton: AhoCorasick;
  /** 自动机模式下标 → 规则列表（同一个词可能出现在多个分类中） */
  patternRules: CompiledRule[][];
}

interface ExclusionGroup {
  caseSensitive: boolean;
  automaton: AhoCorasick;
  /** 例外词模式下标 → 使用该例外词的分类 id */
  categories: string[][];
}

export interface CompiledMatcher {
  readonly options: MatchOptions;
  readonly groups: PatternGroup[];
  readonly regexRules: CompiledRule[];
  readonly exclusionGroups: ExclusionGroup[];
  readonly errors: RuleError[];
  /** 实际参与匹配的规则数 */
  readonly ruleCount: number;
}

/** 分析过程中的回调，供 Web Worker 汇报进度（用于定位执行超时的正则） */
export interface AnalyzeHooks {
  onRegexRule?: (rule: { categoryId: string; keywordId: string }) => void;
}

/**
 * 尝试以 unicode 模式编译正则，失败再退回普通模式，兼容 `\-` 这类写法。
 * 始终开启多行模式：`^`、`$` 匹配每一行的行首、行尾。
 */
export function compileRegex(pattern: string, caseSensitive: boolean): RegExp {
  const flags = caseSensitive ? 'gm' : 'gim';
  try {
    return new RegExp(pattern, flags + 'u');
  } catch {
    return new RegExp(pattern, flags);
  }
}

/** 返回正则的错误信息；合法则返回 null */
export function validateRegex(pattern: string): string | null {
  if (!pattern.trim()) return '正则表达式不能为空';
  try {
    compileRegex(pattern, true);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** 分类的实际匹配选项：分类单独设置的优先，否则跟随全局 */
export function effectiveOptions(category: Pick<Category, 'wholeWord' | 'caseSensitive'>, options: MatchOptions) {
  return {
    wholeWord: category.wholeWord ?? options.wholeWord,
    caseSensitive: category.caseSensitive ?? options.caseSensitive,
  };
}

/** 一张「归一化词 → 规则」的表，最后编译成一台自动机 */
class Table<T> {
  readonly patterns: string[] = [];
  readonly values: T[][] = [];
  private readonly index = new Map<string, number>();

  add(pattern: string, value: T): void {
    let i = this.index.get(pattern);
    if (i === undefined) {
      i = this.patterns.length;
      this.patterns.push(pattern);
      this.values.push([]);
      this.index.set(pattern, i);
    }
    this.values[i].push(value);
  }
}

/** 把关键词库编译成匹配器。词库或选项变化时调用一次，之后可重复用于分析任意文本。 */
export function compileLibrary(library: KeywordLibrary, options: MatchOptions): CompiledMatcher {
  const normalizeTerm = (term: string, caseSensitive: boolean) => {
    const widthNormalized = options.normalizeWidth ? normalizeWidth(term) : term;
    return caseSensitive ? widthNormalized : foldCase(widthNormalized);
  };

  const keywordTables = { cs: new Table<CompiledRule>(), ci: new Table<CompiledRule>() };
  const exclusionTables = { cs: new Table<string>(), ci: new Table<string>() };
  const regexRules: CompiledRule[] = [];
  const errors: RuleError[] = [];
  let order = 0;
  let ruleCount = 0;

  for (const category of library.categories) {
    if (!category.enabled) continue;
    const { wholeWord, caseSensitive } = effectiveOptions(category, options);
    const keywordTable = caseSensitive ? keywordTables.cs : keywordTables.ci;
    const seen = new Set<string>();

    for (const keyword of category.keywords) {
      const term = keyword.type === 'regex' ? keyword.term : keyword.term.trim();
      if (!term) continue;
      const base = { categoryId: category.id, keywordId: keyword.id, type: keyword.type, order: order++ };

      if (keyword.type === 'regex') {
        try {
          regexRules.push({
            ...base,
            needLeftBoundary: false,
            needRightBoundary: false,
            variants: false,
            regex: compileRegex(term, caseSensitive),
          });
          ruleCount++;
        } catch (error) {
          errors.push({
            categoryId: category.id,
            keywordId: keyword.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }

      const normalized = normalizeTerm(term, caseSensitive);
      if (seen.has(normalized)) continue; // 同一分类内归一化后重复的词只算一次
      seen.add(normalized);
      keywordTable.add(normalized, {
        ...base,
        needLeftBoundary: wholeWord && isWordChar(normalized.charCodeAt(0)),
        needRightBoundary: wholeWord && isWordChar(normalized.charCodeAt(normalized.length - 1)),
        variants: supportsVariants(normalized),
      });
      ruleCount++;
    }

    const exclusionTable = caseSensitive ? exclusionTables.cs : exclusionTables.ci;
    for (const phrase of category.exclusions) {
      const normalized = normalizeTerm(phrase.trim(), caseSensitive);
      if (normalized) exclusionTable.add(normalized, category.id);
    }
  }

  const groups: PatternGroup[] = [];
  const exclusionGroups: ExclusionGroup[] = [];
  for (const caseSensitive of [false, true]) {
    const keywords = caseSensitive ? keywordTables.cs : keywordTables.ci;
    if (keywords.patterns.length) {
      groups.push({ caseSensitive, automaton: new AhoCorasick(keywords.patterns), patternRules: keywords.values });
    }
    const exclusions = caseSensitive ? exclusionTables.cs : exclusionTables.ci;
    if (exclusions.patterns.length) {
      exclusionGroups.push({
        caseSensitive,
        automaton: new AhoCorasick(exclusions.patterns),
        categories: exclusions.values.map((ids) => [...new Set(ids)]),
      });
    }
  }

  return { options, groups, regexRules, exclusionGroups, errors, ruleCount };
}

/**
 * 区间覆盖查询：给定一组例外词出现的区间，判断某个命中是否完整落在其中任意一个之内。
 * 按起点排序并记录前缀最远终点，单次查询为二分 O(log n)。
 */
class SpanCover {
  private readonly starts: number[] = [];
  private readonly maxEnds: number[] = [];

  constructor(spans: Array<[number, number]>) {
    spans.sort((a, b) => a[0] - b[0]);
    let maxEnd = -1;
    for (const [start, end] of spans) {
      maxEnd = Math.max(maxEnd, end);
      this.starts.push(start);
      this.maxEnds.push(maxEnd);
    }
  }

  covers(start: number, end: number): boolean {
    let lo = 0;
    let hi = this.starts.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.starts[mid] <= start) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found >= 0 && this.maxEnds[found] >= end;
  }
}

interface Candidate {
  start: number;
  end: number;
  rule: CompiledRule;
  /** 在去掉干扰字符的文本中找到（变体写法） */
  variant?: boolean;
}

/** 匹配所用的几种文本形态，均按需计算 */
class SearchTexts {
  private folded: string | undefined;
  private strippedText: StrippedText | null | undefined;
  private strippedFolded: string | undefined;
  constructor(readonly width: string) {}

  for(caseSensitive: boolean): string {
    if (caseSensitive) return this.width;
    this.folded ??= foldCase(this.width);
    return this.folded;
  }

  /** 去掉干扰字符后的文本；没有干扰字符时为 null */
  stripped(): StrippedText | null {
    if (this.strippedText === undefined) this.strippedText = stripSeparators(this.width);
    return this.strippedText;
  }

  /** 去掉干扰字符后的文本（按大小写分组）；须在 stripped() 非空时调用 */
  strippedFor(caseSensitive: boolean): string {
    const stripped = this.stripped()!;
    if (caseSensitive) return stripped.text;
    this.strippedFolded ??= foldCase(stripped.text);
    return this.strippedFolded;
  }
}

/**
 * 在去掉干扰字符的文本中查找，并把位置换算回原位置。
 * 中间没有干扰字符的匹配普通查找已经找到，跳过；被撑得过于稀疏的也跳过。
 */
function searchVariants(
  automaton: AhoCorasick,
  text: string,
  stripped: StrippedText,
  onMatch: (start: number, end: number, strippedStart: number, strippedEnd: number, pattern: number) => void,
): void {
  automaton.search(text, (s, e, pattern) => {
    const start = stripped.map[s];
    const end = stripped.map[e - 1] + 1;
    const length = e - s;
    if (end - start === length || end - start > length * MAX_VARIANT_SPREAD) return;
    onMatch(start, end, s, e, pattern);
  });
}

/** 去掉落在本分类例外词之内的候选命中，并按分类统计被排除的区间数 */
function applyExclusions(
  candidates: Candidate[],
  texts: SearchTexts,
  matcher: CompiledMatcher,
  excluded: Record<string, number>,
): Candidate[] {
  if (!matcher.exclusionGroups.length || !candidates.length) return candidates;

  const spansByCategory = new Map<string, Array<[number, number]>>();
  const record = (categories: string[], start: number, end: number) => {
    for (const categoryId of categories) {
      let spans = spansByCategory.get(categoryId);
      if (!spans) spansByCategory.set(categoryId, (spans = []));
      spans.push([start, end]);
    }
  };
  // 开启变体识别时，例外词同样能认出变体写法，「全 网 第 一 的补水神器」也会被「全网第一的补水神器」排除
  const stripped = matcher.options.ignoreSeparators ? texts.stripped() : null;
  for (const group of matcher.exclusionGroups) {
    group.automaton.search(texts.for(group.caseSensitive), (start, end, pattern) => record(group.categories[pattern], start, end));
    if (stripped) {
      searchVariants(group.automaton, texts.strippedFor(group.caseSensitive), stripped, (start, end, _s, _e, pattern) =>
        record(group.categories[pattern], start, end),
      );
    }
  }
  if (!spansByCategory.size) return candidates;

  const covers = new Map([...spansByCategory].map(([id, spans]) => [id, new SpanCover(spans)]));
  const excludedSpans = new Map<string, Set<string>>();
  const kept = candidates.filter((candidate) => {
    const categoryId = candidate.rule.categoryId;
    if (!covers.get(categoryId)?.covers(candidate.start, candidate.end)) return true;
    let spans = excludedSpans.get(categoryId);
    if (!spans) excludedSpans.set(categoryId, (spans = new Set()));
    spans.add(`${candidate.start}:${candidate.end}`);
    return false;
  });
  for (const [categoryId, spans] of excludedSpans) excluded[categoryId] = spans.size;
  return kept;
}

/**
 * 依次执行全局正则，跳过零长度匹配（如单独的 `x*`、`^`）。
 * @returns 是否因达到 limit 而提前停止
 */
function execAll(regex: RegExp, text: string, limit: number, onMatch: (start: number, end: number) => void): boolean {
  regex.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    onMatch(match.index, match.index + match[0].length);
    if (++count >= limit) return true;
  }
  return false;
}

/** 开启解码且确有内容被解码时返回解码结果，否则返回 null（按原文匹配） */
function decodeIfNeeded(text: string, decode: boolean): DecodeResult | null {
  if (!decode) return null;
  const result = decodeForMatching(text);
  return result.starts ? result : null;
}

const NO_DECODING: DecodedCounts = { url: 0, unicode: 0, html: 0 };

export interface RegexTestResult {
  matches: Array<{ start: number; end: number; text: string }>;
  error: string | null;
  /** 不影响运行、但可能与预期不符的提示 */
  warnings: string[];
  truncated: boolean;
}

/** 全角 ASCII 字符（！～）。开启全半角统一后，正文中的这些字符已转为半角 */
const FULL_WIDTH_ASCII = /[！-～]/g;

/**
 * 粗略检测「嵌套的不定量词」，如 (a+)+、(\w*)*、(?:x+)+：
 * 这类写法在遇到不匹配的长文本时可能产生指数级回溯。只做启发式提醒，不保证覆盖全部情况。
 */
export function hasNestedQuantifier(pattern: string): boolean {
  const groups: boolean[] = []; // 每一层分组内是否出现过不定量词
  let closedGroupUnbounded = false; // 刚闭合的分组是否含不定量词
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      closedGroupUnbounded = false;
      continue;
    }
    if (ch === '[') {
      for (i++; i < pattern.length && pattern[i] !== ']'; i++) if (pattern[i] === '\\') i++;
      closedGroupUnbounded = false;
      continue;
    }
    if (ch === '(') {
      groups.push(false);
      closedGroupUnbounded = false;
      continue;
    }
    if (ch === ')') {
      const inner = groups.pop() ?? false;
      if (inner && groups.length) groups[groups.length - 1] = true;
      closedGroupUnbounded = inner;
      continue;
    }
    const unbounded = ch === '*' || ch === '+' || (ch === '{' && /^\{\d*,\}/.test(pattern.slice(i, i + 12)));
    if (unbounded) {
      if (closedGroupUnbounded) return true;
      if (groups.length) groups[groups.length - 1] = true;
    }
    if (ch === '{') {
      const close = pattern.indexOf('}', i);
      if (close > i) i = close;
    }
    closedGroupUnbounded = false;
  }
  return false;
}

/**
 * 用与正式分析完全相同的规则（编译方式、标志、解码、全半角处理）试运行一条正则，
 * 供词库编辑与语法速查中的即时测试使用。返回的位置都对应原文。
 */
export function testRegex(
  pattern: string,
  text: string,
  options: Pick<MatchOptions, 'caseSensitive' | 'normalizeWidth' | 'decode'>,
  limit = MAX_REGEX_MATCHES,
): RegexTestResult {
  if (!pattern) return { matches: [], error: null, warnings: [], truncated: false };

  let regex: RegExp;
  try {
    regex = compileRegex(pattern, options.caseSensitive);
  } catch (error) {
    return { matches: [], error: error instanceof Error ? error.message : String(error), warnings: [], truncated: false };
  }

  const warnings: string[] = [];
  if (options.normalizeWidth) {
    // 同时写了全角与对应半角（如 [:：]）时无需提醒
    const orphans = [...new Set(pattern.match(FULL_WIDTH_ASCII) ?? [])].filter(
      (ch) => !pattern.includes(String.fromCharCode(ch.charCodeAt(0) - 0xfee0)),
    );
    if (orphans.length) {
      warnings.push(
        `表达式含全角字符「${orphans.join('')}」：已开启全半角统一，正文中的全角字符会先转为半角，请改用「${orphans
          .map((ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
          .join('')}」`,
      );
    }
  }
  regex.lastIndex = 0;
  if (regex.exec('')?.[0] === '') warnings.push('表达式可以匹配空字符串，空匹配不会被计为命中');
  if (hasNestedQuantifier(pattern)) {
    warnings.push('含嵌套的不定量词（如 (a+)+）：遇到不匹配的长文本时可能极慢，建议改写；超时的规则会被自动暂停');
  }

  const decoded = decodeIfNeeded(text, options.decode);
  const base = decoded ? decoded.text : text;
  const source = options.normalizeWidth ? normalizeWidth(base) : base;
  const matches: RegexTestResult['matches'] = [];
  const truncated = execAll(regex, source, limit, (start, end) => {
    const [s, e] = decoded ? mapToOriginal(decoded, start, end) : [start, end];
    matches.push({ start: s, end: e, text: text.slice(s, e) });
  });
  return { matches, error: null, warnings, truncated };
}

/** 在文本中查找所有命中 */
export function analyze(text: string, matcher: CompiledMatcher, hooks: AnalyzeHooks = {}): AnalysisResult {
  const startedAt = performance.now();
  const { options } = matcher;

  // 解码后的文本只用于匹配；最终命中会映射回原文的位置
  const decoded = decodeIfNeeded(text, options.decode);
  const source = decoded ? decoded.text : text;
  const texts = new SearchTexts(options.normalizeWidth ? normalizeWidth(source) : source);
  const candidates: Candidate[] = [];

  for (const group of matcher.groups) {
    const searchText = texts.for(group.caseSensitive);
    group.automaton.search(searchText, (start, end, pattern) => {
      for (const rule of group.patternRules[pattern]) {
        if (rule.needLeftBoundary && start > 0 && isWordChar(searchText.charCodeAt(start - 1))) continue;
        if (rule.needRightBoundary && end < searchText.length && isWordChar(searchText.charCodeAt(end))) continue;
        candidates.push({ start, end, rule });
      }
    });
  }

  // 变体写法：只对含中文的普通关键词，在去掉干扰字符的文本上再找一遍
  const stripped = options.ignoreSeparators ? texts.stripped() : null;
  if (stripped) {
    for (const group of matcher.groups) {
      const searchText = texts.strippedFor(group.caseSensitive);
      searchVariants(group.automaton, searchText, stripped, (start, end, s, e, pattern) => {
        for (const rule of group.patternRules[pattern]) {
          if (!rule.variants) continue;
          if (rule.needLeftBoundary && s > 0 && isWordChar(searchText.charCodeAt(s - 1))) continue;
          if (rule.needRightBoundary && e < searchText.length && isWordChar(searchText.charCodeAt(e))) continue;
          candidates.push({ start, end, rule, variant: true });
        }
      });
    }
  }

  let truncated = false;
  for (const rule of matcher.regexRules) {
    hooks.onRegexRule?.(rule);
    const hitLimit = execAll(rule.regex!, texts.width, MAX_REGEX_MATCHES, (start, end) => candidates.push({ start, end, rule }));
    if (hitLimit) truncated = true;
  }

  const excluded: Record<string, number> = {};
  const kept = applyExclusions(candidates, texts, matcher, excluded);
  const hits = resolveHits(kept, source, options.overlap);

  return {
    hits: decoded ? hits.map((hit) => toOriginal(hit, text, decoded)) : hits,
    elapsedMs: performance.now() - startedAt,
    truncated,
    excluded,
    decoded: decoded ? { ...decoded.counts } : NO_DECODING,
  };
}

/** 把解码文本中的命中换算回原文：位置与文本取原文，解码后的写法另存在 decoded 中 */
function toOriginal(hit: Hit, text: string, decoded: DecodeResult): Hit {
  const [start, end] = mapToOriginal(decoded, hit.start, hit.end);
  const original = text.slice(start, end);
  return original === hit.text ? { ...hit, start, end } : { ...hit, start, end, text: original, decoded: hit.text };
}

interface Span {
  start: number;
  end: number;
  rules: CompiledRule[];
  variant: boolean;
}

/** 合并相同区间的命中，并按重叠策略筛选 */
function resolveHits(candidates: Candidate[], text: string, strategy: OverlapStrategy): Hit[] {
  const bySpan = new Map<string, Span>();
  for (const candidate of candidates) {
    const key = `${candidate.start}:${candidate.end}`;
    const span = bySpan.get(key);
    if (span) {
      span.rules.push(candidate.rule);
      if (candidate.variant) span.variant = true;
    } else {
      bySpan.set(key, { start: candidate.start, end: candidate.end, rules: [candidate.rule], variant: !!candidate.variant });
    }
  }

  const spans = [...bySpan.values()];
  for (const span of spans) span.rules.sort((a, b) => a.order - b.order);
  spans.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start) || a.rules[0].order - b.rules[0].order,
  );

  const hits: Hit[] = [];
  let lastEnd = 0;
  for (const span of spans) {
    if (strategy === 'longest') {
      if (span.start < lastEnd) continue;
      lastEnd = span.end;
    }
    hits.push({
      id: hits.length,
      start: span.start,
      end: span.end,
      text: text.slice(span.start, span.end),
      entries: dedupeEntries(span.rules),
      ...(span.variant ? { variant: compact(text.slice(span.start, span.end)) } : {}),
    });
  }
  return hits;
}

function dedupeEntries(rules: CompiledRule[]): HitEntry[] {
  const seen = new Set<string>();
  const entries: HitEntry[] = [];
  for (const rule of rules) {
    const key = `${rule.categoryId}\u0000${rule.keywordId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ categoryId: rule.categoryId, keywordId: rule.keywordId });
  }
  return entries;
}

import { keywordKey, type LibraryIndex } from './library';
import { normalizeWidth } from './normalize';
import type { Hit, HitEntry, MatchOptions } from './types';

/** 一处计划中的替换 */
export interface Replacement {
  hitId: number;
  start: number;
  end: number;
  /** 替换后的文本 */
  text: string;
  categoryId: string;
  keywordId: string;
}

/**
 * 展开替换模板，规则与 String.prototype.replace 一致：
 * `$$` → `$`，`$&` → 命中原文，`$1`～`$99` → 分组，`$<名称>` → 命名分组；无法解析的写法原样保留。
 */
export function expandTemplate(
  template: string,
  match: string,
  groups: ReadonlyArray<string | undefined>,
  named?: Record<string, string | undefined>,
): string {
  return template.replace(/\$(\$|&|<([^>]*)>|\d{1,2})/g, (whole, token: string, name: string | undefined) => {
    if (token === '$') return '$';
    if (token === '&') return match;
    if (name !== undefined) return named ? (named[name] ?? '') : whole;
    const n = Number(token);
    if (n >= 1 && n <= groups.length) return groups[n - 1] ?? '';
    // `$12` 但只有 1 个分组时，按 `$1` + "2" 处理
    if (token.length === 2) {
      const one = Number(token[0]);
      if (one >= 1 && one <= groups.length) return (groups[one - 1] ?? '') + token[1];
    }
    return whole;
  });
}

const REFERENCES_GROUP = /\$(?:\d|<)/;

export interface Suggester {
  /** 按指定关键词给出这处命中的替换结果；该关键词没有替换建议时返回 null */
  suggest(hit: Hit, entry: HitEntry): string | null;
  /** 按分类优先级取第一个可用的替换建议 */
  first(hit: Hit, accept?: (entry: HitEntry) => boolean): { entry: HitEntry; text: string } | null;
}

/**
 * 创建替换建议计算器。正则关键词会在命中的原位置以粘连模式（y）重新匹配一次，
 * 借助 d 标志拿到各分组的位置，再从原文中截取——这样前后文断言依旧生效，全角字符也保持原样。
 */
export function createSuggester(
  text: string,
  index: LibraryIndex,
  options: Pick<MatchOptions, 'caseSensitive' | 'normalizeWidth'>,
): Suggester {
  let searchText: string | undefined;
  const regexCache = new Map<string, RegExp | null>();

  const stickyRegex = (pattern: string, caseSensitive: boolean): RegExp | null => {
    const cacheKey = `${caseSensitive ? 1 : 0}${pattern}`;
    if (!regexCache.has(cacheKey)) {
      const flags = (caseSensitive ? '' : 'i') + 'myd';
      let regex: RegExp | null = null;
      try {
        regex = new RegExp(pattern, flags + 'u');
      } catch {
        try {
          regex = new RegExp(pattern, flags);
        } catch {
          regex = null;
        }
      }
      regexCache.set(cacheKey, regex);
    }
    return regexCache.get(cacheKey)!;
  };

  const suggest = (hit: Hit, entry: HitEntry): string | null => {
    const ref = index.keywords.get(keywordKey(entry.categoryId, entry.keywordId));
    const template = ref?.keyword.replacement;
    if (!ref || template === undefined) return null;
    // 命中的原文是编码形式（%XX、\u 转义等）：直接替换会破坏原有编码，交给人工处理
    if (hit.decoded !== undefined) return null;
    if (ref.keyword.type !== 'regex') return expandTemplate(template, hit.text, []);

    const regex = stickyRegex(ref.keyword.term, ref.category.caseSensitive ?? options.caseSensitive);
    if (regex) {
      searchText ??= options.normalizeWidth ? normalizeWidth(text) : text;
      regex.lastIndex = hit.start;
      const match = regex.exec(searchText);
      if (match?.indices && match.index === hit.start) {
        const slice = (span: [number, number] | undefined) => (span ? text.slice(span[0], span[1]) : undefined);
        const groups = match.indices.slice(1).map(slice);
        const named = match.indices.groups
          ? Object.fromEntries(Object.entries(match.indices.groups).map(([name, span]) => [name, slice(span)]))
          : undefined;
        return expandTemplate(template, hit.text, groups, named);
      }
    }
    // 无法在原位置重新匹配（例如前后文经过解码）：模板不引用分组时仍可使用，否则宁可不给建议
    return REFERENCES_GROUP.test(template) ? null : expandTemplate(template, hit.text, []);
  };

  return {
    suggest,
    first(hit, accept) {
      for (const entry of hit.entries) {
        if (accept && !accept(entry)) continue;
        const text = suggest(hit, entry);
        if (text !== null) return { entry, text };
      }
      return null;
    },
  };
}

/**
 * 为一组命中生成替换计划：每处命中采用第一个有替换建议的关键词。
 * 与已计划的替换重叠的命中（「全部保留」重叠模式下的嵌套命中）以及替换前后相同的命中会被跳过。
 */
export function planReplacements(
  hits: readonly Hit[],
  suggester: Suggester,
  accept?: (hit: Hit, entry: HitEntry) => boolean,
): Replacement[] {
  const plan: Replacement[] = [];
  let lastEnd = -1;
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  for (const hit of sorted) {
    if (hit.start < lastEnd) continue;
    const found = suggester.first(hit, accept && ((entry) => accept(hit, entry)));
    if (!found || found.text === hit.text) continue;
    plan.push({
      hitId: hit.id,
      start: hit.start,
      end: hit.end,
      text: found.text,
      categoryId: found.entry.categoryId,
      keywordId: found.entry.keywordId,
    });
    lastEnd = hit.end;
  }
  return plan;
}

/** 按计划替换文本；plan 须按位置排序且互不重叠（planReplacements 的输出满足） */
export function applyReplacements(text: string, plan: readonly Replacement[]): string {
  let out = '';
  let last = 0;
  for (const r of plan) {
    out += text.slice(last, r.start) + r.text;
    last = r.end;
  }
  return out + text.slice(last);
}

/**
 * 新词发现：从文本中统计词库尚未覆盖的高频候选词。
 *
 * 中文没有空格分词，这里用 n-gram 频次 + 停用字过滤 + 子串归并的启发式方法：
 * 若短串几乎总是作为某个更长候选串的一部分出现（如「人工智」之于「人工智能」），则只保留长串。
 * 英文按单词统计并过滤常见停用词。结果仅供参考，用于快速扩充词库。
 */

export interface TermCandidate {
  term: string;
  count: number;
  kind: 'cjk' | 'latin';
}

export interface DiscoverOptions {
  /** 已在词库中的词（任意大小写），会被排除 */
  exclude?: Iterable<string>;
  minCount?: number;
  limit?: number;
  /** 最多分析的字符数，保证超长文本下依旧流畅 */
  maxChars?: number;
}

const CJK_RUN = /[㐀-䶿一-鿿豈-﫿]{2,}/g;
const LATIN_WORD = /[A-Za-z][A-Za-z0-9]*(?:[-+#][A-Za-z0-9+#]+)*/g;
/** 候选词不应以这些虚词开头或结尾 */
const EDGE_STOP = new Set('的了是在和与及或也都就而被把对从这那着过吗呢吧啊之其并但将于们我你他她它很让给为以有没不个'.split(''));
/** 候选词内部不应包含这些字（通常意味着跨越了词边界） */
const INNER_STOP = new Set('的了吗呢吧啊，。'.split(''));
const LATIN_STOP = new Set(
  `a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its
  just may me might more most my no not of on one or our out she should so some such than that the their them then there
  these they this those to too up us was we were what when where which while who why will with would you your also very`
    .split(/\s+/)
    .filter(Boolean),
);

const MIN_N = 2;
const MAX_N = 6;
const SUBSUME_RATIO = 0.8;

function isValidCjkGram(gram: string): boolean {
  if (EDGE_STOP.has(gram[0]) || EDGE_STOP.has(gram[gram.length - 1])) return false;
  for (const ch of gram) if (INNER_STOP.has(ch)) return false;
  return !/^(.)\1+$/.test(gram); // 排除「哈哈哈」这类叠字
}

function discoverCjk(text: string, minCount: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [run] of text.matchAll(CJK_RUN)) {
    for (let n = MIN_N; n <= MAX_N; n++) {
      for (let i = 0; i + n <= run.length; i++) {
        const gram = run.slice(i, i + n);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
  }

  const valid = new Map<string, number>();
  for (const [gram, count] of counts) if (count >= minCount && isValidCjkGram(gram)) valid.set(gram, count);

  // 若长串的频次接近其前缀/后缀子串，说明子串主要作为长串的一部分出现；逐级比较即可传递到更短的子串
  const subsumed = new Set<string>();
  for (const [gram, count] of valid) {
    if (gram.length <= MIN_N) continue;
    for (const sub of [gram.slice(0, -1), gram.slice(1)]) {
      const subCount = valid.get(sub);
      if (subCount !== undefined && count >= subCount * SUBSUME_RATIO) subsumed.add(sub);
    }
  }
  for (const gram of subsumed) valid.delete(gram);
  return valid;
}

function discoverLatin(text: string, minCount: number): Map<string, number> {
  const counts = new Map<string, { count: number; forms: Map<string, number> }>();
  for (const [word] of text.matchAll(LATIN_WORD)) {
    if (word.length < 2) continue;
    const key = word.toLowerCase();
    if (LATIN_STOP.has(key) || /^\d/.test(key)) continue;
    const entry = counts.get(key) ?? { count: 0, forms: new Map() };
    entry.count++;
    entry.forms.set(word, (entry.forms.get(word) ?? 0) + 1);
    counts.set(key, entry);
  }

  const result = new Map<string, number>();
  for (const { count, forms } of counts.values()) {
    if (count < minCount) continue;
    // 展示最常见的写法
    const display = [...forms].sort((a, b) => b[1] - a[1])[0][0];
    result.set(display, count);
  }
  return result;
}

export function discoverTerms(text: string, options: DiscoverOptions = {}): TermCandidate[] {
  const { minCount = 2, limit = 30, maxChars = 60_000 } = options;
  const sample = text.length > maxChars ? text.slice(0, maxChars) : text;
  const exclude = [...(options.exclude ?? [])].map((t) => t.trim().toLowerCase()).filter(Boolean);
  const excludeSet = new Set(exclude);
  const cjkExclude = exclude.filter((t) => t.length >= 2 && /[㐀-鿿]/.test(t));

  const candidates: TermCandidate[] = [];
  for (const [term, count] of discoverCjk(sample, minCount)) {
    if (excludeSet.has(term)) continue;
    // 与已有关键词互相包含的串视为已覆盖
    if (cjkExclude.some((k) => k.includes(term) || term.includes(k))) continue;
    candidates.push({ term, count, kind: 'cjk' });
  }
  for (const [term, count] of discoverLatin(sample, minCount)) {
    if (!excludeSet.has(term.toLowerCase())) candidates.push({ term, count, kind: 'latin' });
  }

  return candidates
    .sort((a, b) => b.count - a.count || b.term.length - a.term.length || a.term.localeCompare(b.term, 'zh-CN'))
    .slice(0, limit);
}

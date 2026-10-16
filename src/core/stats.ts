import { keywordKey, type LibraryIndex } from './library';
import { LEVEL_RANK, type Category, type Hit, type KeywordLibrary, type KeywordType, type Level } from './types';

export interface KeywordStat {
  key: string;
  categoryId: string;
  keywordId: string;
  term: string;
  type: KeywordType;
  count: number;
  hitIds: number[];
  /** 实际命中的不同写法（正则、大小写、全半角差异），最多保留若干个 */
  variants: string[];
}

export interface CategoryStat {
  category: Category;
  count: number;
  hitIds: number[];
  /** 按命中次数降序 */
  keywords: KeywordStat[];
}

/** 综合结论：无命中 / 正常 / 需关注 / 存在风险 */
export type Verdict = 'none' | 'normal' | 'attention' | 'risk';

export interface Summary {
  totalHits: number;
  uniqueKeywords: number;
  categoriesHit: number;
  enabledCategories: number;
  byLevel: Record<Level, number>;
  /** 非空白字符数（按码点计） */
  charCount: number;
  /** 每千字命中数 */
  density: number;
  verdict: Verdict;
}

export interface Stats {
  summary: Summary;
  /** 已启用的分类，保持词库顺序（包括零命中的分类） */
  categories: CategoryStat[];
  keywords: Map<string, KeywordStat>;
}

const MAX_VARIANTS = 6;

export function countChars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xdc00 && code <= 0xdfff) continue; // 低位代理，与前一个码元合为一个字符
    if (code === 0x20 || code === 0x3000 || (code >= 0x09 && code <= 0x0d) || code === 0xa0) continue;
    n++;
  }
  return n;
}

/** 一处命中的级别取其所有分类中最高的级别 */
export function hitLevel(hit: Hit, index: LibraryIndex): Level {
  let level: Level = 'info';
  for (const entry of hit.entries) {
    const l = index.categories.get(entry.categoryId)?.level ?? 'info';
    if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l;
  }
  return level;
}

export function computeStats(text: string, hits: Hit[], library: KeywordLibrary, index: LibraryIndex): Stats {
  const categoryStats = new Map<string, CategoryStat>();
  for (const category of library.categories) {
    if (category.enabled) categoryStats.set(category.id, { category, count: 0, hitIds: [], keywords: [] });
  }

  const keywords = new Map<string, KeywordStat>();
  const byLevel: Record<Level, number> = { info: 0, warning: 0, danger: 0 };

  for (const hit of hits) {
    byLevel[hitLevel(hit, index)]++;
    const countedCategories = new Set<string>();

    for (const entry of hit.entries) {
      const ref = index.keywords.get(keywordKey(entry.categoryId, entry.keywordId));
      const categoryStat = categoryStats.get(entry.categoryId);
      if (!ref || !categoryStat) continue;

      if (!countedCategories.has(entry.categoryId)) {
        countedCategories.add(entry.categoryId);
        categoryStat.count++;
        categoryStat.hitIds.push(hit.id);
      }

      const key = keywordKey(entry.categoryId, entry.keywordId);
      let stat = keywords.get(key);
      if (!stat) {
        stat = {
          key,
          categoryId: entry.categoryId,
          keywordId: entry.keywordId,
          term: ref.keyword.term,
          type: ref.keyword.type,
          count: 0,
          hitIds: [],
          variants: [],
        };
        keywords.set(key, stat);
        categoryStat.keywords.push(stat);
      }
      stat.count++;
      stat.hitIds.push(hit.id);
      // 经过解码的命中展示解码后的写法，比 %E6%89%8B 之类的原文更易读
      const shown = hit.decoded ?? hit.text;
      if (stat.variants.length < MAX_VARIANTS && !stat.variants.includes(shown)) stat.variants.push(shown);
    }
  }

  for (const stat of categoryStats.values()) {
    stat.keywords.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term, 'zh-CN'));
  }

  const charCount = countChars(text);
  const categories = [...categoryStats.values()];
  const verdict: Verdict =
    hits.length === 0 ? 'none' : byLevel.danger > 0 ? 'risk' : byLevel.warning > 0 ? 'attention' : 'normal';

  return {
    summary: {
      totalHits: hits.length,
      uniqueKeywords: keywords.size,
      categoriesHit: categories.filter((c) => c.count > 0).length,
      enabledCategories: categories.length,
      byLevel,
      charCount,
      density: charCount ? (hits.length / charCount) * 1000 : 0,
      verdict,
    },
    categories,
    keywords,
  };
}

export const VERDICT_TEXT: Record<Verdict, { label: string; detail: string }> = {
  none: { label: '未发现命中', detail: '当前内容没有命中任何已启用的关键词' },
  normal: { label: '内容正常', detail: '仅命中提示类关键词' },
  attention: { label: '需要关注', detail: '命中了需关注类关键词，建议复核' },
  risk: { label: '存在风险', detail: '命中了风险类关键词，建议逐条处理' },
};

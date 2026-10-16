import { addExclusions } from '../core/library';
import type { Keyword, KeywordLibrary } from '../core/types';
import { createPresetLibrary, PRESET_REVISION } from './presetLibrary';

/**
 * 修订 1 中各预置分类的关键词数量。之后追加的关键词（序号更大）视为新增内容，
 * 升级时补充给用户；序号更小却不在用户词库里的，说明是用户主动删除的，不会加回。
 */
const REVISION_1_KEYWORD_COUNT: Record<string, number> = {
  tech: 37,
  finance: 48,
  health: 37,
  region: 33,
  positive: 25,
  negative: 36,
  ad: 45,
  privacy: 11,
};

/** 在后续修订中改写过写法的预置关键词，旧写法视为「未被用户修改」 */
const LEGACY_TERMS: Record<string, string[]> = {
  'privacy-1': ['(?<!\\d)1[3-9]\\d{9}(?!\\d)'],
  'privacy-2': ['(?<!\\d)[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx](?!\\d)'],
  'privacy-3': ['[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'],
  'privacy-4': ['(?<!\\d)(?:62\\d{2}|4\\d{3}|5[1-5]\\d{2})(?:[ -]?\\d{4}){3}(?:\\d{1,3})?(?!\\d)'],
  'privacy-5': ['(?<![\\d.])(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?!\\.?\\d)'],
};

export interface UpgradeResult {
  library: KeywordLibrary;
  /** 是否实际补充了内容（用于提示用户） */
  changed: boolean;
}

const isAddedAfterRevision1 = (keywordId: string): boolean => {
  const match = /^(.+)-(\d+)$/.exec(keywordId);
  if (!match) return false;
  const count = REVISION_1_KEYWORD_COUNT[match[1]];
  return count !== undefined && Number(match[2]) > count;
};

/**
 * 把新版预置词库的改进合并进用户已保存的词库，不覆盖用户的修改：
 * - 预置分类（按 id 匹配）补充新的例外词，以及新版追加的预置关键词
 * - 用户没改动过的预置关键词，更新为新写法，并补充缺失的备注与替换建议
 * 用户删除的分类或关键词不会被加回；不是由预置词库而来的分类保持不变。
 */
export function upgradeLibrary(library: KeywordLibrary): UpgradeResult {
  if ((library.presetRevision ?? 1) >= PRESET_REVISION) return { library, changed: false };

  const presetCategories = new Map(createPresetLibrary().categories.map((c) => [c.id, c]));
  let changed = false;

  const categories = library.categories.map((category) => {
    const preset = presetCategories.get(category.id);
    if (!preset) return category;
    const presetKeywords = new Map(preset.keywords.map((k) => [k.id, k]));

    const keywords = category.keywords.map((keyword): Keyword => {
      const next = presetKeywords.get(keyword.id);
      if (!next || next.type !== keyword.type) return keyword;
      const untouched = keyword.term === next.term || (LEGACY_TERMS[keyword.id]?.includes(keyword.term) ?? false);
      if (!untouched) return keyword;
      const upgraded: Keyword = {
        ...keyword,
        term: next.term,
        ...(keyword.note === undefined && next.note !== undefined ? { note: next.note } : {}),
        ...(keyword.replacement === undefined && next.replacement !== undefined ? { replacement: next.replacement } : {}),
      };
      if (JSON.stringify(upgraded) !== JSON.stringify(keyword)) changed = true;
      return upgraded;
    });

    const ids = new Set(keywords.map((k) => k.id));
    const terms = new Set(keywords.map((k) => `${k.type}:${k.term.toLowerCase()}`));
    for (const keyword of preset.keywords) {
      if (ids.has(keyword.id) || terms.has(`${keyword.type}:${keyword.term.toLowerCase()}`)) continue;
      if (!isAddedAfterRevision1(keyword.id)) continue;
      keywords.push(keyword);
      changed = true;
    }

    const merged = addExclusions({ ...category, keywords }, preset.exclusions);
    if (merged.added.length) changed = true;
    return merged.category;
  });

  return { library: { ...library, presetRevision: PRESET_REVISION, categories }, changed };
}

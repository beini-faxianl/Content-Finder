import { parseCsv } from './csv';
import { validateRegex } from './matcher';
import type { Category, Keyword, KeywordLibrary, KeywordType, Level } from './types';

/** 新建分类时依次取用的颜色，在浅色与深色背景上都清晰可辨 */
export const CATEGORY_PALETTE = [
  '#3b82f6',
  '#0d9488',
  '#8b5cf6',
  '#d97706',
  '#16a34a',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#7c3aed',
  '#475569',
];

const LEVELS: Level[] = ['info', 'warning', 'danger'];

let idCounter = 0;
export function uid(prefix = 'id'): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const keywordKey = (categoryId: string, keywordId: string) => `${categoryId}::${keywordId}`;

export interface KeywordRef {
  category: Category;
  keyword: Keyword;
}

export interface LibraryIndex {
  categories: Map<string, Category>;
  categoryOrder: Map<string, number>;
  keywords: Map<string, KeywordRef>;
}

export function indexLibrary(library: KeywordLibrary): LibraryIndex {
  const categories = new Map<string, Category>();
  const categoryOrder = new Map<string, number>();
  const keywords = new Map<string, KeywordRef>();
  library.categories.forEach((category, i) => {
    categories.set(category.id, category);
    categoryOrder.set(category.id, i);
    for (const keyword of category.keywords) keywords.set(keywordKey(category.id, keyword.id), { category, keyword });
  });
  return { categories, categoryOrder, keywords };
}

/** 关键词的展示名：正则的原始表达式不易读，有备注时优先展示备注 */
export function keywordLabel(keyword: Pick<Keyword, 'term' | 'type' | 'note'>): string {
  return keyword.type === 'regex' && keyword.note ? keyword.note : keyword.term;
}

export function countKeywords(library: KeywordLibrary, onlyEnabled = false): number {
  return library.categories.reduce((n, c) => n + (onlyEnabled && !c.enabled ? 0 : c.keywords.length), 0);
}

export function countExclusions(library: KeywordLibrary): number {
  return library.categories.reduce((n, c) => n + c.exclusions.length, 0);
}

const termKey = (type: KeywordType, term: string) => `${type}:${type === 'text' ? term.toLowerCase() : term}`;

/**
 * 把用户输入拆成多个关键词。
 * 普通词支持换行、逗号、顿号、分号分隔；正则可能本身含逗号，只按换行拆分。
 */
export function splitKeywordInput(input: string, type: KeywordType): string[] {
  const parts = type === 'regex' ? input.split(/\r?\n/) : input.split(/[\r\n\t,，、;；]+/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const term = part.trim();
    if (!term || seen.has(termKey(type, term))) continue;
    seen.add(termKey(type, term));
    result.push(term);
  }
  return result;
}

export interface AddKeywordsResult {
  category: Category;
  added: Keyword[];
  duplicates: string[];
  invalid: Array<{ term: string; message: string }>;
}

/** 向分类追加关键词（不可变更新），自动跳过重复项与非法正则；extra 中的备注与替换建议会附加到每个新词上 */
export function addKeywords(
  category: Category,
  terms: string[],
  type: KeywordType,
  extra: Pick<Keyword, 'note' | 'replacement'> = {},
): AddKeywordsResult {
  const existing = new Set(category.keywords.map((k) => termKey(k.type, k.term)));
  const added: Keyword[] = [];
  const duplicates: string[] = [];
  const invalid: AddKeywordsResult['invalid'] = [];

  for (const term of terms) {
    const key = termKey(type, term);
    if (existing.has(key)) {
      duplicates.push(term);
      continue;
    }
    if (type === 'regex') {
      const message = validateRegex(term);
      if (message) {
        invalid.push({ term, message });
        continue;
      }
    }
    existing.add(key);
    added.push({
      id: uid('kw'),
      term,
      type,
      ...(extra.note ? { note: extra.note } : {}),
      ...(extra.replacement ? { replacement: extra.replacement } : {}),
    });
  }

  return {
    category: added.length ? { ...category, keywords: [...category.keywords, ...added] } : category,
    added,
    duplicates,
    invalid,
  };
}

export interface AddExclusionsResult {
  category: Category;
  added: string[];
  duplicates: string[];
}

/** 忽略大小写、去掉首尾空白后，把 terms 中尚未出现在 existing 里的短语挑出来 */
function appendUnique(existing: readonly string[], terms: readonly string[]): { added: string[]; duplicates: string[] } {
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const added: string[] = [];
  const duplicates: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    if (seen.has(term.toLowerCase())) {
      duplicates.push(term);
      continue;
    }
    seen.add(term.toLowerCase());
    added.push(term);
  }
  return { added, duplicates };
}

/** 向分类追加例外词（不可变更新），忽略大小写去重 */
export function addExclusions(category: Category, terms: string[]): AddExclusionsResult {
  const { added, duplicates } = appendUnique(category.exclusions, terms);
  return {
    category: added.length ? { ...category, exclusions: [...category.exclusions, ...added] } : category,
    added,
    duplicates,
  };
}

export function nextColor(library: KeywordLibrary): string {
  const used = new Set(library.categories.map((c) => c.color.toLowerCase()));
  return CATEGORY_PALETTE.find((c) => !used.has(c)) ?? CATEGORY_PALETTE[library.categories.length % CATEGORY_PALETTE.length];
}

export function createCategory(library: KeywordLibrary, name: string, patch: Partial<Category> = {}): Category {
  return {
    id: uid('cat'),
    name,
    color: nextColor(library),
    level: 'info',
    description: '',
    enabled: true,
    keywords: [],
    exclusions: [],
    ...patch,
  };
}

export class LibraryFormatError extends Error {
  override name = 'LibraryFormatError';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/**
 * 校验并规范化外部导入的词库。支持三种格式：
 * 1. 完整格式 `{ version: 1, categories: [...] }`
 * 2. 分类数组 `[{ name, keywords: [...] }]`
 * 3. 简写映射 `{ "分类名": ["词1", "词2"] }`
 */
export function validateLibrary(raw: unknown): KeywordLibrary {
  let rawCategories: unknown[];
  if (Array.isArray(raw)) {
    rawCategories = raw;
  } else if (isRecord(raw) && Array.isArray(raw.categories)) {
    rawCategories = raw.categories;
  } else if (isRecord(raw) && Object.keys(raw).length > 0 && Object.values(raw).every(Array.isArray)) {
    rawCategories = Object.entries(raw).map(([name, keywords]) => ({ name, keywords }));
  } else {
    throw new LibraryFormatError('无法识别的词库格式：需要包含 categories 数组的对象');
  }

  const presetRevision = isRecord(raw) && typeof raw.presetRevision === 'number' ? raw.presetRevision : undefined;
  const library: KeywordLibrary = { version: 1, ...(presetRevision !== undefined ? { presetRevision } : {}), categories: [] };
  const categoryIds = new Set<string>();

  rawCategories.forEach((rawCategory, ci) => {
    if (!isRecord(rawCategory)) throw new LibraryFormatError(`第 ${ci + 1} 个分类格式错误`);
    const name = typeof rawCategory.name === 'string' ? rawCategory.name.trim() : '';
    if (!name) throw new LibraryFormatError(`第 ${ci + 1} 个分类缺少名称`);

    let id = typeof rawCategory.id === 'string' && rawCategory.id ? rawCategory.id : uid('cat');
    if (categoryIds.has(id)) id = uid('cat');
    categoryIds.add(id);

    const rawKeywords = Array.isArray(rawCategory.keywords) ? rawCategory.keywords : [];
    const keywordIds = new Set<string>();
    const seenTerms = new Set<string>();
    const keywords: Keyword[] = [];

    for (const rawKeyword of rawKeywords) {
      const kw = typeof rawKeyword === 'string' ? { term: rawKeyword } : rawKeyword;
      if (!isRecord(kw) || typeof kw.term !== 'string' || !kw.term.trim()) continue;
      const type: KeywordType = kw.type === 'regex' ? 'regex' : 'text';
      const term = type === 'regex' ? kw.term : kw.term.trim();
      if (seenTerms.has(termKey(type, term))) continue;
      seenTerms.add(termKey(type, term));

      let kwId = typeof kw.id === 'string' && kw.id ? kw.id : uid('kw');
      if (keywordIds.has(kwId)) kwId = uid('kw');
      keywordIds.add(kwId);

      const note = typeof kw.note === 'string' && kw.note.trim() ? kw.note.trim() : undefined;
      // 替换内容保留原样（空格也可能是有意的），只排除空串
      const replacement = typeof kw.replacement === 'string' && kw.replacement !== '' ? kw.replacement : undefined;
      keywords.push({ id: kwId, term, type, ...(note ? { note } : {}), ...(replacement !== undefined ? { replacement } : {}) });
    }

    const rawExclusions = Array.isArray(rawCategory.exclusions) ? rawCategory.exclusions : [];
    const exclusions = appendUnique([], rawExclusions.filter((t): t is string => typeof t === 'string')).added;

    library.categories.push({
      id,
      name,
      color: isHexColor(rawCategory.color) ? rawCategory.color.toLowerCase() : CATEGORY_PALETTE[ci % CATEGORY_PALETTE.length],
      level: LEVELS.includes(rawCategory.level as Level) ? (rawCategory.level as Level) : 'info',
      description: typeof rawCategory.description === 'string' ? rawCategory.description : '',
      enabled: rawCategory.enabled !== false,
      keywords,
      exclusions,
      ...(typeof rawCategory.wholeWord === 'boolean' ? { wholeWord: rawCategory.wholeWord } : {}),
      ...(typeof rawCategory.caseSensitive === 'boolean' ? { caseSensitive: rawCategory.caseSensitive } : {}),
    });
  });

  return library;
}

export interface MergeResult {
  library: KeywordLibrary;
  addedCategories: number;
  addedKeywords: number;
  addedExclusions: number;
}

/** 合并词库：同名分类合并关键词与例外词（去重），新分类追加到末尾 */
export function mergeLibraries(base: KeywordLibrary, incoming: KeywordLibrary): MergeResult {
  const categories = base.categories.map((c) => ({ ...c, keywords: [...c.keywords], exclusions: [...c.exclusions] }));
  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  const usedIds = new Set(categories.map((c) => c.id));
  let addedCategories = 0;
  let addedKeywords = 0;
  let addedExclusions = 0;

  for (const category of incoming.categories) {
    const target = byName.get(category.name.trim().toLowerCase());
    if (!target) {
      const id = usedIds.has(category.id) ? uid('cat') : category.id;
      usedIds.add(id);
      const copy = { ...category, id, keywords: [...category.keywords], exclusions: [...category.exclusions] };
      categories.push(copy);
      byName.set(category.name.trim().toLowerCase(), copy);
      addedCategories++;
      addedKeywords += category.keywords.length;
      addedExclusions += category.exclusions.length;
      continue;
    }
    const merged = addExclusions(target, category.exclusions);
    target.exclusions = merged.category.exclusions;
    addedExclusions += merged.added.length;
    const existing = new Set(target.keywords.map((k) => termKey(k.type, k.term)));
    for (const keyword of category.keywords) {
      if (existing.has(termKey(keyword.type, keyword.term))) continue;
      existing.add(termKey(keyword.type, keyword.term));
      target.keywords.push({ ...keyword, id: uid('kw') });
      addedKeywords++;
    }
  }

  return {
    library: { ...base, version: 1, categories },
    addedCategories,
    addedKeywords,
    addedExclusions,
  };
}

const CSV_HEADERS = new Set(['分类', '类别', 'category']);

const CSV_TYPE_REGEX = new Set(['正则', 'regex', 're']);
const CSV_TYPE_EXCLUSION = new Set(['例外', '例外词', 'exclusion', 'exclude']);

/**
 * 解析 CSV 词库：`分类,关键词[,类型][,备注][,替换为]`，首行表头可选。
 * 类型可为「文本」（默认）、「正则」或「例外」（例外词只需填前两列）。
 */
export function parseLibraryCsv(text: string): KeywordLibrary {
  const rows = parseCsv(text);
  if (rows.length && CSV_HEADERS.has(rows[0][0]?.trim().toLowerCase() ?? '')) rows.shift();
  if (!rows.length) throw new LibraryFormatError('CSV 中没有可导入的数据');

  const grouped = new Map<string, { keywords: Array<Partial<Keyword>>; exclusions: string[] }>();
  for (const [name = '', term = '', type = '', note = '', replacement = ''] of rows) {
    if (!name.trim() || !term.trim()) continue;
    const group = grouped.get(name.trim()) ?? { keywords: [], exclusions: [] };
    const kind = type.trim().toLowerCase();
    if (CSV_TYPE_EXCLUSION.has(kind)) {
      group.exclusions.push(term);
    } else {
      group.keywords.push({
        term,
        type: CSV_TYPE_REGEX.has(kind) ? 'regex' : 'text',
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(replacement ? { replacement } : {}),
      });
    }
    grouped.set(name.trim(), group);
  }
  if (!grouped.size) throw new LibraryFormatError('CSV 每行至少需要"分类"和"关键词"两列');

  return validateLibrary([...grouped].map(([name, group]) => ({ name, ...group })));
}

export function libraryToCsvRows(library: KeywordLibrary): string[][] {
  const rows = [['分类', '关键词', '类型', '备注', '替换为']];
  for (const category of library.categories) {
    for (const keyword of category.keywords) {
      rows.push([
        category.name,
        keyword.term,
        keyword.type === 'regex' ? '正则' : '文本',
        keyword.note ?? '',
        keyword.replacement ?? '',
      ]);
    }
    for (const exclusion of category.exclusions) rows.push([category.name, exclusion, '例外', '', '']);
  }
  return rows;
}

import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';
import {
  addExclusions,
  addKeywords,
  createCategory,
  indexLibrary,
  keywordKey,
  LibraryFormatError,
  libraryToCsvRows,
  mergeLibraries,
  parseLibraryCsv,
  splitKeywordInput,
  validateLibrary,
} from './library';
import { makeLibrary } from './testUtils';

describe('splitKeywordInput', () => {
  it('splits plain keywords by common Chinese and English separators', () => {
    expect(splitKeywordInput('芯片，算力、GPU;  CPU\n\n芯片\tAI', 'text')).toEqual(['芯片', '算力', 'GPU', 'CPU', 'AI']);
  });

  it('only splits regex by line because patterns may contain commas', () => {
    expect(splitKeywordInput('\\d{3,4}\n[a,b]', 'regex')).toEqual(['\\d{3,4}', '[a,b]']);
  });
});

describe('addKeywords', () => {
  const base = makeLibrary({ t: ['AI'] }).categories[0];

  it('adds new terms immutably and reports duplicates case-insensitively', () => {
    const result = addKeywords(base, ['ai', '芯片'], 'text');
    expect(result.added.map((k) => k.term)).toEqual(['芯片']);
    expect(result.duplicates).toEqual(['ai']);
    expect(result.category.keywords).toHaveLength(2);
    expect(base.keywords).toHaveLength(1);
  });

  it('rejects invalid regex', () => {
    const result = addKeywords(base, ['(oops', '\\d+'], 'regex');
    expect(result.invalid.map((i) => i.term)).toEqual(['(oops']);
    expect(result.added.map((k) => k.type)).toEqual(['regex']);
  });

  it('returns the same object when nothing was added', () => {
    expect(addKeywords(base, ['AI'], 'text').category).toBe(base);
  });
});

describe('validateLibrary', () => {
  it('accepts the full format and fills defaults', () => {
    const lib = validateLibrary({
      version: 1,
      categories: [{ name: ' 科技 ', color: 'red', level: 'nope', keywords: ['AI', { term: '\\d+', type: 'regex', note: ' n ' }, '', 'AI'] }],
    });
    const [c] = lib.categories;
    expect(c.name).toBe('科技');
    expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.level).toBe('info');
    expect(c.enabled).toBe(true);
    expect(c.keywords.map((k) => [k.term, k.type, k.note])).toEqual([
      ['AI', 'text', undefined],
      ['\\d+', 'regex', 'n'],
    ]);
  });

  it('accepts a bare category array and a shorthand name → terms map', () => {
    expect(validateLibrary([{ name: 'A', keywords: ['x'] }]).categories[0].keywords[0].term).toBe('x');
    const lib = validateLibrary({ 科技: ['AI', '芯片'], 地区: ['北京'] });
    expect(lib.categories.map((c) => [c.name, c.keywords.length])).toEqual([
      ['科技', 2],
      ['地区', 1],
    ]);
  });

  it('regenerates duplicate ids', () => {
    const lib = validateLibrary([
      { id: 'same', name: 'A', keywords: [{ id: 'k', term: 'a' }, { id: 'k', term: 'b' }] },
      { id: 'same', name: 'B' },
    ]);
    expect(new Set(lib.categories.map((c) => c.id)).size).toBe(2);
    expect(new Set(lib.categories[0].keywords.map((k) => k.id)).size).toBe(2);
  });

  it('throws a readable error on garbage', () => {
    expect(() => validateLibrary('hello')).toThrow(LibraryFormatError);
    expect(() => validateLibrary({ categories: [{ keywords: [] }] })).toThrow(/缺少名称/);
  });
});

describe('mergeLibraries', () => {
  it('merges same-name categories and appends new ones', () => {
    const base = makeLibrary({ 科技: ['AI'] });
    const incoming = makeLibrary({ 科技: ['ai', '芯片'], 地区: ['北京'] });
    const { library, addedCategories, addedKeywords } = mergeLibraries(base, incoming);
    expect(addedCategories).toBe(1);
    expect(addedKeywords).toBe(2);
    expect(library.categories.map((c) => c.keywords.map((k) => k.term))).toEqual([['AI', '芯片'], ['北京']]);
    expect(base.categories[0].keywords).toHaveLength(1);
  });
});

describe('CSV import/export', () => {
  it('parses quoted fields, escaped quotes and embedded newlines', () => {
    expect(parseCsv('\ufeffa,"b,c","say ""hi""","x\ny"\r\n\r\n1,2')).toEqual([
      ['a', 'b,c', 'say "hi"', 'x\ny'],
      ['1', '2'],
    ]);
  });

  it('round-trips a library through CSV', () => {
    const library = makeLibrary({ 科技: ['AI', 're:\\d{3,4}'], 地区: ['北京'] });
    library.categories[0].keywords[0].note = '缩写, 常见';
    const restored = parseLibraryCsv(toCsv(libraryToCsvRows(library)));
    expect(restored.categories.map((c) => c.name)).toEqual(['科技', '地区']);
    expect(restored.categories[0].keywords.map((k) => [k.term, k.type, k.note])).toEqual([
      ['AI', 'text', '缩写, 常见'],
      ['\\d{3,4}', 'regex', undefined],
    ]);
  });

  it('works without header row and rejects empty input', () => {
    expect(parseLibraryCsv('科技,AI').categories[0].keywords[0].term).toBe('AI');
    expect(() => parseLibraryCsv('分类,关键词')).toThrow(LibraryFormatError);
  });
});

describe('exclusions and replacements', () => {
  it('adds exclusions immutably, deduping case-insensitively', () => {
    const base = makeLibrary({ ad: { terms: ['最佳'], exclusions: ['最佳实践'] } }).categories[0];
    const result = addExclusions(base, ['最佳实践', ' 首选项 ', '', 'Best Practice', 'best practice']);
    expect(result.added).toEqual(['首选项', 'Best Practice']);
    expect(result.duplicates).toEqual(['最佳实践', 'best practice']);
    expect(result.category.exclusions).toEqual(['最佳实践', '首选项', 'Best Practice']);
    expect(base.exclusions).toEqual(['最佳实践']);
  });

  it('validates exclusions, replacements and preset revision', () => {
    const lib = validateLibrary({
      presetRevision: 2,
      categories: [
        {
          name: 'A',
          exclusions: ['甲乙', 3, '甲乙', ' '],
          keywords: [{ term: '甲', replacement: ' 丙 ' }, { term: '乙', replacement: '' }],
        },
      ],
    });
    expect(lib.presetRevision).toBe(2);
    expect(lib.categories[0].exclusions).toEqual(['甲乙']);
    expect(lib.categories[0].keywords.map((k) => k.replacement)).toEqual([' 丙 ', undefined]);
    expect(validateLibrary([{ name: 'B' }]).categories[0].exclusions).toEqual([]);
  });

  it('merges exclusions of same-name categories', () => {
    const base = makeLibrary({ ad: { terms: ['最佳'], exclusions: ['最佳实践'] } });
    const incoming = makeLibrary({ ad: { terms: [], exclusions: ['最佳实践', '首选项'] } });
    const result = mergeLibraries(base, incoming);
    expect(result.addedExclusions).toBe(1);
    expect(result.library.categories[0].exclusions).toEqual(['最佳实践', '首选项']);
  });

  it('round-trips exclusions and replacements through CSV', () => {
    const library = makeLibrary({ 广告: { terms: ['最好 => 优质', 're:(\\d)元 => $1 元'], exclusions: ['最好是'] } });
    const restored = parseLibraryCsv(toCsv(libraryToCsvRows(library)));
    const [category] = restored.categories;
    expect(category.keywords.map((k) => [k.term, k.type, k.replacement])).toEqual([
      ['最好', 'text', '优质'],
      ['(\\d)元', 'regex', '$1 元'],
    ]);
    expect(category.exclusions).toEqual(['最好是']);
  });
});

describe('indexLibrary / createCategory', () => {
  it('indexes keywords by composite key and picks an unused color', () => {
    const library = makeLibrary({ a: ['x'] });
    const index = indexLibrary(library);
    expect(index.keywords.get(keywordKey('a', 'a0'))?.keyword.term).toBe('x');
    expect(createCategory(library, '新分类').color).not.toBe(library.categories[0].color);
  });
});

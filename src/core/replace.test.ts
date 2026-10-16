import { describe, expect, it } from 'vitest';
import { createPresetLibrary } from '../data/presetLibrary';
import { indexLibrary } from './library';
import { analyze, compileLibrary } from './matcher';
import { applyReplacements, createSuggester, expandTemplate, planReplacements } from './replace';
import { makeLibrary } from './testUtils';
import { DEFAULT_MATCH_OPTIONS, type KeywordLibrary, type MatchOptions } from './types';

function fix(library: KeywordLibrary, text: string, options: MatchOptions = DEFAULT_MATCH_OPTIONS) {
  const { hits } = analyze(text, compileLibrary(library, options));
  const suggester = createSuggester(text, indexLibrary(library), options);
  const plan = planReplacements(hits, suggester);
  return { plan, text: applyReplacements(text, plan) };
}

describe('expandTemplate', () => {
  it('follows String.prototype.replace substitution rules', () => {
    expect(expandTemplate('[$&]', 'abc', [])).toBe('[abc]');
    expect(expandTemplate('$2-$1', 'x', ['a', 'b'])).toBe('b-a');
    expect(expandTemplate('$$1', 'x', ['a'])).toBe('$1');
    expect(expandTemplate('$12', 'x', ['a'])).toBe('a2');
    expect(expandTemplate('$3 $0', 'x', ['a'])).toBe('$3 $0');
    expect(expandTemplate('$<n>!', 'x', [], { n: 'v' })).toBe('v!');
    expect(expandTemplate('$<n>', 'x', [])).toBe('$<n>');
    expect(expandTemplate('$1', 'x', [undefined])).toBe('');
  });
});

describe('replacement planning', () => {
  it('replaces text keywords and leaves keywords without suggestions alone', () => {
    const library = makeLibrary({ ad: ['最好 => 优质', '第一'] });
    expect(fix(library, '最好的产品，行业第一').text).toBe('优质的产品，行业第一');
  });

  it('expands regex groups from the original text, keeping look-behind context', () => {
    const library = makeLibrary({ price: ['re:(?<=¥)(\\d+) => [$1]'] });
    expect(fix(library, '价格¥199，原价$299').text).toBe('价格¥[199]，原价$299');
  });

  it('keeps full-width characters intact when masking', () => {
    const library = makeLibrary({ pii: ['re:(?<!\\d)(1[3-9]\\d)\\d{4}(\\d{4})(?!\\d) => $1****$2'] });
    expect(fix(library, '电话１３８００１３８０００').text).toBe('电话１３８****８０００');
  });

  it('respects the accept filter and skips no-op replacements', () => {
    const library = makeLibrary({ a: ['甲 => 乙'], b: ['丙 => 丙'] });
    const text = '甲丙甲';
    const { hits } = analyze(text, compileLibrary(library, DEFAULT_MATCH_OPTIONS));
    const suggester = createSuggester(text, indexLibrary(library), DEFAULT_MATCH_OPTIONS);
    expect(planReplacements(hits, suggester).map((r) => r.start)).toEqual([0, 2]);
    expect(planReplacements(hits, suggester, (hit) => hit.start === 2).map((r) => r.start)).toEqual([2]);
  });

  it('never applies overlapping replacements (overlap = all)', () => {
    const library = makeLibrary({ t: ['人工智能 => AI', '智能 => 聪明'] });
    const result = fix(library, '人工智能', { ...DEFAULT_MATCH_OPTIONS, overlap: 'all' });
    expect(result.plan).toHaveLength(1);
    expect(result.text).toBe('AI');
  });

  it('uses the first category that has a suggestion', () => {
    const library = makeLibrary({ a: ['焦虑'], b: ['焦虑 => 担忧'] });
    expect(fix(library, '很焦虑').text).toBe('很担忧');
  });
});

describe('preset suggestions', () => {
  const preset = createPresetLibrary();

  it('masks personal information', () => {
    const text = '电话 13912345678，邮箱 zhangsan@example.com，身份证 11010519491231002X，卡号 6222 0212 3456 7890，IP 192.168.1.100';
    expect(fix(preset, text).text).toBe(
      '电话 139****5678，邮箱 z***@example.com，身份证 110105********002X，卡号 **** **** **** 7890，IP 192.168.*.*',
    );
  });

  it('rewrites absolute advertising claims and leaves medical claims for manual review', () => {
    expect(fix(preset, '全网第一的最好产品，立即见效').text).toBe('广受好评的优质产品，立即见效');
  });

  it('produces text that no longer triggers the replaced rules', () => {
    const { text } = fix(preset, '手机 13800138000 是最好的选择');
    const again = analyze(text, compileLibrary(preset, DEFAULT_MATCH_OPTIONS)).hits;
    expect(again.filter((h) => h.entries.some((e) => e.categoryId === 'privacy' || e.categoryId === 'ad'))).toEqual([]);
  });
});

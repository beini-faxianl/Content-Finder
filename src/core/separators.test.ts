import { describe, expect, it } from 'vitest';
import { createPresetLibrary } from '../data/presetLibrary';
import { indexLibrary } from './library';
import { analyze, compileLibrary } from './matcher';
import { applyReplacements, createSuggester, planReplacements } from './replace';
import { compact, stripSeparators, supportsVariants } from './separators';
import { makeLibrary } from './testUtils';
import { DEFAULT_MATCH_OPTIONS, type KeywordLibrary, type MatchOptions } from './types';

const hitsOf = (library: KeywordLibrary, text: string, options: Partial<MatchOptions> = {}) =>
  analyze(text, compileLibrary(library, { ...DEFAULT_MATCH_OPTIONS, ...options })).hits;
const shown = (library: KeywordLibrary, text: string, options: Partial<MatchOptions> = {}) =>
  hitsOf(library, text, options).map((h) => (h.variant ? `${h.text}→${h.variant}` : h.text));

describe('stripSeparators', () => {
  it('removes spaces, symbols, emoji and zero-width characters and maps positions back', () => {
    const stripped = stripSeparators('全 网★第❤\ufe0f一\u200b！')!;
    expect(stripped.text).toBe('全网第一！');
    expect([...stripped.map]).toEqual([0, 2, 4, 7, 9]);
  });

  it('keeps line breaks and sentence punctuation, and returns null when nothing is removed', () => {
    expect(stripSeparators('全网\n第一，好。')).toBeNull();
    expect(compact('最 低-价')).toBe('最低价');
  });

  it('only enables variants for Chinese keywords of at least two characters', () => {
    expect(supportsVariants('全网第一')).toBe(true);
    expect(supportsVariants('V信')).toBe(true);
    expect(supportsVariants('AI')).toBe(false);
    expect(supportsVariants('赞')).toBe(false);
  });
});

describe('variant matching', () => {
  const ad = makeLibrary({ ad: ['全网第一', '最低价', '微信 => 某社交软件'] });

  it('finds keywords split by spaces, symbols and emoji, highlighting the whole original span', () => {
    expect(shown(ad, '全 网 第 一的品质，最★低★价，加微❤\ufe0f信')).toEqual([
      '全 网 第 一→全网第一',
      '最★低★价→最低价',
      '微❤\ufe0f信→微信',
    ]);
  });

  it('does not join across line breaks or sentence punctuation', () => {
    expect(shown(ad, '全网\n第一')).toEqual([]);
    expect(shown(ad, '全网，第一时间送达')).toEqual([]);
  });

  it('ignores spans stretched too far and English keywords', () => {
    expect(shown(ad, `最${'*'.repeat(20)}低价`)).toEqual([]);
    expect(shown(makeLibrary({ t: ['AI'] }), 'a I, a-i')).toEqual([]);
  });

  it('can be switched off', () => {
    expect(shown(ad, '全 网 第 一', { ignoreSeparators: false })).toEqual([]);
  });

  it('keeps ordinary matches unchanged and does not report them as variants', () => {
    expect(shown(ad, '全网第一 全网第一')).toEqual(['全网第一', '全网第一']);
  });

  it('applies exclusions to variant spellings too', () => {
    const library = makeLibrary({ ad: { terms: ['全网第一'], exclusions: ['全网第一的补水神器'] } });
    const result = analyze('全 网 第 一 的 补 水 神 器', compileLibrary(library, DEFAULT_MATCH_OPTIONS));
    expect(result.hits).toEqual([]);
    expect(result.excluded).toEqual({ ad: 1 });
  });

  it('works on decoded text', () => {
    // 「全 网 第 一」经 URL 编码，空格为 %20
    const encoded = encodeURIComponent('全 网 第 一');
    expect(shown(ad, `q=${encoded}`)).toEqual([`${encoded}→全网第一`]);
  });

  it('can be replaced by suggestions like ordinary hits', () => {
    const text = '加微 信咨询';
    const hits = hitsOf(ad, text);
    const plan = planReplacements(hits, createSuggester(text, indexLibrary(ad), DEFAULT_MATCH_OPTIONS));
    expect(applyReplacements(text, plan)).toBe('加某社交软件咨询');
  });

  it('catches evasive spellings with the preset library', () => {
    const preset = createPresetLibrary();
    const texts = hitsOf(preset, '本品全-网-第-一，最 好 的选择，药 到 病 除').map((h) => h.variant);
    expect(texts).toEqual(['全网第一', '最好', '药到病除']);
  });
});

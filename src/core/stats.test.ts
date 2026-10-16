import { describe, expect, it } from 'vitest';
import { indexLibrary } from './library';
import { analyze, compileLibrary } from './matcher';
import { computeStats, countChars } from './stats';
import { makeLibrary } from './testUtils';
import { DEFAULT_MATCH_OPTIONS } from './types';

function statsFor(spec: Parameters<typeof makeLibrary>[0], text: string) {
  const library = makeLibrary(spec);
  const { hits } = analyze(text, compileLibrary(library, DEFAULT_MATCH_OPTIONS));
  return computeStats(text, hits, library, indexLibrary(library));
}

describe('computeStats', () => {
  it('aggregates counts per category and keyword, sorted by frequency', () => {
    const stats = statsFor({ tech: ['芯片', 'AI'], region: ['北京'], idle: ['火星'] }, 'AI芯片，ai芯片，芯片在北京');
    expect(stats.summary).toMatchObject({ totalHits: 6, uniqueKeywords: 3, categoriesHit: 2, enabledCategories: 3 });
    const tech = stats.categories.find((c) => c.category.id === 'tech')!;
    expect(tech.count).toBe(5);
    expect(tech.keywords.map((k) => [k.term, k.count])).toEqual([
      ['芯片', 3],
      ['AI', 2],
    ]);
    expect(tech.keywords[1].variants).toEqual(['AI', 'ai']);
    expect(stats.categories.find((c) => c.category.id === 'idle')!.count).toBe(0);
  });

  it('counts a hit shared by two categories once per category', () => {
    const stats = statsFor({ a: ['焦虑'], b: ['焦虑'] }, '焦虑');
    expect(stats.summary.totalHits).toBe(1);
    expect(stats.categories.map((c) => c.count)).toEqual([1, 1]);
  });

  it('derives level distribution and verdict from the highest level of each hit', () => {
    const spec = { info: { terms: ['北京'] }, warn: { terms: ['投诉'], level: 'warning' as const } };
    expect(statsFor(spec, '北京').summary.verdict).toBe('normal');
    const s = statsFor({ ...spec, bad: { terms: ['北京'], level: 'danger' as const } }, '北京投诉');
    expect(s.summary.byLevel).toEqual({ info: 0, warning: 1, danger: 1 });
    expect(s.summary.verdict).toBe('risk');
    expect(statsFor(spec, '无关内容').summary.verdict).toBe('none');
  });

  it('computes density per thousand characters', () => {
    const s = statsFor({ t: ['好'] }, '好'.repeat(10) + '坏'.repeat(990));
    expect(s.summary.charCount).toBe(1000);
    expect(s.summary.density).toBeCloseTo(10);
  });
});

describe('countChars', () => {
  it('ignores whitespace and counts surrogate pairs once', () => {
    expect(countChars(' a b\n\t中　文 ')).toBe(4);
    expect(countChars('😀😀')).toBe(2);
  });
});

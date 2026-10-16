import { describe, expect, it } from 'vitest';
import { indexLibrary } from '../core/library';
import { analyze, compileLibrary } from '../core/matcher';
import { computeStats } from '../core/stats';
import { DEFAULT_MATCH_OPTIONS } from '../core/types';
import { createPresetLibrary } from './presetLibrary';
import { SAMPLES } from './samples';

const library = createPresetLibrary();
const matcher = compileLibrary(library, DEFAULT_MATCH_OPTIONS);
const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.text;
const termsIn = (text: string, categoryId: string) =>
  analyze(text, matcher)
    .hits.filter((h) => h.entries.some((e) => e.categoryId === categoryId))
    .map((h) => h.text);

describe('preset library', () => {
  it('compiles without errors and has unique ids', () => {
    expect(matcher.errors).toEqual([]);
    const ids = library.categories.flatMap((c) => [c.id, ...c.keywords.map((k) => k.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every sample produces hits', () => {
    for (const s of SAMPLES) expect(analyze(s.text, matcher).hits.length, s.id).toBeGreaterThan(5);
  });

  it('detects personal information in the ticket sample', () => {
    expect(termsIn(sample('ticket'), 'privacy')).toEqual([
      '13912345678',
      'zhangsan@example.com',
      '身份证号',
      '11010519491231002X',
      '银行卡号',
      '6222 0212 3456 7890',
    ]);
  });

  it('flags advertising violations as danger in the ad copy sample', () => {
    const text = sample('ad-copy');
    const { hits } = analyze(text, matcher);
    const stats = computeStats(text, hits, library, indexLibrary(library));
    expect(stats.summary.verdict).toBe('risk');
    expect(termsIn(text, 'ad')).toEqual(
      expect.arrayContaining(['全网第一', '国家级', '最强', '100%', '根治', '无副作用', '零风险']),
    );
  });

  it('suppresses common false positives through exclusions', () => {
    const text =
      '按照最佳实践，你最好先咨询医生；请在首选项里配置顶级域名，取绝对值。不用担心，垃圾分类很方便。' +
      '印度尼西亚的病毒式营销很有感染力，基金会推出新品上市活动。程序采用推荐算法与密码学。';
    const result = analyze(text, matcher);
    expect(result.hits.map((h) => h.text)).toEqual(['医生', '方便', '算法']);
    expect(Object.values(result.excluded).reduce((a, b) => a + b, 0)).toBe(14);
  });

  it('counts negated praise as negative feedback', () => {
    const text = '客服不专业，产品不值得买，我不推荐';
    expect(termsIn(text, 'negative')).toEqual(['不专业', '不值得', '不推荐']);
    expect(termsIn(text, 'positive')).toEqual([]);
    const all = analyze(text, compileLibrary(library, { ...DEFAULT_MATCH_OPTIONS, overlap: 'all' }));
    expect(all.hits.some((h) => h.entries.some((e) => e.categoryId === 'positive'))).toBe(false);
  });

  it('does not match AI inside said/OpenAI but does match full-width ＡＩ', () => {
    const aiHits = termsIn(sample('mixed'), 'tech').filter((t) => /ai/i.test(t) || t === 'ＡＩ');
    expect(aiHits).toEqual(['AI', 'ＡＩ']);
  });
});

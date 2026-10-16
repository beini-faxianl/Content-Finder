import { describe, expect, it } from 'vitest';
import { discoverTerms } from './discover';

describe('discoverTerms', () => {
  const text = '扫地机器人很好用。这款扫地机器人续航长，扫地机器人的吸力也大。我们的客服说吸力很强。';

  it('surfaces repeated CJK terms and folds their fragments', () => {
    const terms = discoverTerms(text).map((c) => c.term);
    expect(terms).toContain('扫地机器人');
    expect(terms).toContain('吸力');
    // 片段被更长的候选词吸收
    expect(terms).not.toContain('扫地机');
    expect(terms).not.toContain('地机器');
    // 以虚词开头/结尾或含"的"的片段被过滤
    expect(terms.some((t) => t.includes('的'))).toBe(false);
  });

  it('excludes terms already covered by the library', () => {
    const terms = discoverTerms(text, { exclude: ['机器人'] }).map((c) => c.term);
    expect(terms).not.toContain('扫地机器人');
    expect(terms).toContain('吸力');
  });

  it('counts Latin words case-insensitively and drops stop words', () => {
    const result = discoverTerms('The Copilot is great. copilot helps; the COPILOT ships with the team.');
    expect(result).toEqual([{ term: 'Copilot', count: 3, kind: 'latin' }]);
  });

  it('respects minCount and limit', () => {
    expect(discoverTerms('苹果香蕉', { minCount: 2 })).toEqual([]);
    expect(discoverTerms('苹果苹果香蕉香蕉', { limit: 1 })).toHaveLength(1);
  });
});

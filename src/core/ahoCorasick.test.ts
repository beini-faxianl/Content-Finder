import { describe, expect, it } from 'vitest';
import { AhoCorasick } from './ahoCorasick';

function collect(patterns: string[], text: string) {
  const out: Array<[number, number, string]> = [];
  new AhoCorasick(patterns).search(text, (start, end, p) => out.push([start, end, patterns[p]]));
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function bruteForce(patterns: string[], text: string) {
  const out: Array<[number, number, string]> = [];
  patterns.forEach((p) => {
    if (!p) return;
    for (let i = text.indexOf(p); i !== -1; i = text.indexOf(p, i + 1)) out.push([i, i + p.length, p]);
  });
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

describe('AhoCorasick', () => {
  it('finds overlapping and nested patterns (classic ushers example)', () => {
    expect(collect(['he', 'she', 'his', 'hers'], 'ushers')).toEqual([
      [1, 4, 'she'],
      [2, 4, 'he'],
      [2, 6, 'hers'],
    ]);
  });

  it('works with CJK text', () => {
    expect(collect(['人工智能', '智能', '能源'], '人工智能源于此')).toEqual([
      [0, 4, '人工智能'],
      [2, 4, '智能'],
      [3, 5, '能源'],
    ]);
  });

  it('ignores empty patterns and reports nothing for empty text', () => {
    expect(collect(['', 'a'], 'aa')).toEqual([
      [0, 1, 'a'],
      [1, 2, 'a'],
    ]);
    expect(collect(['a'], '')).toEqual([]);
  });

  it('reports every pattern index for duplicate patterns', () => {
    const hits: number[] = [];
    new AhoCorasick(['ab', 'ab']).search('xab', (_s, _e, p) => hits.push(p));
    expect(hits.sort()).toEqual([0, 1]);
  });

  it('agrees with brute force on random input', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const alphabet = 'abc中文';
    const word = (len: number) => Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');

    for (let round = 0; round < 50; round++) {
      const patterns = Array.from({ length: 8 }, () => word(1 + Math.floor(rand() * 4)));
      const text = word(200);
      expect(collect(patterns, text)).toEqual(bruteForce(patterns, text));
    }
  });
});

import { describe, expect, it } from 'vitest';
import { buildSegments } from './segments';
import type { Hit } from './types';

const hit = (id: number, start: number, end: number): Hit => ({ id, start, end, text: '', entries: [] });
const shape = (segments: ReturnType<typeof buildSegments>) => segments.map((s) => [s.start, s.end, s.hitIds, s.startsHere]);

describe('buildSegments', () => {
  it('returns nothing for empty text and one plain segment without hits', () => {
    expect(buildSegments(0, [])).toEqual([]);
    expect(shape(buildSegments(5, []))).toEqual([[0, 5, [], []]]);
  });

  it('splits around non-overlapping hits', () => {
    expect(shape(buildSegments(10, [hit(0, 2, 4), hit(1, 4, 6)]))).toEqual([
      [0, 2, [], []],
      [2, 4, [0], [0]],
      [4, 6, [1], [1]],
      [6, 10, [], []],
    ]);
  });

  it('marks nested hits innermost-first', () => {
    // 人工智能(0-4) 包含 智能(2-4)
    expect(shape(buildSegments(4, [hit(0, 0, 4), hit(1, 2, 4)]))).toEqual([
      [0, 2, [0], [0]],
      [2, 4, [1, 0], [1]],
    ]);
  });

  it('handles crossing hits', () => {
    // 智能(2-4) 与 能源(3-5) 交叉
    expect(shape(buildSegments(5, [hit(0, 2, 4), hit(1, 3, 5)]))).toEqual([
      [0, 2, [], []],
      [2, 3, [0], [0]],
      [3, 4, [0, 1], [1]],
      [4, 5, [1], []],
    ]);
  });

  it('accepts hits in any order', () => {
    const a = buildSegments(10, [hit(1, 6, 8), hit(0, 1, 3)]);
    expect(a.filter((s) => s.hitIds.length).map((s) => s.hitIds[0])).toEqual([0, 1]);
  });
});

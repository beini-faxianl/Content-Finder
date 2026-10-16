import type { Hit } from './types';

/** 渲染用的原子片段：区间内被同一组命中覆盖。hitIds 为空表示普通文本。 */
export interface Segment {
  start: number;
  end: number;
  /** 覆盖该片段的命中，按长度升序（最内层在前） */
  hitIds: number[];
  /** 从该片段起始的命中，用于定位跳转 */
  startsHere: number[];
}

/**
 * 把文本按命中边界切分成片段。命中可以嵌套或交叉（overlap = all），
 * 每个片段记录覆盖它的全部命中，渲染层据此决定颜色与交互。
 */
export function buildSegments(textLength: number, hits: readonly Hit[]): Segment[] {
  if (textLength === 0) return [];
  if (hits.length === 0) return [{ start: 0, end: textLength, hitIds: [], startsHere: [] }];

  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - a.end);
  const points = new Set<number>([0, textLength]);
  for (const hit of sorted) {
    points.add(Math.min(hit.start, textLength));
    points.add(Math.min(hit.end, textLength));
  }
  const boundaries = [...points].sort((a, b) => a - b);

  const segments: Segment[] = [];
  let active: Hit[] = [];
  let next = 0;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    active = active.filter((h) => h.end > start);
    const startsHere: number[] = [];
    while (next < sorted.length && sorted[next].start <= start) {
      const hit = sorted[next++];
      if (hit.end > start) {
        active.push(hit);
        if (hit.start === start) startsHere.push(hit.id);
      }
    }
    const hitIds =
      active.length > 1
        ? [...active].sort((a, b) => a.end - a.start - (b.end - b.start)).map((h) => h.id)
        : active.map((h) => h.id);
    segments.push({ start, end, hitIds, startsHere });
  }
  return segments;
}

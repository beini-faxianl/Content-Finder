import type { Hit } from './types';

export interface HitContext {
  before: string;
  match: string;
  after: string;
  /** 前/后是否被截断 */
  clippedStart: boolean;
  clippedEnd: boolean;
}

const squash = (s: string) => s.replace(/\s+/g, ' ');

/** 截取命中前后若干字符作为上下文（KWIC），空白折叠为单个空格 */
export function getContext(text: string, hit: Pick<Hit, 'start' | 'end'>, radius: number): HitContext {
  const from = Math.max(0, hit.start - radius);
  const to = Math.min(text.length, hit.end + radius);
  return {
    before: squash(text.slice(from, hit.start)).trimStart(),
    match: text.slice(hit.start, hit.end),
    after: squash(text.slice(hit.end, to)).trimEnd(),
    clippedStart: from > 0,
    clippedEnd: to < text.length,
  };
}

/** 预先计算每一行的起始下标 */
export function buildLineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 二分查找下标所在行号（从 1 开始） */
export function lineAt(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

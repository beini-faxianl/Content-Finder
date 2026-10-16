// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLibrary } from '../core/testUtils';
import { DEFAULT_MATCH_OPTIONS } from '../core/types';
import { FakeTransport } from '../engine/testTransport';
import { useBatch } from './useBatch';

const HANG = '(a+)+$';

describe('useBatch', () => {
  it('analyzes each source in order, keeping read errors as failed items', async () => {
    const library = makeLibrary({ ad: { terms: ['最好'], level: 'danger' } });
    const { result } = renderHook(() =>
      useBatch(library, DEFAULT_MATCH_OPTIONS, { createTransport: () => new FakeTransport(), timeoutMs: 200 }),
    );

    act(() => {
      void result.current.run([
        { name: 'a.txt', text: '最好的产品' },
        { name: 'b.bin', error: '看起来是二进制文件' },
        { name: 'c.txt', text: '普通内容' },
      ]);
    });
    expect(result.current.running).toBe(true);
    await waitFor(() => expect(result.current.running).toBe(false));

    expect(result.current.processed).toBe(3);
    expect(result.current.items.map((i) => [i.name, i.status, i.result?.stats.summary.verdict])).toEqual([
      ['a.txt', 'done', 'risk'],
      ['b.bin', 'error', undefined],
      ['c.txt', 'done', 'none'],
    ]);
    expect(result.current.index?.categories.has('ad')).toBe(true);
  });

  it('marks an item that times out as failed and continues with the rest', async () => {
    const library = makeLibrary({ ad: ['最好'], r: [`re:${HANG}`] });
    const { result } = renderHook(() =>
      useBatch(library, DEFAULT_MATCH_OPTIONS, { createTransport: () => new FakeTransport(HANG), timeoutMs: 40 }),
    );
    act(() => {
      void result.current.run([
        { name: 'x', text: 'aaaa!' },
        { name: 'y', text: '最好' },
      ]);
    });
    await waitFor(() => expect(result.current.running).toBe(false));
    // FakeTransport 中正则一旦「卡住」整个 Worker 都不再响应，两条都会超时；但每条都有结果，不会停滞
    expect(result.current.items.map((i) => i.status)).toEqual(['error', 'error']);
    expect(result.current.items[0].error).toMatch(/超时/);
  });

  it('can stop a run and rerun with the current library', async () => {
    let library = makeLibrary({ ad: ['最好'] });
    const { result, rerender } = renderHook(() =>
      useBatch(library, DEFAULT_MATCH_OPTIONS, { createTransport: () => new FakeTransport(), timeoutMs: 200 }),
    );
    act(() => {
      void result.current.run(Array.from({ length: 5 }, (_, i) => ({ name: `#${i}`, text: '最好' })));
      result.current.stop();
    });
    expect(result.current.running).toBe(false);
    expect(result.current.items.every((i) => i.status === 'stopped')).toBe(true);

    library = makeLibrary({ ad: ['最好', '产品'] });
    rerender();
    act(() => result.current.rerun());
    await waitFor(() => expect(result.current.running).toBe(false));
    expect(result.current.items.every((i) => i.status === 'done')).toBe(true);

    act(() => result.current.clear());
    expect(result.current.items).toEqual([]);
  });
});

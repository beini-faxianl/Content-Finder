// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeLibrary } from '../core/testUtils';
import { DEFAULT_MATCH_OPTIONS, type KeywordLibrary } from '../core/types';
import { FakeTransport } from './testTransport';
import { REGEX_TIMEOUT_MESSAGE, useWorkerAnalysis, useWorkerRegexTest } from './useAnalysis';

const HANG = '(a+)+$';

describe('useWorkerAnalysis', () => {
  const engine = (hangOn?: string) => ({ createTransport: () => new FakeTransport(hangOn), timeoutMs: 40 });

  it('shows the raw text first, then the analysis result', async () => {
    const library = makeLibrary({ t: ['芯片'] });
    const options = engine();
    const { result } = renderHook(() => useWorkerAnalysis('芯片', library, DEFAULT_MATCH_OPTIONS, options));
    expect(result.current).toMatchObject({ text: '芯片', stale: true });
    expect(result.current.result.hits).toEqual([]);
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.result.hits.map((h) => h.text)).toEqual(['芯片']);
  });

  it('suspends a regex that hangs, keeps the other rules working and re-enables it once edited', async () => {
    const library = makeLibrary({ t: ['芯片'], r: [`re:${HANG}`] });
    const options = engine(HANG);
    const { result, rerender } = renderHook(
      ({ lib }: { lib: KeywordLibrary }) => useWorkerAnalysis('芯片 aaaa!', lib, DEFAULT_MATCH_OPTIONS, options),
      { initialProps: { lib: library } },
    );

    await waitFor(() => expect(result.current.errors).toEqual([{ categoryId: 'r', keywordId: 'r0', message: REGEX_TIMEOUT_MESSAGE }]));
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.result.hits.map((h) => h.text)).toEqual(['芯片']);
    expect(result.current.ruleCount).toBe(1);

    // 修改表达式后自动恢复参与分析
    const fixed = makeLibrary({ t: ['芯片'], r: ['re:a+!'] });
    rerender({ lib: fixed });
    await waitFor(() => expect(result.current.result.hits.map((h) => h.text)).toEqual(['芯片', 'aaaa!']));
    expect(result.current.errors).toEqual([]);
  });

  it('coalesces rapid input changes and ends on the latest text', async () => {
    const library = makeLibrary({ t: ['芯片'] });
    const options = engine();
    const { result, rerender } = renderHook(({ text }) => useWorkerAnalysis(text, library, DEFAULT_MATCH_OPTIONS, options), {
      initialProps: { text: '芯' },
    });
    for (const text of ['芯片', '芯片芯', '芯片芯片']) rerender({ text });
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(result.current.text).toBe('芯片芯片');
    expect(result.current.result.hits).toHaveLength(2);
  });
});

describe('useWorkerRegexTest', () => {
  it('returns results tied to the text they were computed for', async () => {
    const { result } = renderHook(() =>
      useWorkerRegexTest('\\d+', '共 12 件', DEFAULT_MATCH_OPTIONS, 100, { createTransport: () => new FakeTransport() }),
    );
    await waitFor(() => expect(result.current?.pending).toBe(false));
    expect(result.current?.text).toBe('共 12 件');
    expect(result.current?.result.matches.map((m) => m.text)).toEqual(['12']);
  });
});

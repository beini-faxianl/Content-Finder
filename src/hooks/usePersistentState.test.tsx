// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePersistentState } from './usePersistentState';

const KEY = 'test.key';
const asText = (raw: unknown) => (typeof raw === 'string' ? raw : undefined);
const stored = () => localStorage.getItem(KEY);

afterEach(() => vi.restoreAllMocks());

describe('usePersistentState', () => {
  it('restores the saved value and writes changes back', () => {
    localStorage.setItem(KEY, JSON.stringify('saved'));
    const { result } = renderHook(() => usePersistentState(KEY, () => 'initial', asText));
    expect(result.current[0]).toBe('saved');
    act(() => result.current[1]('changed'));
    expect(stored()).toBe('"changed"');
  });

  it('flushes a debounced write immediately when the page is hidden', () => {
    const { result } = renderHook(() => usePersistentState(KEY, () => '', asText, 10_000));
    act(() => result.current[1]('typed just before closing'));
    expect(stored()).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(stored()).toBe('"typed just before closing"');
  });

  it('flushes pending writes on unmount', () => {
    const { result, unmount } = renderHook(() => usePersistentState(KEY, () => '', asText, 10_000));
    act(() => result.current[1]('pending'));
    unmount();
    expect(stored()).toBe('"pending"');
  });

  it('writes back values that were transformed while loading (e.g. upgrades)', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1 }));
    renderHook(() => usePersistentState(KEY, () => ({ v: 0 }), () => ({ v: 2 })));
    expect(stored()).toBe('{"v":2}');
  });

  it('picks up changes made in another tab', () => {
    const { result } = renderHook(() => usePersistentState(KEY, () => 'mine', asText));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: JSON.stringify('from other tab') }));
    });
    expect(result.current[0]).toBe('from other tab');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other.key', newValue: '"ignored"' }));
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: '{broken' }));
    });
    expect(result.current[0]).toBe('from other tab');
  });

  it('reports when saving fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const { result } = renderHook(() => usePersistentState(KEY, () => '', asText));
    act(() => result.current[1]('too big'));
    expect(result.current[2].saveFailed).toBe(true);
  });
});

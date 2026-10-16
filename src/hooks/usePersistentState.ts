import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { readStorage, writeStorage } from '../utils/storage';

export interface PersistStatus {
  /** 最近一次写入失败（通常是存储空间不足） */
  saveFailed: boolean;
}

/**
 * 与 localStorage 同步的 state。
 * - restore 把读到的原始值转换为合法状态；返回 undefined 表示使用初始值。
 *   若转换改变了内容（例如旧版数据升级），加载后会立即写回。
 * - delay 为写入防抖毫秒数，适合频繁变化的大文本；页面隐藏或关闭前会立即写入，不丢最后的修改。
 * - 其他标签页修改同一个键时自动同步过来。
 */
export function usePersistentState<T>(
  key: string,
  initial: () => T,
  restore: (raw: unknown) => T | undefined,
  delay = 0,
): [T, Dispatch<SetStateAction<T>>, PersistStatus] {
  const loadedDirty = useRef(false);
  const [state, setState] = useState<T>(() => {
    const raw = readStorage(key);
    if (raw === undefined) return initial();
    const restored = restore(raw);
    if (restored === undefined) return initial();
    loadedDirty.current = restored !== raw && JSON.stringify(restored) !== JSON.stringify(raw);
    return restored;
  });
  const [saveFailed, setSaveFailed] = useState(false);

  const restoreRef = useRef(restore);
  useEffect(() => {
    restoreRef.current = restore;
  });

  /** 尚未写入的最新值 */
  const pending = useRef<{ value: T } | null>(null);
  const flush = useCallback(() => {
    if (!pending.current) return;
    const ok = writeStorage(key, pending.current.value);
    pending.current = null;
    setSaveFailed(!ok);
  }, [key]);

  const skipInitialWrite = useRef(true);
  useEffect(() => {
    if (skipInitialWrite.current) {
      skipInitialWrite.current = false;
      if (!loadedDirty.current) return;
    }
    pending.current = { value: state };
    if (delay <= 0) {
      flush();
      return;
    }
    const timer = setTimeout(flush, delay);
    return () => clearTimeout(timer);
  }, [state, delay, flush]);

  useEffect(() => {
    const onVisibilityChange = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flush]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.newValue);
      } catch {
        return;
      }
      const next = restoreRef.current(raw);
      if (next === undefined) return;
      pending.current = null; // 另一个标签页的值更新，放弃本页尚未写入的旧值
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return [state, setState, { saveFailed }];
}

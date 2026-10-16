import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { topKeywords, type BatchItem, type BatchSource } from '../core/batch';
import { indexLibrary, type LibraryIndex } from '../core/library';
import { computeStats } from '../core/stats';
import type { KeywordLibrary, MatchOptions } from '../core/types';
import { createDefaultTransport, EngineAbortError, EngineClient, EngineTimeoutError } from '../engine/client';
import type { EngineTransport } from '../engine/protocol';
import { ANALYSIS_TIMEOUT_MS } from '../engine/useAnalysis';

export interface BatchOptions {
  createTransport?: () => EngineTransport;
  timeoutMs?: number;
}

/**
 * 批量检测的状态与调度。逐条在独立的 Worker 中分析（不占用编辑区的分析线程），
 * 单条超时只记为失败、继续下一条；随时可以停止或用最新的词库重新检测。
 */
export function useBatch(
  library: KeywordLibrary,
  options: MatchOptions,
  { createTransport = createDefaultTransport, timeoutMs = ANALYSIS_TIMEOUT_MS }: BatchOptions = {},
) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  /** 本轮检测所用词库的索引：导出与展示命中时用它解释分类和关键词 */
  const [runIndex, setRunIndex] = useState<LibraryIndex | null>(null);
  const runId = useRef(0);
  const client = useRef<EngineClient | null>(null);

  const latest = useRef({ library, options });
  useEffect(() => {
    latest.current = { library, options };
  });

  useEffect(
    () => () => {
      runId.current++;
      client.current?.dispose();
    },
    [],
  );

  const update = (id: number, patch: Partial<BatchItem>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const run = useCallback(
    async (sources: BatchSource[]) => {
      const id = ++runId.current;
      const { library, options } = latest.current;
      const index = indexLibrary(library);
      const engine = (client.current ??= new EngineClient(createTransport));
      setRunIndex(index);
      setItems(
        sources.map((source, i) => ({
          id: i,
          name: source.name,
          text: source.text ?? '',
          status: source.error !== undefined ? 'error' : 'pending',
          ...(source.error !== undefined ? { error: source.error } : {}),
        })),
      );
      setRunning(true);

      for (let i = 0; i < sources.length; i++) {
        const text = sources[i].text;
        if (runId.current !== id) return;
        if (sources[i].error !== undefined || text === undefined) continue;
        try {
          // 每轮用同一个版本号，Worker 只需编译一次词库
          const response = await engine.request(
            { type: 'analyze', configId: id, library, options, text },
            timeoutMs,
          );
          if (runId.current !== id) return;
          if (response.type !== 'analyzed') continue;
          const { hits, excluded } = response.output.result;
          const stats = computeStats(text, hits, library, index);
          update(i, { status: 'done', result: { hits, stats, excluded, top: topKeywords(stats) } });
        } catch (error) {
          if (runId.current !== id || error instanceof EngineAbortError) return;
          update(i, {
            status: 'error',
            error:
              error instanceof EngineTimeoutError
                ? '分析超时：内容过长或某条正则过于复杂'
                : error instanceof Error
                  ? error.message
                  : String(error),
          });
        }
      }
      if (runId.current === id) setRunning(false);
    },
    [createTransport, timeoutMs],
  );

  /** 停止检测：正在分析的那一条也会中止，未完成的标记为已停止 */
  const stop = useCallback(() => {
    runId.current++;
    client.current?.dispose();
    setRunning(false);
    setItems((list) => list.map((item) => (item.status === 'pending' ? { ...item, status: 'stopped' } : item)));
  }, []);

  /** 用当前的词库与设置重新检测同一批内容（读取失败的文件保持失败） */
  const rerun = useCallback(() => {
    void run(
      items.map((item) =>
        item.status === 'error' && !item.text ? { name: item.name, error: item.error } : { name: item.name, text: item.text },
      ),
    );
  }, [items, run]);

  const clear = useCallback(() => {
    stop();
    setItems([]);
    setRunIndex(null);
  }, [stop]);

  const processed = useMemo(() => items.filter((item) => item.status !== 'pending').length, [items]);

  return { items, running, processed, index: runIndex, run, stop, rerun, clear };
}

export type BatchState = ReturnType<typeof useBatch>;

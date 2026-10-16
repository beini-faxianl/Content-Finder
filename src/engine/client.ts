import AnalysisWorker from './analysis.worker?worker&inline';
import { createEngineCore } from './core';
import type { EngineRequest, EngineResponse, EngineTransport } from './protocol';

/** 请求执行超时；ruleKey 为超时时正在执行的正则规则（若已知） */
export class EngineTimeoutError extends Error {
  override name = 'EngineTimeoutError';
  constructor(readonly ruleKey: string | undefined) {
    super('分析超时');
  }
}

/** 请求因 Worker 重启或被释放而中止，调用方通常只需忽略 */
export class EngineAbortError extends Error {
  override name = 'EngineAbortError';
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type EngineRequestInput = DistributiveOmit<EngineRequest, 'id'>;

interface Pending {
  resolve: (response: EngineResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  lastRule?: string;
}

/**
 * 分析引擎客户端：为请求编号、等待响应、处理超时。
 * 正在执行的正则无法从外部打断，所以超时后只能终止整个 Worker，下次请求时再新建一个。
 */
export class EngineClient {
  private transport: EngineTransport | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(private readonly createTransport: () => EngineTransport) {}

  request(request: EngineRequestInput, timeoutMs: number): Promise<EngineResponse> {
    let transport: EngineTransport;
    try {
      transport = this.ensureTransport();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.handleTimeout(id), timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      transport.postMessage({ ...request, id } as EngineRequest);
    });
  }

  dispose(): void {
    this.reset(() => new EngineAbortError('引擎已释放'));
  }

  private ensureTransport(): EngineTransport {
    if (!this.transport) {
      const transport = this.createTransport();
      transport.onmessage = (response) => this.receive(response);
      this.transport = transport;
    }
    return this.transport;
  }

  private receive(response: EngineResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === 'progress') {
      pending.lastRule = response.ruleKey;
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.type === 'failed') pending.reject(new Error(response.message));
    else pending.resolve(response);
  }

  private handleTimeout(id: number): void {
    const lastRule = this.pending.get(id)?.lastRule;
    this.reset((pendingId) =>
      pendingId === id ? new EngineTimeoutError(lastRule) : new EngineAbortError('分析引擎已重启'),
    );
  }

  /** 终止当前 Worker，并让所有等待中的请求失败 */
  private reset(errorFor: (pendingId: number) => Error): void {
    this.transport?.terminate();
    this.transport = null;
    const pending = [...this.pending];
    this.pending.clear();
    for (const [pendingId, p] of pending) {
      clearTimeout(p.timer);
      p.reject(errorFor(pendingId));
    }
  }
}

/** 在后台 Worker 中运行分析（构建时内联进 index.html，离线与 file:// 下同样可用） */
export function createWorkerTransport(): EngineTransport {
  const worker = new AnalysisWorker();
  const transport: EngineTransport = {
    postMessage: (request) => worker.postMessage(request),
    terminate: () => worker.terminate(),
    onmessage: null,
  };
  worker.onmessage = (event: MessageEvent<EngineResponse>) => transport.onmessage?.(event.data);
  return transport;
}

/** 在主线程中运行分析：Worker 不可用时的退路（无超时保护，但功能完整） */
export function createLocalTransport(): EngineTransport {
  let terminated = false;
  const transport: EngineTransport = {
    postMessage: (request) => queueMicrotask(() => !terminated && handle(request)),
    terminate: () => {
      terminated = true;
    },
    onmessage: null,
  };
  const handle = createEngineCore((response) => queueMicrotask(() => !terminated && transport.onmessage?.(response)));
  return transport;
}

/** 优先使用 Worker；创建失败（例如浏览器禁止 blob Worker）时退回主线程 */
export function createDefaultTransport(): EngineTransport {
  try {
    return createWorkerTransport();
  } catch {
    return createLocalTransport();
  }
}

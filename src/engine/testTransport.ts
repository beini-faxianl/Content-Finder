import { createEngineCore } from './core';
import type { EngineRequest, EngineResponse, EngineTransport } from './protocol';

/**
 * 测试替身：在当前线程中运行引擎，异步回传消息，模拟 Worker 的行为。
 * 若分析请求中有正则的表达式等于 hangOn，则汇报开始执行该规则后不再响应，模拟灾难性回溯。
 */
export class FakeTransport implements EngineTransport {
  onmessage: ((response: EngineResponse) => void) | null = null;
  terminated = false;
  /** 已卡在某条正则上：与真实 Worker 一样，之后的消息都得不到处理 */
  private hung = false;
  readonly received: EngineRequest[] = [];
  private readonly handle: (request: EngineRequest) => void;

  constructor(private readonly hangOn?: string) {
    this.handle = createEngineCore((response) => this.deliver(response));
  }

  postMessage(request: EngineRequest): void {
    this.received.push(request);
    queueMicrotask(() => {
      if (this.terminated || this.hung) return;
      const hanging = request.type === 'analyze' && this.findHanging(request);
      if (hanging) {
        this.hung = true;
        this.deliver({ type: 'progress', id: request.id, ruleKey: hanging });
        return;
      }
      this.handle(request);
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  private findHanging(request: Extract<EngineRequest, { type: 'analyze' }>): string | null {
    if (this.hangOn === undefined) return null;
    for (const category of request.library.categories) {
      const keyword = category.keywords.find((k) => k.type === 'regex' && k.term === this.hangOn);
      if (keyword && category.enabled) return `${category.id}::${keyword.id}`;
    }
    return null;
  }

  private deliver(response: EngineResponse): void {
    queueMicrotask(() => !this.terminated && this.onmessage?.(response));
  }
}

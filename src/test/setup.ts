import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 仅在 jsdom 环境下生效；核心逻辑测试运行在 node 环境
if (typeof window !== 'undefined') {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  // jsdom 未实现的浏览器 API
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
  Element.prototype.scrollTo ??= function scrollTo() {};
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
}

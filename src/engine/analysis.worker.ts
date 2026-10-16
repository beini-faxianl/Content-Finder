import { createEngineCore } from './core';
import type { EngineRequest, EngineResponse } from './protocol';

// 项目的 TS 配置面向 DOM，这里只声明 Worker 作用域中用到的两个成员
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage(message: EngineResponse): void;
};

const handle = createEngineCore((response) => scope.postMessage(response));
scope.onmessage = (event) => handle(event.data);

import type { RegexTestResult } from '../core/matcher';
import type { AnalysisResult, KeywordLibrary, MatchOptions, RuleError } from '../core/types';

/** 主线程与分析 Worker 之间的消息协议 */

export type RegexOptions = Pick<MatchOptions, 'caseSensitive' | 'normalizeWidth' | 'decode'>;

export interface AnalyzeRequest {
  type: 'analyze';
  id: number;
  /** 词库与选项的版本号；版本不变时 Worker 复用已编译的匹配器 */
  configId: number;
  library: KeywordLibrary;
  options: MatchOptions;
  text: string;
}

export interface TestRequest {
  type: 'test';
  id: number;
  pattern: string;
  text: string;
  options: RegexOptions;
  limit: number;
}

export type EngineRequest = AnalyzeRequest | TestRequest;

export interface AnalyzeOutput {
  result: AnalysisResult;
  errors: RuleError[];
  ruleCount: number;
}

export type EngineResponse =
  /** 即将执行某条正则：一旦超时，主线程据此定位是哪条规则 */
  | { type: 'progress'; id: number; ruleKey: string }
  | { type: 'analyzed'; id: number; output: AnalyzeOutput }
  | { type: 'tested'; id: number; result: RegexTestResult }
  | { type: 'failed'; id: number; message: string };

/** Worker 与测试替身共同遵守的最小接口 */
export interface EngineTransport {
  postMessage(request: EngineRequest): void;
  terminate(): void;
  onmessage: ((response: EngineResponse) => void) | null;
}

export const EMPTY_OUTPUT: AnalyzeOutput = {
  result: { hits: [], elapsedMs: 0, truncated: false, excluded: {}, decoded: { url: 0, unicode: 0, html: 0 } },
  errors: [],
  ruleCount: 0,
};

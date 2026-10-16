import { keywordKey } from '../core/library';
import { analyze, compileLibrary, testRegex, type CompiledMatcher } from '../core/matcher';
import type { EngineRequest, EngineResponse } from './protocol';

/**
 * 分析引擎的消息处理逻辑（运行在 Worker 中，也可在主线程中直接调用）。
 * 与 Worker 运行环境解耦，便于单元测试。
 */
export function createEngineCore(post: (response: EngineResponse) => void): (request: EngineRequest) => void {
  let cache: { configId: number; matcher: CompiledMatcher } | null = null;

  return (request) => {
    try {
      if (request.type === 'analyze') {
        if (cache?.configId !== request.configId) {
          cache = { configId: request.configId, matcher: compileLibrary(request.library, request.options) };
        }
        const { matcher } = cache;
        const result = analyze(request.text, matcher, {
          onRegexRule: (rule) =>
            post({ type: 'progress', id: request.id, ruleKey: keywordKey(rule.categoryId, rule.keywordId) }),
        });
        post({ type: 'analyzed', id: request.id, output: { result, errors: matcher.errors, ruleCount: matcher.ruleCount } });
      } else {
        post({ type: 'tested', id: request.id, result: testRegex(request.pattern, request.text, request.options, request.limit) });
      }
    } catch (error) {
      post({ type: 'failed', id: request.id, message: error instanceof Error ? error.message : String(error) });
    }
  };
}

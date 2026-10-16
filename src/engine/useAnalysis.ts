import { useDeferredValue, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { indexLibrary } from '../core/library';
import { analyze, compileLibrary, testRegex, type RegexTestResult } from '../core/matcher';
import type { AnalysisResult, KeywordLibrary, MatchOptions, RuleError } from '../core/types';
import { createDefaultTransport, EngineAbortError, EngineClient, EngineTimeoutError } from './client';
import { EMPTY_OUTPUT, type AnalyzeOutput, type EngineTransport, type RegexOptions } from './protocol';

export const ANALYSIS_TIMEOUT_MS = 2500;
export const REGEX_TEST_TIMEOUT_MS = 1500;
export const REGEX_TIMEOUT_MESSAGE =
  '执行超时（可能存在灾难性回溯），已暂停此规则；修改表达式后会自动重新启用';

export interface AnalysisState {
  /** 结果所对应的文本（可能稍落后于编辑框中的最新文本） */
  text: string;
  result: AnalysisResult;
  /** 规则错误：语法错误与执行超时 */
  errors: RuleError[];
  ruleCount: number;
  /** 结果尚未对应最新的文本或词库 */
  stale: boolean;
  /** 整体分析失败时的说明（单条正则超时不算） */
  failure: string | null;
}

export interface EngineOptions {
  createTransport?: () => EngineTransport;
  timeoutMs?: number;
}

/** 「只关心最新输入」的调度：同一时间只执行一个请求，期间的新输入合并为一次 */
class LatestRunner<I> {
  private busy = false;
  private queued = false;
  private input: I | undefined;

  constructor(private readonly execute: (input: I) => Promise<void>) {}

  submit(input: I): void {
    this.input = input;
    if (this.busy) {
      this.queued = true;
      return;
    }
    void this.loop();
  }

  private async loop(): Promise<void> {
    this.busy = true;
    try {
      do {
        this.queued = false;
        await this.execute(this.input as I);
      } while (this.queued);
    } finally {
      this.busy = false;
    }
  }
}

function useEngine(createTransport: () => EngineTransport): RefObject<EngineClient | null> {
  const engine = useRef<EngineClient | null>(null);
  useEffect(() => {
    const client = new EngineClient(createTransport);
    engine.current = client;
    return () => {
      client.dispose();
      if (engine.current === client) engine.current = null;
    };
  }, [createTransport]);
  return engine;
}

/** 词库或选项对象每变一次，就得到一个新的版本号（按对象身份缓存） */
const configIds = new WeakMap<object, WeakMap<object, number>>();
let configSeq = 0;
function configIdFor(library: KeywordLibrary, options: MatchOptions): number {
  let byOptions = configIds.get(library);
  if (!byOptions) configIds.set(library, (byOptions = new WeakMap()));
  let id = byOptions.get(options);
  if (id === undefined) byOptions.set(options, (id = ++configSeq));
  return id;
}

/** 去掉执行超时、且之后没被修改过的正则 */
function withoutTimedOut(library: KeywordLibrary, timedOut: ReadonlyMap<string, string>): KeywordLibrary {
  if (!timedOut.size) return library;
  return {
    ...library,
    categories: library.categories.map((category) => ({
      ...category,
      keywords: category.keywords.filter((k) => timedOut.get(`${category.id}::${k.id}`) !== k.term),
    })),
  };
}

interface Input {
  text: string;
  library: KeywordLibrary;
  options: MatchOptions;
  configId: number;
}

interface WorkerState {
  text: string;
  configId: number;
  output: AnalyzeOutput;
  failure: string | null;
}

/** 在 Web Worker 中分析：主线程永不阻塞，单条正则超时会被暂停而不影响其他规则 */
export function useWorkerAnalysis(
  text: string,
  library: KeywordLibrary,
  options: MatchOptions,
  { createTransport = createDefaultTransport, timeoutMs = ANALYSIS_TIMEOUT_MS }: EngineOptions = {},
): AnalysisState {
  /** 超时的规则 → 超时时的表达式；表达式被修改后自动恢复 */
  const [timedOut, setTimedOut] = useState<ReadonlyMap<string, string>>(() => new Map());
  const effectiveLibrary = useMemo(() => withoutTimedOut(library, timedOut), [library, timedOut]);
  const configId = configIdFor(effectiveLibrary, options);
  // 首个结果返回前先展示不带高亮的原文，避免阅读区闪空
  const [state, setState] = useState<WorkerState>(() => ({ text, configId: -1, output: EMPTY_OUTPUT, failure: null }));
  const engine = useEngine(createTransport);

  const runner = useRef<LatestRunner<Input> | null>(null);
  runner.current ??= new LatestRunner<Input>(async (input) => {
    const client = engine.current;
    if (!client) return;
    try {
      const response = await client.request(
        { type: 'analyze', text: input.text, library: input.library, options: input.options, configId: input.configId },
        timeoutMs,
      );
      if (response.type === 'analyzed') {
        setState({ text: input.text, configId: input.configId, output: response.output, failure: null });
      }
    } catch (error) {
      if (error instanceof EngineAbortError) return;
      const ruleKey = error instanceof EngineTimeoutError ? error.ruleKey : undefined;
      const term = ruleKey && indexLibrary(input.library).keywords.get(ruleKey)?.keyword.term;
      if (ruleKey && term !== undefined) {
        // 暂停这条规则；词库变化会触发重新分析
        setTimedOut((map) => new Map(map).set(ruleKey, term));
        return;
      }
      const failure =
        error instanceof EngineTimeoutError ? '分析超时：内容过长或规则过于复杂' : `分析失败：${(error as Error).message}`;
      setState({ text: input.text, configId: input.configId, output: EMPTY_OUTPUT, failure });
    }
  });

  useEffect(() => {
    runner.current!.submit({ text, library: effectiveLibrary, options, configId });
  }, [text, effectiveLibrary, options, configId, engine]);

  const timeoutErrors = useMemo(() => {
    const errors: RuleError[] = [];
    for (const [key, term] of timedOut) {
      const ref = indexLibrary(library).keywords.get(key);
      if (ref && ref.keyword.term === term) {
        errors.push({ categoryId: ref.category.id, keywordId: ref.keyword.id, message: REGEX_TIMEOUT_MESSAGE });
      }
    }
    return errors;
  }, [timedOut, library]);

  return useMemo(
    () => ({
      text: state.text,
      result: state.output.result,
      errors: timeoutErrors.length ? [...state.output.errors, ...timeoutErrors] : state.output.errors,
      ruleCount: state.output.ruleCount,
      stale: state.text !== text || state.configId !== configId,
      failure: state.failure,
    }),
    [state, timeoutErrors, text, configId],
  );
}

/** 在主线程中同步分析：没有 Worker 的环境（如单元测试）使用 */
export function useSyncAnalysis(text: string, library: KeywordLibrary, options: MatchOptions): AnalysisState {
  const analyzedText = useDeferredValue(text);
  const matcher = useMemo(() => compileLibrary(library, options), [library, options]);
  const result = useMemo(() => analyze(analyzedText, matcher), [analyzedText, matcher]);
  return useMemo(
    () => ({
      text: analyzedText,
      result,
      errors: matcher.errors,
      ruleCount: matcher.ruleCount,
      stale: analyzedText !== text,
      failure: null,
    }),
    [analyzedText, result, matcher, text],
  );
}

const TIMEOUT_RESULT: RegexTestResult = {
  matches: [],
  error: '执行超时：表达式在测试文本上运行太久，可能存在灾难性回溯，请改写',
  warnings: [],
  truncated: false,
};

interface TestInput {
  key: string;
  pattern: string;
  text: string;
  options: RegexOptions;
  limit: number;
}

export interface RegexTestState {
  result: RegexTestResult;
  /** 结果所对应的测试文本（新结果返回前沿用上一次的，保证高亮位置一致） */
  text: string;
  /** 已有更新的输入在计算中 */
  pending: boolean;
}

/** 在 Worker 中试运行正则（带超时）；首个结果返回前为 null */
export function useWorkerRegexTest(
  pattern: string,
  text: string,
  options: RegexOptions,
  limit: number,
  { createTransport = createDefaultTransport, timeoutMs = REGEX_TEST_TIMEOUT_MS }: EngineOptions = {},
): RegexTestState | null {
  const [state, setState] = useState<{ key: string; text: string; result: RegexTestResult } | null>(null);
  const engine = useEngine(createTransport);
  const key = JSON.stringify([pattern, text, options.caseSensitive, options.normalizeWidth, limit]);

  const runner = useRef<LatestRunner<TestInput> | null>(null);
  runner.current ??= new LatestRunner<TestInput>(async (input) => {
    const client = engine.current;
    if (!client) return;
    try {
      const response = await client.request(
        { type: 'test', pattern: input.pattern, text: input.text, options: input.options, limit: input.limit },
        timeoutMs,
      );
      if (response.type === 'tested') setState({ key: input.key, text: input.text, result: response.result });
    } catch (error) {
      if (error instanceof EngineTimeoutError) setState({ key: input.key, text: input.text, result: TIMEOUT_RESULT });
    }
  });

  // key 已涵盖全部输入，只在它变化时提交
  useEffect(() => {
    runner.current!.submit({ key, pattern, text, options, limit });
  }, [key, engine]);

  return useMemo(
    () => (state ? { result: state.result, text: state.text, pending: state.key !== key } : null),
    [state, key],
  );
}

export function useSyncRegexTest(pattern: string, text: string, options: RegexOptions, limit: number): RegexTestState {
  return useMemo(
    () => ({ result: testRegex(pattern, text, options, limit), text, pending: false }),
    [pattern, text, options, limit],
  );
}

const workerSupported = typeof Worker === 'function';

/** 有 Worker 时在后台分析，否则同步分析 */
export const useAnalysis: (text: string, library: KeywordLibrary, options: MatchOptions) => AnalysisState = workerSupported
  ? (text, library, options) => useWorkerAnalysis(text, library, options)
  : useSyncAnalysis;

export const useRegexTest: (pattern: string, text: string, options: RegexOptions, limit: number) => RegexTestState | null =
  workerSupported ? (pattern, text, options, limit) => useWorkerRegexTest(pattern, text, options, limit) : useSyncRegexTest;

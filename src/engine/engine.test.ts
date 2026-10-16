import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLibrary } from '../core/testUtils';
import { DEFAULT_MATCH_OPTIONS } from '../core/types';
import { EngineAbortError, EngineClient, EngineTimeoutError } from './client';
import { createEngineCore } from './core';
import type { EngineResponse } from './protocol';
import { FakeTransport } from './testTransport';

const library = makeLibrary({ t: ['芯片'], pii: ['re:\\d{3}', 're:(bad'] });

describe('engine core', () => {
  it('reports progress before each regex rule and returns hits, errors and rule count', () => {
    const responses: EngineResponse[] = [];
    const handle = createEngineCore((r) => responses.push(r));
    handle({ type: 'analyze', id: 1, configId: 1, library, options: DEFAULT_MATCH_OPTIONS, text: '芯片 123' });

    expect(responses.filter((r) => r.type === 'progress')).toEqual([{ type: 'progress', id: 1, ruleKey: 'pii::pii0' }]);
    const done = responses.at(-1)!;
    expect(done.type).toBe('analyzed');
    if (done.type !== 'analyzed') return;
    expect(done.output.result.hits.map((h) => h.text)).toEqual(['芯片', '123']);
    expect(done.output.errors.map((e) => e.keywordId)).toEqual(['pii1']);
    expect(done.output.ruleCount).toBe(2);
  });

  it('reuses the compiled matcher while the config id is unchanged', () => {
    const responses: EngineResponse[] = [];
    const handle = createEngineCore((r) => responses.push(r));
    const other = makeLibrary({ t: ['算力'] });
    handle({ type: 'analyze', id: 1, configId: 7, library, options: DEFAULT_MATCH_OPTIONS, text: '芯片' });
    handle({ type: 'analyze', id: 2, configId: 7, library: other, options: DEFAULT_MATCH_OPTIONS, text: '芯片' });
    handle({ type: 'analyze', id: 3, configId: 8, library: other, options: DEFAULT_MATCH_OPTIONS, text: '芯片' });
    const hitCounts = responses.filter((r) => r.type === 'analyzed').map((r) => r.type === 'analyzed' && r.output.result.hits.length);
    expect(hitCounts).toEqual([1, 1, 0]);
  });

  it('runs regex tests and turns exceptions into failure messages', () => {
    const responses: EngineResponse[] = [];
    const handle = createEngineCore((r) => responses.push(r));
    handle({ type: 'test', id: 1, pattern: '\\d+', text: 'a12', options: DEFAULT_MATCH_OPTIONS, limit: 10 });
    handle({ type: 'analyze', id: 2, configId: 9, library: null as never, options: DEFAULT_MATCH_OPTIONS, text: 'x' });
    expect(responses[0]).toMatchObject({ type: 'tested', id: 1, result: { matches: [{ text: '12' }] } });
    expect(responses[1]).toMatchObject({ type: 'failed', id: 2 });
  });
});

describe('EngineClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const analyzeRequest = (lib = library) =>
    ({ type: 'analyze', configId: 1, library: lib, options: DEFAULT_MATCH_OPTIONS, text: '芯片 123' }) as const;

  it('resolves with the worker response', async () => {
    const client = new EngineClient(() => new FakeTransport());
    const response = await client.request(analyzeRequest(), 1000);
    expect(response.type).toBe('analyzed');
  });

  it('times out with the rule that was running, terminates the worker and recreates it on demand', async () => {
    const transports: FakeTransport[] = [];
    const client = new EngineClient(() => {
      const transport = new FakeTransport('\\d{3}');
      transports.push(transport);
      return transport;
    });

    const hanging = client.request(analyzeRequest(), 1000);
    const queued = client.request({ type: 'test', pattern: 'a', text: 'a', options: DEFAULT_MATCH_OPTIONS, limit: 1 }, 5000);
    const outcome = expect(hanging).rejects.toEqual(new EngineTimeoutError('pii::pii0'));
    const aborted = expect(queued).rejects.toBeInstanceOf(EngineAbortError);
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
    await aborted;
    expect(transports[0].terminated).toBe(true);

    const next = client.request(analyzeRequest(makeLibrary({ t: ['芯片'] })), 1000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(next).resolves.toMatchObject({ type: 'analyzed' });
    expect(transports).toHaveLength(2);
  });

  it('rejects when the transport cannot be created', async () => {
    const client = new EngineClient(() => {
      throw new Error('blocked');
    });
    await expect(client.request(analyzeRequest(), 1000)).rejects.toThrow('blocked');
  });

  it('aborts pending requests on dispose', async () => {
    const client = new EngineClient(() => new FakeTransport('\\d{3}'));
    const pending = client.request(analyzeRequest(), 1000);
    client.dispose();
    await expect(pending).rejects.toBeInstanceOf(EngineAbortError);
  });
});

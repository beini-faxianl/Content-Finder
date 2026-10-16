import { describe, expect, it } from 'vitest';
import { analyze, compileLibrary, hasNestedQuantifier, MAX_REGEX_MATCHES, testRegex, validateRegex } from './matcher';
import { makeLibrary } from './testUtils';
import { DEFAULT_MATCH_OPTIONS, type Hit, type MatchOptions } from './types';

const run = (spec: Parameters<typeof makeLibrary>[0], text: string, options: Partial<MatchOptions> = {}) =>
  analyze(text, compileLibrary(makeLibrary(spec), { ...DEFAULT_MATCH_OPTIONS, ...options }));

const spans = (result: { hits: Hit[] }) => result.hits.map((h) => h.text);

describe('compileLibrary + analyze', () => {
  it('finds keywords from multiple categories with positions', () => {
    const { hits } = run({ tech: ['芯片', '算力'], region: ['北京'] }, '北京的芯片公司缺算力');
    expect(hits.map((h) => [h.start, h.end, h.entries[0].categoryId])).toEqual([
      [0, 2, 'region'],
      [3, 5, 'tech'],
      [8, 10, 'tech'],
    ]);
  });

  it('is case-insensitive by default and case-sensitive on demand', () => {
    expect(spans(run({ t: ['GPU'] }, 'gpu 与 GPU'))).toEqual(['gpu', 'GPU']);
    expect(spans(run({ t: ['GPU'] }, 'gpu 与 GPU', { caseSensitive: true }))).toEqual(['GPU']);
  });

  it('applies whole-word boundaries only to Latin edges', () => {
    const text = 'He said OpenAI ships AI芯片, AI-based tools';
    expect(spans(run({ t: ['AI'] }, text))).toEqual(['AI', 'AI']);
    expect(run({ t: ['AI'] }, text, { wholeWord: false }).hits).toHaveLength(4);
    // 中文关键词不受整词约束
    expect(spans(run({ t: ['芯片'] }, 'AI芯片厂'))).toEqual(['芯片']);
  });

  it('normalizes full-width characters while keeping original text and offsets', () => {
    const { hits } = run({ t: ['AI', '100%'] }, '全角ＡＩ与１００％');
    expect(hits.map((h) => [h.text, h.start, h.end])).toEqual([
      ['ＡＩ', 2, 4],
      ['１００％', 5, 9],
    ]);
    expect(run({ t: ['AI'] }, '全角ＡＩ', { normalizeWidth: false }).hits).toHaveLength(0);
  });

  it('prefers leftmost-longest matches by default', () => {
    expect(spans(run({ t: ['人工智能', '智能', '人工'] }, '人工智能'))).toEqual(['人工智能']);
  });

  it('keeps nested and crossing matches with overlap = all', () => {
    const { hits } = run({ t: ['人工智能', '智能', '能源'] }, '人工智能源', { overlap: 'all' });
    expect(hits.map((h) => h.text)).toEqual(['人工智能', '智能', '能源']);
    expect(hits.map((h) => h.id)).toEqual([0, 1, 2]);
  });

  it('merges the same span from several categories into one hit, ordered by category', () => {
    const { hits } = run({ a: ['焦虑'], b: ['焦虑', '焦'] }, '很焦虑');
    expect(hits).toHaveLength(1);
    expect(hits[0].entries).toEqual([
      { categoryId: 'a', keywordId: 'a0' },
      { categoryId: 'b', keywordId: 'b0' },
    ]);
  });

  it('skips disabled categories and blank keywords', () => {
    const { hits } = run({ off: { terms: ['北京'], enabled: false }, on: ['  ', '上海'] }, '北京上海');
    expect(spans({ hits })).toEqual(['上海']);
  });

  it('dedupes keywords that normalize to the same term within a category', () => {
    const matcher = compileLibrary(makeLibrary({ t: ['AI', 'ai', 'ＡＩ'] }), DEFAULT_MATCH_OPTIONS);
    expect(matcher.ruleCount).toBe(1);
    expect(analyze('ai', matcher).hits[0].entries).toHaveLength(1);
  });

  it('runs regex rules and reports invalid ones without throwing', () => {
    const matcher = compileLibrary(
      makeLibrary({ pii: ['re:(?<!\\d)1[3-9]\\d{9}(?!\\d)', 're:([a-z'] }),
      DEFAULT_MATCH_OPTIONS,
    );
    expect(matcher.errors).toHaveLength(1);
    expect(matcher.errors[0].keywordId).toBe('pii1');
    expect(spans(analyze('电话13800138000，编号213800138000', matcher))).toEqual(['13800138000']);
  });

  it('lets regex and text rules overlap-resolve together', () => {
    const { hits } = run({ a: ['电话'], b: ['re:电话\\d+'] }, '电话123');
    expect(spans({ hits })).toEqual(['电话123']);
    expect(hits[0].entries[0].categoryId).toBe('b');
  });

  it('survives zero-length regex matches and truncates runaway patterns', () => {
    expect(run({ r: ['re:x*'] }, 'abxxc').hits.map((h) => h.text)).toEqual(['xx']);
    const result = run({ r: ['re:.'] }, 'a'.repeat(MAX_REGEX_MATCHES + 10));
    expect(result.truncated).toBe(true);
    expect(result.hits).toHaveLength(MAX_REGEX_MATCHES);
  });

  it('handles empty text and empty library', () => {
    expect(run({ t: ['a'] }, '').hits).toEqual([]);
    expect(run({}, 'anything').hits).toEqual([]);
  });

  it('scales to long texts and big libraries', () => {
    const terms = Array.from({ length: 5000 }, (_, i) => `词${i}号`);
    const text = '这是一段很长的文本，包含词42号与词4999号。'.repeat(5000);
    const result = run({ big: terms }, text);
    expect(result.hits).toHaveLength(10000);
  });
});

describe('exclusions', () => {
  const ad = (exclusions: string[], terms = ['最佳', '最好']) => ({ terms, exclusions });

  it('drops hits that fall entirely inside an exclusion phrase of the same category', () => {
    const result = run({ ad: ad(['最佳实践', '最好先']) }, '最佳实践很重要，最好先试试，这是最好的');
    expect(spans(result)).toEqual(['最好']);
    expect(result.hits[0].start).toBe(16);
    expect(result.excluded).toEqual({ ad: 2 });
  });

  it('only affects the category that owns the exclusion', () => {
    const result = run({ ad: ad(['最佳实践']), other: ['最佳'] }, '最佳实践');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].entries.map((e) => e.categoryId)).toEqual(['other']);
  });

  it('keeps hits that only partially overlap an exclusion', () => {
    expect(spans(run({ ad: ad(['佳实'], ['最佳']) }, '最佳实践'))).toEqual(['最佳']);
  });

  it('normalizes case and width like keywords, and applies to regex rules', () => {
    expect(run({ t: { terms: ['AI'], exclusions: ['ai助手'] } }, 'ＡＩ助手与 AI').hits.map((h) => h.start)).toEqual([6]);
    const regex = run({ pii: { terms: ['re:\\d{11}'], exclusions: ['测试号 13800138000'] } }, '测试号 13800138000，真实 13912345678');
    expect(spans(regex)).toEqual(['13912345678']);
  });

  it('removes excluded candidates before overlap resolution', () => {
    // 「人工智能」被排除后，原本会被它挡住的「智能体」得以保留
    const result = run({ a: { terms: ['人工智能'], exclusions: ['人工智能体'] }, b: ['智能体'] }, '人工智能体');
    expect(spans(result)).toEqual(['智能体']);
  });

  it('ignores exclusions of disabled categories', () => {
    const result = run({ off: { terms: ['x'], exclusions: ['最佳实践'], enabled: false }, ad: ['最佳'] }, '最佳实践');
    expect(spans(result)).toEqual(['最佳']);
    expect(result.excluded).toEqual({});
  });
});

describe('matching through encodings', () => {
  it('finds keywords hidden in URL encoding and reports hits on the original text', () => {
    const result = run(
      { pii: ['re:[\\w.]+@[\\w.]+\\.\\w+', '手机'] },
      'q=%E6%89%8B%E6%9C%BA&email=zhangsan%40example.com',
    );
    expect(result.hits.map((h) => [h.text, h.decoded])).toEqual([
      ['%E6%89%8B%E6%9C%BA', '手机'],
      ['zhangsan%40example.com', 'zhangsan@example.com'],
    ]);
    expect(result.decoded).toEqual({ url: 2, unicode: 0, html: 0 });
  });

  it('decodes \\u escapes and HTML entities, and leaves plain hits as they are', () => {
    const result = run({ t: ['李四', '<script', '芯片'] }, '{"n":"\\u674e\\u56db"} &lt;script&gt; 芯片');
    expect(result.hits.map((h) => [h.text, h.decoded])).toEqual([
      ['\\u674e\\u56db', '李四'],
      ['&lt;script', '<script'],
      ['芯片', undefined],
    ]);
  });

  it('can be turned off', () => {
    expect(run({ t: ['手机'] }, '%E6%89%8B%E6%9C%BA', { decode: false }).hits).toEqual([]);
  });

  it('maps regex test matches back to the original text', () => {
    expect(testRegex('\\d{2}', 'a%31%32b', DEFAULT_MATCH_OPTIONS).matches).toEqual([{ start: 1, end: 7, text: '%31%32' }]);
  });
});

describe('per-category overrides', () => {
  it('lets one category match substrings while others keep whole-word matching', () => {
    const result = run({ prose: ['AI'], code: { terms: ['password'], wholeWord: false } }, 'said db_password dbPassword AI');
    expect(spans(result)).toEqual(['password', 'Password', 'AI']);
  });

  it('lets one category be case-sensitive', () => {
    const result = run({ markers: { terms: ['TODO'], caseSensitive: true }, words: ['todo list'] }, '# TODO fix; my todo list, ToDo');
    expect(spans(result)).toEqual(['TODO', 'todo list']);
  });

  it('applies the case override to regex rules and exclusions too', () => {
    const library = { k: { terms: ['re:AKIA[0-9A-Z]{4}'], caseSensitive: true, exclusions: ['AKIAEXAM'] } };
    expect(spans(run(library, 'akia1234 AKIA1234 AKIAEXAM'))).toEqual(['AKIA1234']);
  });
});

describe('hasNestedQuantifier', () => {
  it.each(['(a+)+$', '(\\w*)*', '(?:\\d+)+', '((ab)*)+', '(x+){2,}', '(a+)+?'])('flags %s', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(true);
  });

  it.each(['(?:,\\d{3})*', '(哈|呵)+', '(.)\\1{2,}', '[(a+)]+', '\\(a+\\)+', '(a{2,5})+', '\\d+(?:\\.\\d+)?'])(
    'does not flag %s',
    (pattern) => {
      expect(hasNestedQuantifier(pattern)).toBe(false);
    },
  );
});

describe('regex flags', () => {
  it('treats ^ and $ as line anchors', () => {
    expect(spans(run({ r: ['re:^\\d+'] }, '12 a\n34 b\nc 56'))).toEqual(['12', '34']);
    expect(spans(run({ r: ['re:\\d+$'] }, '12 a\nb 34\nc 56'))).toEqual(['34', '56']);
  });
});

describe('testRegex', () => {
  const opts = DEFAULT_MATCH_OPTIONS;

  it('returns matches with original text, using width normalization', () => {
    const result = testRegex('\\d+%', '增长 ３０％，降 5%', opts);
    expect(result.matches.map((m) => [m.text, m.start])).toEqual([
      ['３０％', 3],
      ['5%', 9],
    ]);
    expect(result.error).toBeNull();
  });

  it('reports syntax errors instead of throwing', () => {
    const result = testRegex('(abc', 'abc', opts);
    expect(result.error).toMatch(/./);
    expect(result.matches).toEqual([]);
  });

  it('warns about lone full-width characters and empty matches', () => {
    expect(testRegex('好！', '好!', opts).warnings[0]).toMatch(/全角字符「！」/);
    expect(testRegex('[:：]', '', opts).warnings).toEqual([]);
    expect(testRegex('好！', '好！', { ...opts, normalizeWidth: false }).warnings).toEqual([]);
    expect(testRegex('x*', 'axx', opts).warnings).toEqual(['表达式可以匹配空字符串，空匹配不会被计为命中']);
  });

  it('treats an empty pattern as no-op and respects the limit', () => {
    expect(testRegex('', 'abc', opts)).toEqual({ matches: [], error: null, warnings: [], truncated: false });
    const limited = testRegex('a', 'aaaa', opts, 2);
    expect(limited.matches).toHaveLength(2);
    expect(limited.truncated).toBe(true);
  });
});

describe('validateRegex', () => {
  it('accepts valid patterns, including ones only valid without the u flag', () => {
    expect(validateRegex('\\d{3}')).toBeNull();
    expect(validateRegex('a\\-b')).toBeNull();
  });

  it('rejects broken or empty patterns', () => {
    expect(validateRegex('([a')).toMatch(/./);
    expect(validateRegex('  ')).toBe('正则表达式不能为空');
  });
});

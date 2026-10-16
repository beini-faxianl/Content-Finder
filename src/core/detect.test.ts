import { describe, expect, it } from 'vitest';
import { SAMPLES } from '../data/samples';
import { detectContentKind } from './detect';

describe('detectContentKind', () => {
  it('recognizes HTTP requests and responses by their first line', () => {
    expect(detectContentKind('POST /api/login HTTP/1.1\nHost: a.com\n\nx=1')).toBe('http-request');
    expect(detectContentKind('\nHTTP/1.1 404 Not Found\nServer: x')).toBe('http-response');
    expect(detectContentKind('### [1/2] GET https://a.com\nGET / HTTP/2\nHost: a.com')).toBe('http-request');
  });

  it('recognizes JSON and code', () => {
    expect(detectContentKind('  {"a": [1, 2], "b": "c"}  ')).toBe('json');
    expect(detectContentKind('import os\n\ndef main():\n    x = 1\n    return x\n')).toBe('code');
    expect(detectContentKind('const a = 1;\nfunction f() {\n  return a;\n}\n')).toBe('code');
  });

  it('treats prose, including the built-in prose samples, as text', () => {
    expect(detectContentKind('这是一段普通的中文内容。\n第二段也很普通。\n第三段。')).toBe('text');
    expect(detectContentKind('{这不是 JSON')).toBe('text');
    for (const sample of SAMPLES.filter((s) => !s.id.startsWith('http') && s.id !== 'code-config')) {
      expect(detectContentKind(sample.text), sample.id).toBe('text');
    }
  });
});

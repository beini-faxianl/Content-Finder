import { describe, expect, it } from 'vitest';
import { detectContentKind } from './detect';
import { harToText, isHar } from './har';

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

const har = {
  log: {
    version: '1.2',
    entries: [
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/v1/profile?lang=zh',
          httpVersion: 'h2',
          headers: [
            { name: ':authority', value: 'api.example.com' },
            { name: 'content-type', value: 'application/x-www-form-urlencoded' },
          ],
          postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'phone', value: '13800138000' }] },
        },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'h2',
          headers: [{ name: 'content-type', value: 'application/json' }],
          content: { mimeType: 'application/json; charset=utf-8', encoding: 'base64', text: b64('{"name":"张三"}') },
        },
      },
      {
        request: { method: 'GET', url: 'https://cdn.example.com/a.png', httpVersion: 'HTTP/1.1', headers: [] },
        response: { status: 200, statusText: 'OK', headers: [], content: { mimeType: 'image/png', size: 2048, text: 'iVBOR' } },
      },
    ],
  },
};

describe('harToText', () => {
  it('turns entries into readable raw HTTP messages', () => {
    const { text, entries } = harToText(har);
    expect(entries).toBe(2);
    expect(text).toContain('### [1/2] POST https://api.example.com/v1/profile?lang=zh → 200 OK');
    expect(text).toContain('POST /v1/profile?lang=zh HTTP/2\nHost: api.example.com\ncontent-type: application/x-www-form-urlencoded');
    expect(text).not.toContain(':authority');
    expect(text).toContain('\n\nphone=13800138000');
    expect(text).toContain('HTTP/2 200 OK\ncontent-type: application/json\n\n{"name":"张三"}');
    expect(text).toContain('[非文本内容：image/png，2.0 KB，已省略]');
  });

  it('omits binary bodies without a declared type and decodes GBK text bodies', () => {
    const entry = (content: Record<string, unknown>) => ({
      request: { method: 'GET', url: 'https://example.com/x', headers: [] },
      response: { status: 200, statusText: 'OK', headers: [], content },
    });
    const binary = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02));
    const gbk = btoa(String.fromCharCode(0xca, 0xd6, 0xbb, 0xfa)); // 「手机」的 GBK 编码
    const { text } = harToText({
      log: { entries: [entry({ encoding: 'base64', size: 7, text: binary }), entry({ mimeType: 'text/html', encoding: 'base64', text: gbk })] },
    });
    expect(text).toContain('[非文本内容：未知类型，7 B，已省略]');
    expect(text).not.toContain('\u0000');
    expect(text).toContain('\n\n手机');
  });

  it('produces text that is recognized as an HTTP request', () => {
    expect(detectContentKind(harToText(har).text)).toBe('http-request');
  });

  it('detects HAR documents and rejects other JSON', () => {
    expect(isHar(har)).toBe(true);
    expect(isHar({ log: {} })).toBe(false);
    expect(() => harToText({ a: 1 })).toThrow(/HAR/);
  });
});

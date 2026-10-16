import { describe, expect, it } from 'vitest';
import { decodeForMatching, mapToOriginal } from './decode';

/** 解码后，把每个码元映射回原文，便于断言 */
const spans = (text: string) => {
  const r = decodeForMatching(text);
  return [...r.text].map((ch, i) => [ch, text.slice(...mapToOriginal(r, i, i + 1))]);
};

describe('decodeForMatching', () => {
  it('leaves plain text untouched and reports no mapping', () => {
    const r = decodeForMatching('普通文本，100% 满意，a & b; C:\\Users');
    expect(r.text).toBe('普通文本，100% 满意，a & b; C:\\Users');
    expect(r.starts).toBeNull();
    expect(r.counts).toEqual({ url: 0, unicode: 0, html: 0 });
  });

  it('decodes percent-encoded UTF-8 and maps each character back to its bytes', () => {
    expect(spans('n=%E5%BC%A0%E4%B8%89&e=a%40b')).toEqual([
      ['n', 'n'],
      ['=', '='],
      ['张', '%E5%BC%A0'],
      ['三', '%E4%B8%89'],
      ['&', '&'],
      ['e', 'e'],
      ['=', '='],
      ['a', 'a'],
      ['@', '%40'],
      ['b', 'b'],
    ]);
  });

  it('keeps invalid or incomplete percent sequences as they are', () => {
    expect(decodeForMatching('%E6%89 与 %zz 与 100%').text).toBe('%E6%89 与 %zz 与 100%');
    expect(decodeForMatching('%E6%89%8B%E6').text).toBe('手%E6');
  });

  it('decodes \\u, \\u{…}, \\x and JSON escapes', () => {
    expect(decodeForMatching('\\u674e\\u56db').text).toBe('李四');
    expect(decodeForMatching('\\u{1F600}!').text).toBe('😀!');
    expect(decodeForMatching('\\xe6\\x89\\x8b \\xe9').text).toBe('手 é');
    expect(decodeForMatching('https:\\/\\/a.com \\"x\\"').text).toBe('https://a.com "x"');
  });

  it('unwraps escapes nested inside escaped strings (JSON inside JSON)', () => {
    // 外层 JSON 字符串里嵌着一段 JSON：第一层还原出 \u674e，第二层再还原成汉字
    const log = '{"body":"{\\"name\\":\\"\\\\u674e\\\\u56db\\"}"}';
    expect(decodeForMatching(log).text).toBe('{"body":"{"name":"李四"}"}');
  });

  it('decodes numeric and common named HTML entities', () => {
    expect(decodeForMatching('&lt;script&gt; &#x624b;&#26426; &amp;&nbsp;&unknown;').text).toBe(
      '<script> 手机 &\u00a0&unknown;',
    );
  });

  it('unwraps multiple layers and composes the position mapping', () => {
    const text = 'p=%252e%252e%252f';
    const r = decodeForMatching(text);
    expect(r.text).toBe('p=../');
    expect(text.slice(...mapToOriginal(r, 2, 5))).toBe('%252e%252e%252f');
    expect(r.counts.url).toBe(4); // 第一层 3 处 %25，第二层 1 段 %2e%2e%2f
  });

  it('maps a decoded range to the full original span', () => {
    const text = '邮箱 zhangsan%40example.com';
    const r = decodeForMatching(text);
    const start = r.text.indexOf('zhangsan');
    const end = start + 'zhangsan@example.com'.length;
    expect(text.slice(...mapToOriginal(r, start, end))).toBe('zhangsan%40example.com');
  });
});

/**
 * HAR（浏览器开发者工具导出的网络记录）→ 可读的原始 HTTP 报文。
 * 每个请求依次输出：请求行、请求头、请求体，再输出状态行、响应头、响应体。
 * base64 编码的文本响应会先解码；图片等二进制内容只保留类型与大小。
 */

import { decodeBytes } from './bytes';

export interface HarConversion {
  text: string;
  entries: number;
}

interface HarHeader {
  name?: unknown;
  value?: unknown;
}

const MAX_BODY_CHARS = 100_000;
const TEXT_MIME =
  /^(?:text\/|application\/(?:json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|x-ndjson|problem\+json)|[^;]*\+(?:json|xml)\b)/i;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);

/** 是否像 HAR：{ log: { entries: [...] } } */
export function isHar(value: unknown): boolean {
  return isRecord(value) && isRecord(value.log) && Array.isArray(value.log.entries);
}

function formatSize(bytes: unknown): string {
  const n = typeof bytes === 'number' && bytes > 0 ? bytes : 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function truncate(body: string): string {
  return body.length > MAX_BODY_CHARS
    ? `${body.slice(0, MAX_BODY_CHARS)}\n…（内容过长已截断，共 ${body.length.toLocaleString()} 字符）`
    : body;
}

function httpVersion(raw: unknown): string {
  const v = str(raw).trim();
  if (/^(?:h2|http\/2(?:\.0)?)$/i.test(v)) return 'HTTP/2';
  if (/^(?:h3|http\/3(?:\.0)?)$/i.test(v)) return 'HTTP/3';
  return /^http\/\d(?:\.\d)?$/i.test(v) ? v.toUpperCase() : 'HTTP/1.1';
}

/** 头部数组 → 「名称: 值」行；HTTP/2 的伪头部（:method 等）不输出 */
function headerLines(headers: unknown): string[] {
  if (!Array.isArray(headers)) return [];
  return headers
    .filter((h): h is HarHeader => isRecord(h) && typeof h.name === 'string' && !h.name.startsWith(':'))
    .map((h) => `${str(h.name)}: ${str(h.value)}`);
}

/** base64 → 字节；格式错误时抛出 */
function base64Bytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function requestBody(postData: unknown): string {
  if (!isRecord(postData)) return '';
  if (typeof postData.text === 'string' && postData.text) return truncate(postData.text);
  if (Array.isArray(postData.params)) {
    return postData.params
      .filter(isRecord)
      .map((p) => `${str(p.name)}=${str(p.value)}`)
      .join('&');
  }
  return '';
}

function responseBody(content: unknown): string {
  if (!isRecord(content) || typeof content.text !== 'string' || !content.text) return '';
  const mime = str(content.mimeType);
  const omitted = `[非文本内容：${mime || '未知类型'}，${formatSize(content.size)}，已省略]`;
  if (mime && !TEXT_MIME.test(mime)) return omitted;
  if (content.encoding === 'base64') {
    let bytes: Uint8Array;
    try {
      bytes = base64Bytes(content.text);
    } catch {
      return '[base64 内容无法解码，已省略]';
    }
    // 没有声明类型的响应可能是图片等二进制；文本则可能是 UTF-8 以外的编码（如 GBK）
    try {
      return truncate(decodeBytes(bytes));
    } catch {
      return omitted;
    }
  }
  return truncate(content.text);
}

export function harToText(har: unknown): HarConversion {
  if (!isHar(har)) throw new Error('不是有效的 HAR 文件：缺少 log.entries');
  const entries = ((har as { log: { entries: unknown[] } }).log.entries).filter(isRecord);

  const blocks = entries.map((entry, i) => {
    const request = isRecord(entry.request) ? entry.request : {};
    const response = isRecord(entry.response) ? entry.response : {};
    const method = str(request.method, 'GET');
    const rawUrl = str(request.url);
    let url: URL | null = null;
    try {
      url = new URL(rawUrl);
    } catch {
      url = null;
    }

    const status = str(response.status);
    const statusText = str(response.statusText);
    const lines = [`### [${i + 1}/${entries.length}] ${method} ${rawUrl}${status ? ` → ${status} ${statusText}`.trimEnd() : ''}`];

    lines.push(`${method} ${url ? url.pathname + url.search : rawUrl || '/'} ${httpVersion(request.httpVersion)}`);
    const headers = headerLines(request.headers);
    if (url && !headers.some((h) => /^host:/i.test(h))) headers.unshift(`Host: ${url.host}`);
    lines.push(...headers);
    const reqBody = requestBody(request.postData);
    if (reqBody) lines.push('', reqBody);

    if (status && status !== '0') {
      lines.push('', `${httpVersion(response.httpVersion)} ${status} ${statusText}`.trimEnd(), ...headerLines(response.headers));
      const resBody = responseBody(response.content);
      if (resBody) lines.push('', resBody);
    }
    return lines.join('\n');
  });

  return { text: blocks.join('\n\n\n'), entries: entries.length };
}

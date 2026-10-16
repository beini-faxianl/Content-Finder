import { decodeBytes } from '../core/bytes';
import { harToText, isHar } from '../core/har';

export { decodeBytes };

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** 常见的非纯文本格式：给出明确提示，而不是读出乱码 */
const UNSUPPORTED_EXTENSIONS = /\.(docx?|xlsx?|pptx?|pdf|zip|rar|7z|gz|png|jpe?g|gif|webp|ico|mp[34]|mov|exe|dll|so|class|jar)$/i;

export interface ReadTextOptions {
  /** HTML 文件：提取正文，或保留源码 */
  html: 'text' | 'source';
}

export interface ReadTextResult {
  text: string;
  /** 导入时做过的处理，例如 HAR 已转换为原始报文 */
  note?: string;
}

/**
 * 读取任意文本文件（代码、配置、日志、报文等均可）。
 * .har 会转换为可读的原始 HTTP 报文；HTML 按设置提取正文或保留源码。
 */
export async function readTextFile(file: File, options: ReadTextOptions = { html: 'text' }): Promise<ReadTextResult> {
  if (UNSUPPORTED_EXTENSIONS.test(file.name)) {
    throw new Error(`暂不支持 ${file.name.split('.').pop()} 格式，请先另存为文本文件`);
  }
  if (file.size > MAX_IMPORT_BYTES) throw new Error('文件过大，上限为 10 MB');

  const text = decodeBytes(new Uint8Array(await file.arrayBuffer())).replace(/\r\n?/g, '\n');

  if (/\.(har|json)$/i.test(file.name) && text.trimStart().startsWith('{') && text.includes('"entries"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (isHar(parsed)) {
        const { text: converted, entries } = harToText(parsed);
        return { text: converted, note: `已将 HAR 中的 ${entries} 个请求转换为原始报文` };
      }
    } catch {
      // 不是合法 JSON：按普通文本导入
    }
  }
  if (options.html === 'text' && /\.html?$/i.test(file.name)) {
    return { text: htmlToText(text), note: '已提取 HTML 正文；如需检查源码，可在设置中改为「保留源码」' };
  }
  return { text };
}

export function htmlToText(html: string): string {
  const withBreaks = html.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote|\/section|\/article)\b[^>]*>/gi, '$&\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  return (doc.body?.textContent ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // file:// 等非安全上下文下 Clipboard API 不可用，退回旧方案
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

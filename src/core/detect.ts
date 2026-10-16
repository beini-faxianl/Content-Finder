/** 粗略识别内容类型，用于提示切换到更合适的视图。只看开头一部分，速度与文本长度无关。 */

export type ContentKind = 'http-request' | 'http-response' | 'json' | 'code' | 'text';

export const CONTENT_KIND_LABEL: Record<ContentKind, string> = {
  'http-request': 'HTTP 请求',
  'http-response': 'HTTP 响应',
  json: 'JSON',
  code: '代码',
  text: '文本',
};

const REQUEST_LINE = /^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT) \S+ HTTP\/\d(?:\.\d)?$/;
const STATUS_LINE = /^HTTP\/\d(?:\.\d)? \d{3}\b/;
const CODE_LINE =
  /[;{}]\s*$|=>|^\s*(?:def|class|import|from|function|const|let|var|return|if|elif|else|for|while|public|private|protected|package|func|#include|using|namespace|@\w+)\b/;

const SAMPLE_LINES = 200;
const JSON_PARSE_LIMIT = 2_000_000;

export function detectContentKind(text: string): ContentKind {
  const head = text.slice(0, 20_000);
  const lines = head.split('\n', SAMPLE_LINES).map((l) => l.replace(/\r$/, ''));
  // 跳过空行与 HAR 转换产生的分隔说明行
  const meaningful = lines.filter((l) => l.trim() && !l.startsWith('###'));

  for (const line of meaningful.slice(0, 5)) {
    if (REQUEST_LINE.test(line)) return 'http-request';
    if (STATUS_LINE.test(line)) return 'http-response';
  }

  const trimmed = text.trim();
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length <= JSON_PARSE_LIMIT) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // 不是合法 JSON，继续判断是否像代码
    }
  }

  if (meaningful.length >= 3) {
    const codeLike = meaningful.filter((l) => CODE_LINE.test(l)).length;
    if (codeLike / meaningful.length >= 0.3) return 'code';
  }
  return 'text';
}

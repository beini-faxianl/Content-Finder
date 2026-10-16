/**
 * 文本归一化。所有函数都逐 UTF-16 码元一对一映射，输出与输入等长，
 * 因此在归一化文本上得到的命中位置可以直接对应回原文。
 */

const CHUNK = 8192;

function fromCodes(codes: Uint16Array): string {
  let out = '';
  for (let i = 0; i < codes.length; i += CHUNK) {
    out += String.fromCharCode(...codes.subarray(i, i + CHUNK));
  }
  return out;
}

/** 全角 ASCII（！～）与全角空格转为半角 */
export function normalizeWidth(text: string): string {
  let changed = false;
  const codes = new Uint16Array(text.length);
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xff01 && code <= 0xff5e) {
      code -= 0xfee0;
      changed = true;
    } else if (code === 0x3000) {
      code = 0x20;
      changed = true;
    }
    codes[i] = code;
  }
  return changed ? fromCodes(codes) : text;
}

const foldCache = new Map<number, number>();

function foldCode(code: number): number {
  if (code < 0x80) return code >= 65 && code <= 90 ? code + 32 : code;
  let folded = foldCache.get(code);
  if (folded === undefined) {
    const lower = String.fromCharCode(code).toLowerCase();
    // 个别字符（如 "İ"）小写后长度会变化，保持原样以维持下标对齐
    folded = lower.length === 1 ? lower.charCodeAt(0) : code;
    foldCache.set(code, folded);
  }
  return folded;
}

/** 等长的小写折叠 */
export function foldCase(text: string): string {
  const codes = new Uint16Array(text.length);
  for (let i = 0; i < text.length; i++) codes[i] = foldCode(text.charCodeAt(i));
  return fromCodes(codes);
}

/**
 * 是否为"单词字符"：ASCII 字母数字下划线、拉丁扩展、希腊与西里尔字母。
 * 中日韩文字不算——中文没有空格分词，不应受整词规则约束。
 */
export function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95 ||
    (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7) ||
    (code >= 0x370 && code <= 0x52f)
  );
}

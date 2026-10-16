/**
 * 变体写法识别：去掉夹在字与字之间的「干扰字符」后再匹配中文关键词，
 * 识别「全 网 第 一」「最★低★价」「微❤信」这类为规避检测而插入空格、符号、表情的写法。
 *
 * 干扰字符包括空白、零宽字符、各类符号与表情；不包括换行和句读标点（，。、；：！？及其半角形式），
 * 否则会把相邻的两句话拼成误报，例如「全网，第一时间送达」。
 */

/** 去掉干扰字符后的文本，以及每个码元在原文本中的下标 */
export interface StrippedText {
  text: string;
  map: Int32Array;
}

const SEPARATOR =
  /[\p{Zs}\t\u00ad\u200b-\u200f\u2060\ufeff\ufe0e\ufe0f*\-_~^`|/\\#@+=<>"'()[\]{}&$·・•°\p{So}\p{Sk}\p{Sm}\p{Extended_Pictographic}]/u;

const cache = new Map<number, boolean>();

export function isSeparator(codePoint: number): boolean {
  let result = cache.get(codePoint);
  if (result === undefined) {
    result = SEPARATOR.test(String.fromCodePoint(codePoint));
    cache.set(codePoint, result);
  }
  return result;
}

const CJK = /[㐀-䶿一-鿿豈-﫿]/;

/** 只有含中文的关键词参与变体识别：英文单词之间本来就有空格，去掉后极易拼出误报（如 a I → AI） */
export function supportsVariants(term: string): boolean {
  return CJK.test(term) && [...term].length >= 2;
}

/** 去掉干扰字符；没有任何干扰字符时返回 null */
export function stripSeparators(text: string): StrippedText | null {
  const codes = new Uint16Array(text.length);
  const map = new Int32Array(text.length);
  let length = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    if (!isSeparator(cp)) {
      for (let k = 0; k < width; k++) {
        codes[length] = text.charCodeAt(i + k);
        map[length] = i + k;
        length++;
      }
    }
    i += width;
  }
  if (length === text.length) return null;

  let stripped = '';
  for (let i = 0; i < length; i += 8192) stripped += String.fromCharCode(...codes.subarray(i, Math.min(length, i + 8192)));
  return { text: stripped, map: map.slice(0, length) };
}

/** 去掉一段文本中的干扰字符（用于展示变体命中的「本来面目」） */
export function compact(text: string): string {
  return stripSeparators(text)?.text ?? text;
}

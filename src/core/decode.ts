/**
 * 匹配前的解码：URL 编码（%E6%89%8B）、\u / \x 转义（手、\xe6\x89\x8b）、
 * JSON 中的 \/ \" \\ 以及 HTML 实体（&lt; &#x624b;）。
 *
 * 与 normalize.ts 的等长归一化不同，解码会改变长度，所以同时生成位置映射：
 * 解码文本中的每个 UTF-16 码元都记录着它来自原文的哪一段。命中在解码文本中找到，
 * 再映射回原文高亮——用户看到的是原始报文，关键词却能穿透编码命中。
 */

import type { DecodedCounts } from './types';

export type EncodingKind = keyof DecodedCounts;

export interface DecodeResult {
  /** 解码后的文本 */
  text: string;
  /** 解码文本第 i 个码元对应的原文区间 [starts[i], ends[i])；没有任何内容被解码时为 null */
  starts: Int32Array | null;
  ends: Int32Array | null;
  /** 各类编码被解码的次数（多层编码会分别计数） */
  counts: DecodedCounts;
}

/** 多层编码（如 %252e → %2e → .）最多解几层 */
const MAX_PASSES = 3;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  middot: '·',
  bull: '•',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  yen: '¥',
  euro: '€',
  pound: '£',
  cent: '¢',
  sect: '§',
  para: '¶',
};

const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

/** 单遍解码的输出缓冲：解码只会缩短文本，按原文长度预分配即可 */
class Output {
  readonly codes: Uint16Array;
  readonly starts: Int32Array;
  readonly ends: Int32Array;
  length = 0;

  constructor(capacity: number) {
    this.codes = new Uint16Array(capacity);
    this.starts = new Int32Array(capacity);
    this.ends = new Int32Array(capacity);
  }

  push(code: number, start: number, end: number): void {
    this.codes[this.length] = code;
    this.starts[this.length] = start;
    this.ends[this.length] = end;
    this.length++;
  }

  pushCodePoint(cp: number, start: number, end: number): void {
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      this.push(0xd800 + (v >> 10), start, end);
      this.push(0xdc00 + (v & 0x3ff), start, end);
    } else {
      this.push(cp, start, end);
    }
  }

  /** 原样输出原文 [start, end) */
  pushLiteral(src: string, start: number, end: number): void {
    for (let k = start; k < end; k++) this.push(src.charCodeAt(k), k, k + 1);
  }
}

/**
 * 把一串字节按 UTF-8 解码输出。offsets[k] 为第 k 个字节在原文中的起点，每个字节占 width 个原文字符。
 * 非法序列：fallback = 'literal' 时原样输出该字节对应的原文，'latin1' 时按 Latin-1 解释（\xHH 的语义）。
 */
function emitUtf8(
  out: Output,
  src: string,
  bytes: number[],
  offsets: number[],
  width: number,
  fallback: 'literal' | 'latin1',
): void {
  for (let k = 0; k < bytes.length; ) {
    const b0 = bytes[k];
    let need = -1;
    let cp = 0;
    let min = 0;
    if (b0 < 0x80) {
      need = 0;
      cp = b0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      cp = b0 & 0x1f;
      min = 0x80;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      cp = b0 & 0x0f;
      min = 0x800;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      cp = b0 & 0x07;
      min = 0x10000;
    }

    let valid = need >= 0 && k + need < bytes.length;
    for (let n = 1; valid && n <= need; n++) {
      const b = bytes[k + n];
      if ((b & 0xc0) !== 0x80) valid = false;
      else cp = (cp << 6) | (b & 0x3f);
    }
    if (valid && need > 0 && (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))) valid = false;

    if (valid) {
      out.pushCodePoint(cp, offsets[k], offsets[k + need] + width);
      k += need + 1;
    } else {
      if (fallback === 'latin1') out.push(b0, offsets[k], offsets[k] + width);
      else out.pushLiteral(src, offsets[k], offsets[k] + width);
      k += 1;
    }
  }
}

/** 单遍解码；没有任何可解码的内容时返回 null */
function decodeOnce(src: string, counts: DecodedCounts): Output | null {
  const out = new Output(src.length);
  let changed = false;
  let i = 0;

  while (i < src.length) {
    const c = src.charCodeAt(i);

    // %XX 连续字节
    if (c === 37 && i + 2 < src.length && isHex(src.charCodeAt(i + 1)) && isHex(src.charCodeAt(i + 2))) {
      const bytes: number[] = [];
      const offsets: number[] = [];
      let j = i;
      while (j + 2 < src.length && src.charCodeAt(j) === 37 && isHex(src.charCodeAt(j + 1)) && isHex(src.charCodeAt(j + 2))) {
        bytes.push(parseInt(src.slice(j + 1, j + 3), 16));
        offsets.push(j);
        j += 3;
      }
      const before = out.length;
      emitUtf8(out, src, bytes, offsets, 3, 'literal');
      // 成功解码的字节一定会缩短输出；长度不变说明全是非法序列、已原样输出
      if (out.length !== before + bytes.length * 3) {
        changed = true;
        counts.url++;
      }
      i = j;
      continue;
    }

    if (c === 92 && i + 1 < src.length) {
      const n = src.charCodeAt(i + 1);
      // \uXXXX 或 \u{X…}
      if (n === 117) {
        if (src.charCodeAt(i + 2) === 123) {
          const close = src.indexOf('}', i + 3);
          const hex = close > 0 ? src.slice(i + 3, close) : '';
          if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
            const cp = parseInt(hex, 16);
            if (cp <= 0x10ffff) {
              out.pushCodePoint(cp, i, close + 1);
              changed = true;
              counts.unicode++;
              i = close + 1;
              continue;
            }
          }
        } else if (i + 5 < src.length && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          out.push(parseInt(src.slice(i + 2, i + 6), 16), i, i + 6);
          changed = true;
          counts.unicode++;
          i += 6;
          continue;
        }
      }
      // \xHH 连续字节：先按 UTF-8 解，失败再按 Latin-1
      if (n === 120 && i + 3 < src.length && isHex(src.charCodeAt(i + 2)) && isHex(src.charCodeAt(i + 3))) {
        const bytes: number[] = [];
        const offsets: number[] = [];
        let j = i;
        while (
          j + 3 < src.length &&
          src.charCodeAt(j) === 92 &&
          src.charCodeAt(j + 1) === 120 &&
          isHex(src.charCodeAt(j + 2)) &&
          isHex(src.charCodeAt(j + 3))
        ) {
          bytes.push(parseInt(src.slice(j + 2, j + 4), 16));
          offsets.push(j);
          j += 4;
        }
        emitUtf8(out, src, bytes, offsets, 4, 'latin1');
        changed = true;
        counts.unicode++;
        i = j;
        continue;
      }
      // JSON / JS 中的 \/ \" \' \\
      if (n === 47 || n === 34 || n === 39 || n === 92) {
        out.push(n, i, i + 2);
        changed = true;
        i += 2;
        continue;
      }
    }

    // HTML 实体
    if (c === 38) {
      const semi = src.indexOf(';', i + 1);
      if (semi > i + 1 && semi - i <= 12) {
        const body = src.slice(i + 1, semi);
        let cp = -1;
        if (/^#\d{1,7}$/.test(body)) cp = parseInt(body.slice(1), 10);
        else if (/^#[xX][0-9a-fA-F]{1,6}$/.test(body)) cp = parseInt(body.slice(2), 16);
        if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) {
          out.pushCodePoint(cp, i, semi + 1);
          changed = true;
          counts.html++;
          i = semi + 1;
          continue;
        }
        const named = NAMED_ENTITIES[body];
        if (named !== undefined) {
          out.push(named.charCodeAt(0), i, semi + 1);
          changed = true;
          counts.html++;
          i = semi + 1;
          continue;
        }
      }
    }

    out.push(c, i, i + 1);
    i++;
  }

  return changed ? out : null;
}

const CHUNK = 8192;
function toText(codes: Uint16Array, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += CHUNK) text += String.fromCharCode(...codes.subarray(i, Math.min(length, i + CHUNK)));
  return text;
}

/** 逐层解码，直到没有可解码的内容（最多 MAX_PASSES 层），并合成到原文的位置映射 */
export function decodeForMatching(text: string): DecodeResult {
  const counts: DecodedCounts = { url: 0, unicode: 0, html: 0 };
  let current = text;
  let starts: Int32Array | null = null;
  let ends: Int32Array | null = null;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const out = decodeOnce(current, counts);
    if (!out) break;
    const nextStarts = out.starts.slice(0, out.length);
    const nextEnds = out.ends.slice(0, out.length);
    if (starts && ends) {
      // 本层位置指向上一层的解码文本，再折算回原文
      for (let k = 0; k < out.length; k++) {
        nextStarts[k] = starts[nextStarts[k]];
        nextEnds[k] = ends[nextEnds[k] - 1];
      }
    }
    starts = nextStarts;
    ends = nextEnds;
    current = toText(out.codes, out.length);
  }

  return { text: current, starts, ends, counts };
}

/** 把解码文本中的区间 [start, end) 映射回原文区间 */
export function mapToOriginal(result: DecodeResult, start: number, end: number): [number, number] {
  if (!result.starts || !result.ends) return [start, end];
  return [result.starts[start], result.ends[end - 1]];
}

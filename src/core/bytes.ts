/**
 * 字节 → 文本：识别 BOM（UTF-8 / UTF-16），否则先按 UTF-8 严格解码，失败再按 GB18030（兼容 GBK/GB2312）。
 * 开头含 NUL 字节的视为二进制文件。
 */
export function decodeBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes.subarray(0, 8192).includes(0)) throw new Error('看起来是二进制文件，无法作为文本导入');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

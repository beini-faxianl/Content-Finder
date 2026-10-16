import { describe, expect, it } from 'vitest';
import { decodeBytes } from './file';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('decodeBytes', () => {
  it('decodes UTF-8 with or without BOM', () => {
    expect(decodeBytes(new TextEncoder().encode('手机 abc'))).toBe('手机 abc');
    expect(decodeBytes(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe('a');
  });

  it('decodes UTF-16 files with a BOM (e.g. saved by Windows Notepad)', () => {
    expect(decodeBytes(bytes(0xff, 0xfe, 0x4b, 0x62, 0x3a, 0x67))).toBe('手机');
    expect(decodeBytes(bytes(0xfe, 0xff, 0x62, 0x4b, 0x67, 0x3a))).toBe('手机');
  });

  it('falls back to GB18030 for legacy Chinese files', () => {
    // 「手机」的 GBK 编码
    expect(decodeBytes(bytes(0xca, 0xd6, 0xbb, 0xfa))).toBe('手机');
  });

  it('rejects binary content', () => {
    expect(() => decodeBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01))).toThrow(/二进制/);
  });
});

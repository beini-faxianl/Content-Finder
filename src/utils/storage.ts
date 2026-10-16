/** localStorage 的安全封装：隐私模式、配额溢出或被禁用时静默降级 */

export function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * 写入并返回是否成功。内容未变化时跳过写入：既省去大文本的重复写入，
 * 也避免多个标签页之间因 storage 事件互相回写。
 */
export function writeStorage(key: string, value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    if (localStorage.getItem(key) !== serialized) localStorage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

export const STORAGE_KEYS = {
  library: 'finder.library.v1',
  settings: 'finder.settings.v1',
  content: 'finder.content.v1',
} as const;

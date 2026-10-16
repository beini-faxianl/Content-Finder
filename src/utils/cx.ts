/** 拼接 className，忽略假值 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** 根据平台显示快捷键修饰键 */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

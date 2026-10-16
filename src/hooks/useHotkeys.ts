import { useEffect, useRef } from 'react';
import { hasOpenModal } from './useLayer';

/** 返回 false 表示本次不处理，按键保持默认行为 */
export type HotkeyHandler = (event: KeyboardEvent) => void | false;

/** 是否正在输入框中输入（此时不应触发单键快捷键） */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * 注册全局快捷键。键名格式：`mod+e`、`shift+f3`、`escape`、`?`（mod 在 macOS 为 ⌘，其余为 Ctrl）。
 * 处理函数执行后自动 preventDefault，除非它返回 false。
 */
export function useHotkeys(bindings: Record<string, HotkeyHandler>): void {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || hasOpenModal()) return;
      const parts: string[] = [];
      if (event.ctrlKey || event.metaKey) parts.push('mod');
      if (event.altKey) parts.push('alt');
      if (event.shiftKey && event.key.length > 1) parts.push('shift');
      parts.push(event.key.toLowerCase());
      const handler = ref.current[parts.join('+')];
      if (handler && handler(event) !== false) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

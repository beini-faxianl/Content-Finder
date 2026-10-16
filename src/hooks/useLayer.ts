import { useEffect, useRef } from 'react';

type LayerKind = 'modal' | 'popover';

/** 当前打开的浮层栈：只有最上层响应 Esc，避免一次按键关闭多层 */
const stack: Array<{ id: number; kind: LayerKind }> = [];
let seq = 0;

export const hasOpenModal = () => stack.some((l) => l.kind === 'modal');

export function useEscapeLayer(active: boolean, kind: LayerKind, onEscape: () => void): void {
  const callback = useRef(onEscape);
  useEffect(() => {
    callback.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const id = ++seq;
    stack.push({ id, kind });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stack[stack.length - 1]?.id !== id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      callback.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = stack.findIndex((l) => l.id === id);
      if (index !== -1) stack.splice(index, 1);
    };
  }, [active, kind]);
}

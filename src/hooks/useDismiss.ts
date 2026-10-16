import { useEffect, type RefObject } from 'react';
import { useEscapeLayer } from './useLayer';

/** 点击元素外部或按下 Esc 时关闭（用于弹出菜单、浮层） */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void): void {
  useEscapeLayer(open, 'popover', onDismiss);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [ref, open, onDismiss]);
}

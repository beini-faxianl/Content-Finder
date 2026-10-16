import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

interface LineGutterProps {
  lineCount: number;
  /** 正文的滚动容器（编辑模式为输入框，阅读模式为阅读区），行号随它同步滚动 */
  scrollerRef: RefObject<HTMLElement | null>;
  /** 滚动容器可能被替换（切换模式）时改变，用于重新绑定滚动事件 */
  version: unknown;
}

/**
 * 代码视图的行号栏。代码视图不自动换行，每个逻辑行恰好占一行高度，
 * 所以只需一段与正文行高一致的数字文本，并同步纵向滚动即可对齐。
 */
export function LineGutter({ lineCount, scrollerRef, version }: LineGutterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const numbers = useMemo(
    () => Array.from({ length: Math.max(1, lineCount) }, (_, i) => i + 1).join('\n'),
    [lineCount],
  );

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const gutter = ref.current;
    if (!scroller || !gutter) return;
    const sync = () => {
      gutter.scrollTop = scroller.scrollTop;
    };
    sync();
    scroller.addEventListener('scroll', sync, { passive: true });
    return () => scroller.removeEventListener('scroll', sync);
  }, [scrollerRef, version]);

  return (
    <div className="line-gutter" ref={ref} aria-hidden="true">
      <pre className="line-gutter-numbers hl-text">{numbers}</pre>
    </div>
  );
}

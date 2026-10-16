import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

interface MinimapProps {
  layerRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  /** 任意值变化都会触发重新测量（分段、模式、聚焦等） */
  version: unknown;
  cursorId: number | null;
  onJump: (hitId: number) => void;
}

interface Tick {
  id: number;
  /** 命中中心在全文高度中的比例 0..1 */
  y: number;
  color: string;
  dim: boolean;
}

const HIT_RADIUS = 6;

/**
 * 命中分布缩略条：按命中在排版中的真实纵向位置绘制色块，
 * 叠加当前视口指示；点击色块跳到对应命中，点击空白或拖动则滚动正文。
 */
export function Minimap({ layerRef, scrollerRef, version, cursorId, onJump }: MinimapProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ticksRef = useRef<Tick[]>([]);
  const dragging = useRef(false);
  const [view, setView] = useState({ top: 0, height: 1, overflow: false });

  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!wrap || !canvas || !ctx) return;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    let current: Tick | undefined;
    for (const tick of ticksRef.current) {
      if (tick.id === cursorId) current = tick;
      ctx.globalAlpha = tick.dim ? 0.22 : 0.9;
      ctx.fillStyle = tick.color;
      ctx.fillRect(2, Math.round(tick.y * height - 1.5), width - 4, 3);
    }
    if (current) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = getComputedStyle(wrap).getPropertyValue('--text').trim() || '#000';
      ctx.fillRect(0, Math.round(current.y * height - 2.5), width, 5);
      ctx.fillStyle = current.color;
      ctx.fillRect(1, Math.round(current.y * height - 1.5), width - 2, 3);
    }
  }, [cursorId]);

  const measure = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) {
      ticksRef.current = [];
      draw();
      return;
    }
    const total = layer.offsetHeight || 1;
    const hasFocus = layer.classList.contains('has-focus');
    const ticks: Tick[] = [];
    layer.querySelectorAll<HTMLElement>('mark[data-starts]').forEach((el) => {
      const y = (el.offsetTop + el.offsetHeight / 2) / total;
      const color = el.style.getPropertyValue('--hl');
      const dim = hasFocus && !el.classList.contains('is-focus');
      for (const id of (el.dataset.starts ?? '').split(' ')) ticks.push({ id: Number(id), y, color, dim });
    });
    ticksRef.current = ticks;
    draw();
  }, [layerRef, draw]);

  const updateView = useCallback(() => {
    const s = scrollerRef.current;
    if (!s || !s.scrollHeight) return;
    setView({
      top: s.scrollTop / s.scrollHeight,
      height: Math.min(1, s.clientHeight / s.scrollHeight),
      overflow: s.scrollHeight > s.clientHeight + 1,
    });
  }, [scrollerRef]);

  useLayoutEffect(() => {
    measure();
    updateView();
  }, [version, measure, updateView]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const layer = layerRef.current;
    const wrap = wrapRef.current;
    if (!scroller || !wrap) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        measure();
        updateView();
      });
    };
    scroller.addEventListener('scroll', updateView, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(wrap);
    if (layer) observer.observe(layer);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', updateView);
      observer.disconnect();
    };
  }, [version, scrollerRef, layerRef, measure, updateView]);

  const scrollToFraction = (clientY: number, smooth: boolean) => {
    const wrap = wrapRef.current;
    const s = scrollerRef.current;
    if (!wrap || !s) return;
    const rect = wrap.getBoundingClientRect();
    const fraction = (clientY - rect.top) / rect.height;
    s.scrollTo({ top: fraction * s.scrollHeight - s.clientHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const y = event.clientY - rect.top;
    let best: Tick | undefined;
    let bestDistance = HIT_RADIUS;
    for (const tick of ticksRef.current) {
      const distance = Math.abs(tick.y * rect.height - y);
      if (distance < bestDistance) {
        best = tick;
        bestDistance = distance;
      }
    }
    if (best) {
      onJump(best.id);
      return;
    }
    dragging.current = true;
    wrap.setPointerCapture(event.pointerId);
    scrollToFraction(event.clientY, true);
  };

  return (
    <div
      ref={wrapRef}
      className="minimap"
      title="命中分布：点击色块跳转，点击空白处或拖动滚动正文"
      onPointerDown={onPointerDown}
      onPointerMove={(e) => dragging.current && scrollToFraction(e.clientY, false)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      <canvas ref={canvasRef} />
      {view.overflow && (
        <div className="minimap-view" style={{ top: `${view.top * 100}%`, height: `${view.height * 100}%` }} />
      )}
    </div>
  );
}

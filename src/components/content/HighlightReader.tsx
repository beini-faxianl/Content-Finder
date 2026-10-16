import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { LibraryIndex } from '../../core/library';
import type { Stats } from '../../core/stats';
import type { Category, Hit } from '../../core/types';
import { useDismiss } from '../../hooks/useDismiss';
import { cx } from '../../utils/cx';
import { Icon } from '../ui/Icon';
import { HitTooltip } from './HitTooltip';

interface HighlightReaderProps {
  children: ReactNode;
  scrollerRef: RefObject<HTMLDivElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  hitsById: Map<number, Hit>;
  index: LibraryIndex;
  stats: Stats;
  hidden: Set<string>;
  categories: Category[];
  onHitClick: (hitId: number) => void;
  /** 某处命中的替换建议，悬停详情中展示 */
  suggestionFor: (hit: Hit) => string | null;
  onAddKeyword: (term: string, categoryId: string) => void;
  onAddExclusion: (term: string, categoryId: string) => void;
  /** 有聚焦对象时为 true，未聚焦的高亮会变淡 */
  hasFocus: boolean;
}

interface TipState {
  el: Element;
  hitIds: number[];
  rect: DOMRect;
}

interface PickState {
  term: string;
  rect: DOMRect;
  /** 选区内第一处命中的主分类；有值时可把选中的短语设为该分类的例外词 */
  hitCategoryId: string | null;
}

const MAX_PICK_LENGTH = 40;

/** 阅读模式：可悬停查看命中详情、点击聚焦，划选文字可加入词库或设为例外词 */
export function HighlightReader(props: HighlightReaderProps) {
  const { children, scrollerRef, layerRef, hitsById, index, stats, hidden, categories, onHitClick, hasFocus } = props;
  const [tip, setTip] = useState<TipState | null>(null);
  const [pick, setPick] = useState<PickState | null>(null);
  const pointerDown = useRef(false);

  // 内容或高亮变化后，旧的悬停目标可能已被替换
  useEffect(() => setTip(null), [hitsById]);

  const onMouseOver = (event: MouseEvent) => {
    if (pointerDown.current) return;
    const mark = (event.target as Element).closest('mark.hl');
    if (!mark) {
      if (tip) setTip(null);
      return;
    }
    if (tip?.el === mark) return;
    const ids = (mark.getAttribute('data-hits') ?? '').split(' ').filter(Boolean).map(Number);
    setTip({ el: mark, hitIds: ids, rect: mark.getBoundingClientRect() });
  };

  const onClick = (event: MouseEvent) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const mark = (event.target as Element).closest('mark.hl');
    const first = mark?.getAttribute('data-hits')?.split(' ')[0];
    if (first !== undefined) onHitClick(Number(first));
  };

  /** 选区内第一处命中的主分类（优先可见的分类） */
  const categoryInRange = (range: Range, layer: HTMLElement): string | null => {
    for (const mark of layer.querySelectorAll('mark.hl')) {
      if (!range.intersectsNode(mark)) continue;
      const hit = hitsById.get(Number(mark.getAttribute('data-hits')?.split(' ')[0]));
      const entry = hit?.entries.find((e) => !hidden.has(e.categoryId)) ?? hit?.entries[0];
      if (entry) return entry.categoryId;
    }
    return null;
  };

  const onMouseUp = () => {
    pointerDown.current = false;
    // 等本轮 click 处理完（点击已有选区会将其折叠）再读取选区
    setTimeout(() => {
      const selection = window.getSelection();
      const layer = layerRef.current;
      if (!selection || selection.isCollapsed || !layer) return;
      if (!layer.contains(selection.anchorNode) || !layer.contains(selection.focusNode)) return;
      const term = selection.toString().trim();
      if (!term || term.length > MAX_PICK_LENGTH || /\n/.test(term)) return;
      const range = selection.getRangeAt(0);
      setTip(null);
      setPick({ term, rect: range.getBoundingClientRect(), hitCategoryId: categoryInRange(range, layer) });
    });
  };

  const closePick = useCallback(() => setPick(null), []);
  const finishPick = (action: (term: string, categoryId: string) => void, categoryId: string) => {
    if (!pick) return;
    action(pick.term, categoryId);
    window.getSelection()?.removeAllRanges();
    closePick();
  };

  return (
    <div
      className="reader"
      ref={scrollerRef}
      onMouseOver={onMouseOver}
      onMouseLeave={() => setTip(null)}
      onMouseDown={() => {
        pointerDown.current = true;
        setTip(null);
      }}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onScroll={() => {
        if (tip) setTip(null);
        if (pick) setPick(null);
      }}
    >
      <div className={cx('hl-layer hl-text', hasFocus && 'has-focus')} ref={layerRef}>
        {children}
      </div>
      {tip && (
        <HitTooltip
          hitIds={tip.hitIds}
          anchor={tip.rect}
          hitsById={hitsById}
          index={index}
          stats={stats}
          hidden={hidden}
          suggestionFor={props.suggestionFor}
        />
      )}
      {pick && (
        <PickPopover
          pick={pick}
          categories={categories}
          onClose={closePick}
          onAddKeyword={(categoryId) => finishPick(props.onAddKeyword, categoryId)}
          onAddExclusion={(categoryId) => finishPick(props.onAddExclusion, categoryId)}
        />
      )}
    </div>
  );
}

let lastPickedCategory = '';

interface PickPopoverProps {
  pick: PickState;
  categories: Category[];
  onClose: () => void;
  onAddKeyword: (categoryId: string) => void;
  onAddExclusion: (categoryId: string) => void;
}

function PickPopover({ pick, categories, onClose, onAddKeyword, onAddExclusion }: PickPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [categoryId, setCategoryId] = useState(() => {
    // 选区里有命中时，默认选中它的分类，方便把整句短语设为例外
    const preferred = pick.hitCategoryId ?? lastPickedCategory;
    return categories.some((c) => c.id === preferred) ? preferred : (categories[0]?.id ?? '');
  });
  useDismiss(ref, true, onClose);

  const width = 320;
  const height = 84;
  const left = Math.min(Math.max(8, pick.rect.left + pick.rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const top = pick.rect.top > height + 16 ? pick.rect.top - height - 8 : pick.rect.bottom + 8;
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? '';

  return createPortal(
    <div
      ref={ref}
      className={cx('pick-popover', pick.hitCategoryId && 'has-hit')}
      style={{ left, top, width }}
      // 浮层通过 portal 渲染，但 React 事件仍会冒泡到阅读区，需要拦截
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="处理选中的文本"
    >
      <div className="pick-row">
        <span className="pick-term" title={pick.term}>
          「{pick.term}」
        </span>
        <select
          className="select select-sm"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="目标分类"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="pick-row pick-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!categoryId}
          title={`把「${pick.term}」作为关键词加入「${categoryName}」`}
          onClick={() => {
            lastPickedCategory = categoryId;
            onAddKeyword(categoryId);
          }}
        >
          <Icon name="plus" size={13} />
          加入词库
        </button>
        {pick.hitCategoryId && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={!categoryId}
            title={`「${categoryName}」中落在「${pick.term}」之内的命中将不再计入（误报排除）`}
            onClick={() => onAddExclusion(categoryId)}
          >
            <Icon name="shield" size={13} />
            设为例外
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

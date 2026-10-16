import { useState, type CSSProperties } from 'react';
import type { Stats } from '../../core/stats';
import { cx } from '../../utils/cx';
import { Icon } from '../ui/Icon';

interface LegendBarProps {
  stats: Stats;
  hidden: Set<string>;
  onToggle: (categoryId: string) => void;
  onSolo: (categoryId: string) => void;
  onShowAll: () => void;
}

/**
 * 分类图例：点击显示/隐藏高亮，Alt+点击或双击仅显示该分类。
 * 没有命中的分类默认收起，避免分类较多时图例占满一大片。
 */
export function LegendBar({ stats, hidden, onToggle, onSolo, onShowAll }: LegendBarProps) {
  const [showIdle, setShowIdle] = useState(false);
  if (!stats.categories.length) return null;
  const anyHidden = stats.categories.some((c) => hidden.has(c.category.id));
  const idleCount = stats.categories.filter((c) => !c.count && !hidden.has(c.category.id)).length;
  const shown = showIdle ? stats.categories : stats.categories.filter((c) => c.count > 0 || hidden.has(c.category.id));

  return (
    <div className="legend-bar" role="toolbar" aria-label="分类图例">
      {shown.map(({ category, count }) => {
        const off = hidden.has(category.id);
        return (
          <button
            key={category.id}
            type="button"
            className={cx('legend-chip', off && 'is-off', !count && 'is-empty')}
            style={{ '--c': category.color } as CSSProperties}
            aria-pressed={!off}
            title={`${category.name}：${count} 处命中\n点击${off ? '显示' : '隐藏'}高亮，Alt+点击或双击仅显示此分类`}
            onClick={(e) => (e.altKey ? onSolo(category.id) : onToggle(category.id))}
            onDoubleClick={() => onSolo(category.id)}
          >
            <span className="legend-dot" />
            <span className="legend-name">{category.name}</span>
            <span className="legend-count">{count}</span>
          </button>
        );
      })}
      {idleCount > 0 && (
        <button type="button" className="legend-reset" onClick={() => setShowIdle((v) => !v)} aria-expanded={showIdle}>
          {showIdle ? '收起未命中' : `+${idleCount} 个未命中`}
        </button>
      )}
      {anyHidden && (
        <button type="button" className="legend-reset" onClick={onShowAll}>
          <Icon name="eye" size={14} />
          全部显示
        </button>
      )}
    </div>
  );
}

import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { keywordKey, type LibraryIndex } from '../../core/library';
import type { Stats } from '../../core/stats';
import type { Hit } from '../../core/types';
import { LevelBadge } from '../ui/controls';

interface HitTooltipProps {
  hitIds: number[];
  anchor: DOMRect;
  hitsById: Map<number, Hit>;
  index: LibraryIndex;
  stats: Stats;
  hidden: Set<string>;
  suggestionFor: (hit: Hit) => string | null;
}

const GAP = 8;
const MARGIN = 8;

/** 悬停高亮时的详情卡片：命中文本、所属分类、级别、关键词、备注、替换建议与出现序号 */
export function HitTooltip({ hitIds, anchor, hitsById, index, stats, hidden, suggestionFor }: HitTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const above = anchor.top - height - GAP;
    const top = above >= MARGIN ? above : Math.min(anchor.bottom + GAP, window.innerHeight - height - MARGIN);
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - MARGIN,
    );
    setPos({ left, top });
  }, [anchor, hitIds]);

  const hits = hitIds.map((id) => hitsById.get(id)).filter((h): h is Hit => !!h);

  return createPortal(
    <div
      ref={ref}
      className="hit-tooltip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {hits.map((hit, i) => (
        <section key={hit.id} className="tip-hit">
          {i > 0 && <div className="tip-nested">嵌套于更长的命中</div>}
          <div className="tip-text">「{hit.text}」</div>
          {hit.decoded !== undefined && (
            <div className="tip-decoded">
              <span className="tip-label">解码后</span>
              <span className="tip-decoded-text">{hit.decoded}</span>
            </div>
          )}
          {hit.variant !== undefined && (
            <div className="tip-decoded" title="中间插入了空格、符号或表情等干扰字符">
              <span className="tip-label">变体写法</span>
              <span className="tip-decoded-text">{hit.variant}</span>
            </div>
          )}
          {(() => {
            const suggestion = suggestionFor(hit);
            return suggestion !== null && suggestion !== hit.text ? (
              <div className="tip-suggestion">
                <span className="tip-label">建议改为</span>
                <span className="tip-suggestion-text">{suggestion || '（删除）'}</span>
              </div>
            ) : null;
          })()}
          {hit.entries.map((entry) => {
            const ref = index.keywords.get(keywordKey(entry.categoryId, entry.keywordId));
            if (!ref) return null;
            const stat = stats.keywords.get(keywordKey(entry.categoryId, entry.keywordId));
            const order = stat ? stat.hitIds.indexOf(hit.id) + 1 : 0;
            return (
              <div key={entry.categoryId + entry.keywordId} className="tip-entry">
                <div className="tip-entry-head">
                  <span className="dot" style={{ background: ref.category.color }} />
                  <strong>{ref.category.name}</strong>
                  <LevelBadge level={ref.category.level} />
                  {hidden.has(entry.categoryId) && <span className="tip-muted">（已隐藏）</span>}
                  {stat && <span className="tip-order">第 {order}/{stat.count} 处</span>}
                </div>
                <div className="tip-row">
                  <span className="tip-label">关键词</span>
                  <code className="tip-term">{ref.keyword.term}</code>
                  {ref.keyword.type === 'regex' && <span className="regex-badge">正则</span>}
                </div>
                {ref.keyword.note && (
                  <div className="tip-row">
                    <span className="tip-label">备注</span>
                    <span>{ref.keyword.note}</span>
                  </div>
                )}
                {ref.category.description && <div className="tip-desc">{ref.category.description}</div>}
              </div>
            );
          })}
        </section>
      ))}
      <div className="tip-footer">点击聚焦 · F3 下一处 · 误报？划选所在短语可设为例外</div>
    </div>,
    document.body,
  );
}

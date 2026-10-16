import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { buildLineIndex, getContext, lineAt } from '../../core/context';
import { keywordKey, keywordLabel } from '../../core/library';
import { hitLevel } from '../../core/stats';
import { LEVEL_LABEL, type Hit, type Level } from '../../core/types';
import type { Finder } from '../../state/useFinder';
import { cx } from '../../utils/cx';
import { Icon } from '../ui/Icon';
import type { RevisionScope } from './ResultsPanel';

const PAGE = 200;
const LEVEL_ORDER: Level[] = ['danger', 'warning', 'info'];

interface ContextListProps {
  finder: Finder;
  onApplySuggestions: (scope?: RevisionScope) => void;
}

/**
 * 命中上下文（KWIC）：逐条列出命中、前后文、违规原因与替换建议，
 * 可按级别筛选，点击跳到正文对应位置。适合作为逐条审核的清单。
 */
export function ContextList({ finder, onApplySuggestions }: ContextListProps) {
  const { navIds, hitsById, analyzedText, settings, cursor, index, focus, colorsOf, suggestionFor } = finder;
  const [limit, setLimit] = useState(PAGE);
  const [level, setLevel] = useState<Level | 'all'>('all');
  const listRef = useRef<HTMLOListElement>(null);
  const lineStarts = useMemo(() => buildLineIndex(analyzedText), [analyzedText]);

  const levelOf = useMemo(() => {
    const map = new Map<number, Level>();
    for (const id of navIds) {
      const hit = hitsById.get(id);
      if (hit) map.set(id, hitLevel(hit, index));
    }
    return map;
  }, [navIds, hitsById, index]);

  const levelCounts = useMemo(() => {
    const counts: Record<Level, number> = { danger: 0, warning: 0, info: 0 };
    for (const l of levelOf.values()) counts[l]++;
    return counts;
  }, [levelOf]);

  // 当前筛选的级别已没有命中时（例如修订之后），回到「全部」
  const activeLevel = level !== 'all' && levelCounts[level] === 0 ? 'all' : level;
  const filteredIds = useMemo(
    () => (activeLevel === 'all' ? navIds : navIds.filter((id) => levelOf.get(id) === activeLevel)),
    [navIds, levelOf, activeLevel],
  );
  const fixableIds = useMemo(
    () =>
      filteredIds.filter((id) => {
        const hit = hitsById.get(id);
        if (!hit) return false;
        const suggestion = suggestionFor(hit);
        return suggestion !== null && suggestion !== hit.text;
      }),
    [filteredIds, hitsById, suggestionFor],
  );

  useEffect(() => {
    if (!cursor) return;
    // 光标跳到尚未渲染的条目时，扩展列表以便滚动到它
    const position = filteredIds.indexOf(cursor.id);
    setLimit((l) => (position >= l ? Math.ceil((position + 1) / PAGE) * PAGE : l));
    const frame = requestAnimationFrame(() =>
      listRef.current?.querySelector(`[data-hit="${cursor.id}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [cursor, filteredIds]);

  const focusLabel = useMemo(() => {
    if (focus?.type === 'keyword') {
      const ref = index.keywords.get(focus.key);
      return ref ? `${ref.category.name} / ${keywordLabel(ref.keyword)}` : null;
    }
    if (focus?.type === 'category') return index.categories.get(focus.id)?.name ?? null;
    return null;
  }, [focus, index]);

  if (!navIds.length) {
    return <div className="panel-empty">{focusLabel ? `「${focusLabel}」在可见范围内没有命中` : '暂无命中'}</div>;
  }

  const presentLevels = LEVEL_ORDER.filter((l) => levelCounts[l] > 0);
  const rows = filteredIds
    .slice(0, limit)
    .map((id) => hitsById.get(id))
    .filter((h): h is Hit => !!h);

  return (
    <div className="context-view">
      <div className="ctx-header">
        <span>{focusLabel ? <>聚焦：<b>{focusLabel}</b></> : '全部可见命中'}</span>
        <span className="ctx-total">共 {filteredIds.length} 条</span>
      </div>

      {(presentLevels.length > 1 || fixableIds.length > 0) && (
        <div className="ctx-toolbar">
          {presentLevels.length > 1 && (
            <div className="ctx-levels" role="radiogroup" aria-label="按级别筛选">
              {(['all', ...presentLevels] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={activeLevel === l}
                  className={cx('ctx-level', l !== 'all' && `level-${l}`, activeLevel === l && 'is-active')}
                  onClick={() => setLevel(l)}
                >
                  {l === 'all' ? '全部' : LEVEL_LABEL[l]}
                  <b>{l === 'all' ? navIds.length : levelCounts[l]}</b>
                </button>
              ))}
            </div>
          )}
          {fixableIds.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm ctx-fix-all"
              disabled={finder.isStale}
              title="按建议替换下方列出的命中（可撤销）"
              onClick={() => onApplySuggestions({ hitIds: fixableIds })}
            >
              <Icon name="sparkles" size={14} />
              替换这 {fixableIds.length} 处
            </button>
          )}
        </div>
      )}

      <ol className="ctx-list" ref={listRef}>
        {rows.map((hit, i) => {
          const ctx = getContext(analyzedText, hit, settings.contextRadius);
          const refs = hit.entries
            .map((e) => index.keywords.get(keywordKey(e.categoryId, e.keywordId)))
            .filter((r) => !!r);
          const notes = [...new Set(refs.map((r) => r.keyword.note).filter((n): n is string => !!n))];
          const suggestion = suggestionFor(hit);
          const canFix = suggestion !== null && suggestion !== hit.text;
          return (
            <li key={hit.id} data-hit={hit.id} className={cx('ctx-item', cursor?.id === hit.id && 'is-current')}>
              <button type="button" className="ctx-main" onClick={() => finder.goToHit(hit.id)}>
                <div className="ctx-meta">
                  <span className="ctx-index">#{i + 1}</span>
                  <span className="ctx-line">第 {lineAt(lineStarts, hit.start)} 行</span>
                  {refs.map((ref) => (
                    <span key={ref.category.id + ref.keyword.id} className="ctx-tag">
                      <span className="dot" style={{ background: ref.category.color }} />
                      {ref.category.name} · {keywordLabel(ref.keyword)}
                    </span>
                  ))}
                </div>
                <div className="ctx-snippet">
                  {ctx.clippedStart && '…'}
                  {ctx.before}
                  <mark className="hl" style={{ '--hl': colorsOf(hit)[0] } as CSSProperties}>
                    {ctx.match}
                  </mark>
                  {ctx.after}
                  {ctx.clippedEnd && '…'}
                </div>
              </button>
              {(notes.length > 0 || canFix || hit.decoded !== undefined || hit.variant !== undefined) && (
                <div className="ctx-extra">
                  {hit.decoded !== undefined && (
                    <div className="ctx-decoded">
                      解码后 <b>{hit.decoded}</b>
                    </div>
                  )}
                  {hit.variant !== undefined && (
                    <div className="ctx-decoded" title="中间插入了空格、符号或表情等干扰字符">
                      变体写法 <b>{hit.variant}</b>
                    </div>
                  )}
                  {notes.map((note) => (
                    <div key={note} className="ctx-note">
                      {note}
                    </div>
                  ))}
                  {canFix && (
                    <div className="ctx-suggest">
                      <span>
                        建议改为 <b>{suggestion || '（删除）'}</b>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={finder.isStale}
                        onClick={() => onApplySuggestions({ hitIds: [hit.id] })}
                      >
                        替换
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {filteredIds.length > limit && (
        <button type="button" className="btn btn-sm btn-block" onClick={() => setLimit((l) => l + PAGE)}>
          再显示 {Math.min(PAGE, filteredIds.length - limit)} 条（剩余 {filteredIds.length - limit}）
        </button>
      )}
    </div>
  );
}

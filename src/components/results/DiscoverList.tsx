import { useMemo, useState } from 'react';
import { discoverTerms } from '../../core/discover';
import type { KeywordType } from '../../core/types';
import type { Finder } from '../../state/useFinder';
import { Icon } from '../ui/Icon';

interface DiscoverListProps {
  finder: Finder;
  onAddTerms: (categoryId: string, terms: string[], type?: KeywordType) => void;
}

/** 新词发现：列出文中高频、但词库尚未收录的候选词，一键加入指定分类 */
export function DiscoverList({ finder, onAddTerms }: DiscoverListProps) {
  const { analyzedText, library } = finder;
  const enabled = library.categories.filter((c) => c.enabled);
  const [target, setTarget] = useState(enabled[0]?.id ?? '');
  const targetId = enabled.some((c) => c.id === target) ? target : (enabled[0]?.id ?? '');
  const targetName = enabled.find((c) => c.id === targetId)?.name ?? '';

  const exclude = useMemo(
    () => library.categories.flatMap((c) => c.keywords.filter((k) => k.type === 'text').map((k) => k.term)),
    [library],
  );
  const candidates = useMemo(() => discoverTerms(analyzedText, { exclude, limit: 40 }), [analyzedText, exclude]);
  const max = candidates[0]?.count ?? 1;

  return (
    <div className="discover">
      <p className="panel-hint">
        基于词频统计，找出文中反复出现、但词库尚未收录的词语（启发式结果，仅供参考）。
      </p>
      {enabled.length > 0 && (
        <label className="discover-target">
          <span>加入到</span>
          <select className="select select-sm" value={targetId} onChange={(e) => setTarget(e.target.value)}>
            {enabled.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {candidates.length === 0 ? (
        <div className="panel-empty">
          {analyzedText.trim() ? '没有找到出现 2 次以上的新词' : '输入内容后，这里会列出高频候选词'}
        </div>
      ) : (
        <ul className="discover-list">
          {candidates.map((c) => (
            <li key={c.term} className="discover-row">
              <span className="discover-term" title={c.term}>
                {c.term}
              </span>
              <span className="discover-bar" aria-hidden="true">
                <i style={{ width: `${(c.count / max) * 100}%` }} />
              </span>
              <span className="discover-count">{c.count} 次</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                disabled={!targetId}
                title={`加入「${targetName}」`}
                aria-label={`将 ${c.term} 加入 ${targetName}`}
                onClick={() => onAddTerms(targetId, [c.term])}
              >
                <Icon name="plus" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

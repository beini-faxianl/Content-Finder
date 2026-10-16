import { useMemo, useState, type CSSProperties } from 'react';
import { keywordLabel } from '../../core/library';
import type { CategoryStat } from '../../core/stats';
import type { Finder } from '../../state/useFinder';
import { cx } from '../../utils/cx';
import { LevelBadge } from '../ui/controls';
import { Icon } from '../ui/Icon';
import type { RevisionScope } from './ResultsPanel';

const COLLAPSED_KEYWORDS = 12;

interface CategoryStatsProps {
  finder: Finder;
  onOpenLibrary: () => void;
  onApplySuggestions: (scope?: RevisionScope) => void;
}

export function CategoryStats({ finder, onOpenLibrary, onApplySuggestions }: CategoryStatsProps) {
  const { stats, focus, hidden, index } = finder;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showIdle, setShowIdle] = useState(false);

  const q = query.trim().toLowerCase();
  const { active, idle } = useMemo(() => {
    const filtered = stats.categories.map((c) => ({
      ...c,
      keywords: q
        ? c.keywords.filter((k) => {
            const ref = index.keywords.get(k.key);
            return k.term.toLowerCase().includes(q) || (ref?.keyword.note ?? '').toLowerCase().includes(q);
          })
        : c.keywords,
    }));
    return {
      active: filtered
        .filter((c) => c.count > 0 && (!q || c.keywords.length > 0 || c.category.name.toLowerCase().includes(q)))
        .sort((a, b) => b.count - a.count),
      idle: stats.categories.filter((c) => c.count === 0),
    };
  }, [stats, q, index]);

  const total = stats.summary.totalHits || 1;
  const toggleExpanded = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!stats.categories.length) {
    return (
      <div className="panel-empty">
        <p>没有启用的分类。</p>
        <button type="button" className="btn btn-sm" onClick={onOpenLibrary}>
          打开关键词库
        </button>
      </div>
    );
  }

  return (
    <div className="category-stats">
      {stats.summary.totalHits > 0 && (
        <label className="search-field">
          <Icon name="search" size={14} />
          <input
            type="search"
            placeholder="筛选命中的关键词…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="筛选命中的关键词"
          />
        </label>
      )}

      {stats.summary.totalHits === 0 && (
        <div className="panel-empty">
          <p>当前内容没有命中任何关键词。</p>
          <p className="panel-hint">可以在「新词发现」中寻找高频词，或在阅读模式下划选文字直接加入词库。</p>
        </div>
      )}

      {active.map((stat) => (
        <CategoryBlock
          key={stat.category.id}
          stat={stat}
          share={stat.count / total}
          hidden={hidden.has(stat.category.id)}
          expanded={expanded.has(stat.category.id) || !!q}
          focusKey={focus?.type === 'keyword' ? focus.key : null}
          categoryFocused={focus?.type === 'category' && focus.id === stat.category.id}
          finder={finder}
          onToggleExpanded={() => toggleExpanded(stat.category.id)}
          onApplySuggestions={() => onApplySuggestions({ categoryId: stat.category.id })}
        />
      ))}
      {q && active.length === 0 && <div className="panel-empty">没有匹配「{query}」的命中关键词</div>}

      {idle.length > 0 && (
        <div className="idle-group">
          <button type="button" className="idle-toggle" onClick={() => setShowIdle((v) => !v)} aria-expanded={showIdle}>
            <Icon name={showIdle ? 'chevron-down' : 'chevron-right'} size={14} />
            未命中的分类（{idle.length}）
          </button>
          {showIdle && (
            <ul className="idle-list">
              {idle.map(({ category }) => (
                <li key={category.id}>
                  <span className="dot" style={{ background: category.color }} />
                  {category.name}
                  <span className="idle-count">{category.keywords.length} 个关键词</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface CategoryBlockProps {
  stat: CategoryStat;
  share: number;
  hidden: boolean;
  expanded: boolean;
  focusKey: string | null;
  categoryFocused: boolean;
  finder: Finder;
  onToggleExpanded: () => void;
  onApplySuggestions: () => void;
}

function CategoryBlock(props: CategoryBlockProps) {
  const { stat, share, hidden, expanded, focusKey, categoryFocused, finder, onToggleExpanded, onApplySuggestions } = props;
  const { category, count, keywords } = stat;
  const shown = expanded ? keywords : keywords.slice(0, COLLAPSED_KEYWORDS);
  const fixable = finder.fixableByCategory.get(category.id) ?? 0;
  const excluded = finder.analysis.excluded[category.id] ?? 0;

  return (
    <section
      className={cx('cat-block', hidden && 'is-hidden', categoryFocused && 'is-focused')}
      style={{ '--c': category.color } as CSSProperties}
    >
      <header className="cat-head">
        <span className="dot" />
        <span className="cat-name" title={category.description}>
          {category.name}
        </span>
        <LevelBadge level={category.level} />
        <span className="cat-count">{count}</span>
        {fixable > 0 && (
          <button
            type="button"
            className="icon-btn icon-btn-sm cat-fix"
            title={`按建议替换本分类的 ${fixable} 处命中（可撤销）`}
            aria-label={`按建议替换 ${category.name} 的 ${fixable} 处命中`}
            disabled={finder.isStale}
            onClick={onApplySuggestions}
          >
            <Icon name="sparkles" size={14} />
          </button>
        )}
        <button
          type="button"
          className={cx('icon-btn icon-btn-sm', categoryFocused && 'is-active')}
          title="聚焦整个分类，逐处浏览"
          aria-label={`聚焦分类 ${category.name}`}
          onClick={() => finder.focusOn({ type: 'category', id: category.id })}
        >
          <Icon name="target" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-sm"
          title={hidden ? '显示该分类的高亮' : '隐藏该分类的高亮'}
          aria-label={hidden ? `显示 ${category.name}` : `隐藏 ${category.name}`}
          onClick={() => finder.toggleCategoryVisibility(category.id)}
        >
          <Icon name={hidden ? 'eye-off' : 'eye'} size={14} />
        </button>
      </header>
      <div className="cat-bar" title={`占全部命中的 ${(share * 100).toFixed(1)}%`}>
        <i style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
      {excluded > 0 && (
        <div className="cat-excluded" title="这些命中落在本分类的例外词之内，未计入统计">
          <Icon name="shield" size={12} />
          另有 {excluded} 处被例外词排除
        </div>
      )}
      <div className="kw-chips">
        {shown.map((k) => {
          const ref = finder.index.keywords.get(k.key);
          const label = ref ? keywordLabel(ref.keyword) : k.term;
          const variants = k.variants.filter((v) => v !== k.term);
          return (
            <button
              key={k.key}
              type="button"
              className={cx('kw-chip', focusKey === k.key && 'is-active')}
              onClick={() => finder.focusOn({ type: 'keyword', key: k.key })}
              title={[
                k.type === 'regex' ? `正则：${k.term}` : `关键词：${k.term}`,
                variants.length ? `命中写法：${variants.join('、')}` : '',
                ref?.keyword.note && k.type !== 'regex' ? `备注：${ref.keyword.note}` : '',
                '点击聚焦并逐处跳转',
              ]
                .filter(Boolean)
                .join('\n')}
            >
              {k.type === 'regex' && <span className="regex-badge">正则</span>}
              <span className="kw-chip-term">{label}</span>
              <b>{k.count}</b>
            </button>
          );
        })}
        {keywords.length > COLLAPSED_KEYWORDS && (
          <button type="button" className="kw-more" onClick={onToggleExpanded}>
            {expanded ? '收起' : `还有 ${keywords.length - COLLAPSED_KEYWORDS} 个`}
          </button>
        )}
      </div>
    </section>
  );
}

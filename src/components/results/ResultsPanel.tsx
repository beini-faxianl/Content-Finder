import { useState } from 'react';
import { VERDICT_TEXT, type Summary } from '../../core/stats';
import { LEVEL_LABEL, type KeywordType } from '../../core/types';
import type { Finder } from '../../state/useFinder';
import { cx } from '../../utils/cx';
import { Icon, type IconName } from '../ui/Icon';
import { CategoryStats } from './CategoryStats';
import { ContextList } from './ContextList';
import { DiscoverList } from './DiscoverList';

type Tab = 'categories' | 'contexts' | 'discover';

/** 修订范围：不传表示全部可见命中 */
export interface RevisionScope {
  categoryId?: string;
  hitIds?: number[];
}

interface ResultsPanelProps {
  finder: Finder;
  onOpenLibrary: () => void;
  onAddTerms: (categoryId: string, terms: string[], type?: KeywordType) => void;
  onApplySuggestions: (scope?: RevisionScope) => void;
}

export function ResultsPanel({ finder, onOpenLibrary, onAddTerms, onApplySuggestions }: ResultsPanelProps) {
  const [tab, setTab] = useState<Tab>('categories');
  const { summary } = finder.stats;
  const contextCount = finder.navIds.length;

  const tabs: Array<{ id: Tab; label: string; icon: IconName; badge?: number }> = [
    { id: 'categories', label: '分类统计', icon: 'chart', badge: summary.categoriesHit },
    { id: 'contexts', label: '命中上下文', icon: 'list', badge: contextCount },
    { id: 'discover', label: '新词发现', icon: 'sparkles' },
  ];

  return (
    <aside className="pane results-panel" aria-label="分析结果">
      <VerdictCard
        summary={summary}
        fixableCount={finder.fixableCount}
        busy={finder.isStale}
        onFix={() => onApplySuggestions()}
      />
      <div className="metrics">
        <Metric value={summary.totalHits} label="命中总数" />
        <Metric value={summary.uniqueKeywords} label="命中关键词" />
        <Metric value={`${summary.categoriesHit}/${summary.enabledCategories}`} label="涉及分类" />
        <Metric value={summary.density.toFixed(1)} label="每千字命中" />
      </div>

      <div className="tabs" role="tablist" aria-label="结果视图">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            className={cx('tab', tab === t.id && 'is-active')}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.badge !== undefined && t.badge > 0 && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="results-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'categories' && (
          <CategoryStats finder={finder} onOpenLibrary={onOpenLibrary} onApplySuggestions={onApplySuggestions} />
        )}
        {tab === 'contexts' && <ContextList finder={finder} onApplySuggestions={onApplySuggestions} />}
        {tab === 'discover' && <DiscoverList finder={finder} onAddTerms={onAddTerms} />}
      </div>
    </aside>
  );
}

const VERDICT_ICON: Record<Summary['verdict'], IconName> = {
  none: 'search',
  normal: 'shield',
  attention: 'alert',
  risk: 'alert',
};

interface VerdictCardProps {
  summary: Summary;
  fixableCount: number;
  /** 分析结果尚未跟上最新内容 */
  busy: boolean;
  onFix: () => void;
}

function VerdictCard({ summary, fixableCount, busy, onFix }: VerdictCardProps) {
  const { verdict, byLevel } = summary;
  return (
    <div className={cx('verdict', `verdict-${verdict}`)}>
      <div className="verdict-icon">
        <Icon name={VERDICT_ICON[verdict]} size={20} />
      </div>
      <div className="verdict-text">
        <div className="verdict-label">{VERDICT_TEXT[verdict].label}</div>
        <div className="verdict-detail">{VERDICT_TEXT[verdict].detail}</div>
      </div>
      {verdict !== 'none' && (
        <div className="verdict-levels" aria-label="级别分布">
          {(['danger', 'warning', 'info'] as const).map((level) => (
            <span key={level} className={cx('lv', `lv-${level}`, !byLevel[level] && 'is-zero')}>
              {LEVEL_LABEL[level]}
              <b>{byLevel[level]}</b>
            </span>
          ))}
        </div>
      )}
      {fixableCount > 0 && (
        <div className="verdict-fix">
          <Icon name="sparkles" size={14} />
          <span>
            其中 <b>{fixableCount}</b> 处有替换建议
          </span>
          <button
            type="button"
            className="btn btn-sm verdict-fix-btn"
            onClick={onFix}
            disabled={busy}
            title={busy ? '分析完成后可用' : '按关键词库中的替换建议修改正文，可撤销'}
          >
            按建议修订
          </button>
        </div>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

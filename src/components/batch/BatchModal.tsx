import { useMemo, useRef, useState } from 'react';
import {
  countByFilter,
  matchesFilter,
  sortByRisk,
  splitBatchText,
  type BatchFilter,
  type BatchItem,
  type BatchSource,
  type BatchSplitMode,
} from '../../core/batch';
import { VERDICT_TEXT } from '../../core/stats';
import type { BatchState } from '../../state/useBatch';
import { cx } from '../../utils/cx';
import { Segmented } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

interface BatchModalProps {
  open: boolean;
  onClose: () => void;
  batch: BatchState;
  onStartFiles: (files: File[]) => void;
  onStartSources: (sources: BatchSource[]) => void;
  onOpenItem: (item: BatchItem) => void;
  onExport: (kind: 'summary' | 'hits') => void;
}

const PAGE = 300;

const FILTERS: Array<{ id: BatchFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'risk', label: '存在风险' },
  { id: 'attention', label: '需要关注' },
  { id: 'normal', label: '内容正常' },
  { id: 'none', label: '未发现命中' },
  { id: 'error', label: '失败' },
];

export function BatchModal({ open, onClose, batch, onStartFiles, onStartSources, onOpenItem, onExport }: BatchModalProps) {
  const hasItems = batch.items.length > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      className="batch-modal"
      title="批量检测"
      subtitle="一次检查多个文件或多条文本，按风险排序，逐条打开处理"
      footer={
        hasItems ? (
          <>
            <button type="button" className="btn" onClick={batch.clear}>
              <Icon name="plus" size={14} />
              新建检测
            </button>
            <button
              type="button"
              className="btn"
              onClick={batch.rerun}
              disabled={batch.running}
              title="词库或匹配设置改动后，用最新规则重新检测这一批"
            >
              <Icon name="reset" size={14} />
              重新检测
            </button>
            <span className="toolbar-spacer" />
            <button type="button" className="btn" onClick={() => onExport('summary')} disabled={batch.running}>
              <Icon name="download" size={14} />
              导出汇总
            </button>
            <button type="button" className="btn btn-primary" onClick={() => onExport('hits')} disabled={batch.running}>
              <Icon name="download" size={14} />
              导出命中明细
            </button>
          </>
        ) : undefined
      }
    >
      {hasItems ? (
        <BatchResults batch={batch} onOpenItem={onOpenItem} />
      ) : (
        <BatchSources onStartFiles={onStartFiles} onStartSources={onStartSources} />
      )}
    </Modal>
  );
}

function BatchSources({
  onStartFiles,
  onStartSources,
}: Pick<BatchModalProps, 'onStartFiles' | 'onStartSources'>) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pasted, setPasted] = useState('');
  const [mode, setMode] = useState<BatchSplitMode>('line');
  const sources = useMemo(() => splitBatchText(pasted, mode), [pasted, mode]);

  return (
    <div className="batch-source">
      <div
        className={cx('batch-drop', dragOver && 'is-over')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) onStartFiles([...e.dataTransfer.files]);
        }}
      >
        <Icon name="upload" size={26} />
        <b>把多个文件拖到这里</b>
        <span className="muted">文本、代码、日志、HTML、HAR 等均可，单个文件不超过 10 MB</span>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          选择文件
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) onStartFiles(files);
          }}
        />
      </div>

      <div className="batch-or">
        <span>或者粘贴多条文本</span>
      </div>

      <textarea
        className="input batch-paste"
        rows={8}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder={'例如从表格中复制一整列商品标题，每行一条：\n全网第一的补水神器，限时秒杀\n温和配方，敏感肌可用\n…'}
        aria-label="粘贴多条文本"
      />
      <div className="batch-paste-bar">
        <Segmented
          size="sm"
          label="拆分方式"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'line', label: '每行一条', title: '适合商品标题、短评论等一行一条的内容' },
            { value: 'paragraph', label: '空行分段', title: '适合多行的长文本，用空行隔开' },
          ]}
        />
        <span className="muted">{sources.length ? `共 ${sources.length} 条` : ''}</span>
        <span className="toolbar-spacer" />
        <button type="button" className="btn btn-primary" disabled={!sources.length} onClick={() => onStartSources(sources)}>
          开始检测
        </button>
      </div>
    </div>
  );
}

function BatchResults({ batch, onOpenItem }: Pick<BatchModalProps, 'batch' | 'onOpenItem'>) {
  const [filter, setFilter] = useState<BatchFilter>('all');
  const [sort, setSort] = useState<'risk' | 'input'>('risk');
  const [limit, setLimit] = useState(PAGE);
  const counts = useMemo(() => countByFilter(batch.items), [batch.items]);
  const activeFilter = filter !== 'all' && counts[filter] === 0 ? 'all' : filter;
  const rows = useMemo(() => {
    const filtered = batch.items.filter((item) => matchesFilter(item, activeFilter));
    return sort === 'risk' ? sortByRisk(filtered) : filtered;
  }, [batch.items, activeFilter, sort]);
  const total = batch.items.length;

  return (
    <div className="batch-results">
      <div className="batch-toolbar">
        {batch.running ? (
          <>
            <div className="batch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={batch.processed}>
              <i style={{ width: `${(batch.processed / total) * 100}%` }} />
            </div>
            <span className="batch-progress-text">
              检测中 {batch.processed}/{total}
            </span>
            <button type="button" className="btn btn-sm" onClick={batch.stop}>
              停止
            </button>
          </>
        ) : (
          <span className="batch-progress-text">共 {total} 条</span>
        )}
        <span className="toolbar-spacer" />
        <Segmented
          size="sm"
          label="排序"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'risk', label: '风险优先' },
            { value: 'input', label: '原始顺序' },
          ]}
        />
      </div>

      <div className="batch-filters" role="radiogroup" aria-label="按结论筛选">
        {FILTERS.filter((f) => f.id === 'all' || counts[f.id] > 0).map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={activeFilter === f.id}
            className={cx('batch-filter', `batch-filter-${f.id}`, activeFilter === f.id && 'is-active')}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            <b>{counts[f.id]}</b>
          </button>
        ))}
      </div>

      <div className="batch-table-wrap">
        <table className="batch-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">名称</th>
              <th scope="col">结论</th>
              <th scope="col" className="num" title="风险级命中">
                风险
              </th>
              <th scope="col" className="num" title="关注级命中">
                关注
              </th>
              <th scope="col" className="num" title="提示级命中">
                提示
              </th>
              <th scope="col">主要命中</th>
              <th scope="col">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((item) => (
              <BatchRow key={item.id} item={item} onOpen={() => onOpenItem(item)} />
            ))}
          </tbody>
        </table>
        {rows.length > limit && (
          <button type="button" className="btn btn-sm btn-block" onClick={() => setLimit((l) => l + PAGE)}>
            再显示 {Math.min(PAGE, rows.length - limit)} 条（剩余 {rows.length - limit}）
          </button>
        )}
      </div>
    </div>
  );
}

const preview = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 60);

function BatchRow({ item, onOpen }: { item: BatchItem; onOpen: () => void }) {
  const summary = item.result?.stats.summary;
  const canOpen = item.text.length > 0;
  return (
    <tr className={cx('batch-row', canOpen && 'is-openable')} onClick={canOpen ? onOpen : undefined}>
      <td className="num muted">{item.id + 1}</td>
      <td className="batch-name">
        <div className="batch-name-text" title={item.name}>
          {item.name}
        </div>
        {item.text && <div className="batch-preview">{preview(item.text)}</div>}
      </td>
      <td>
        <StatusBadge item={item} />
      </td>
      <td className={cx('num', !!summary?.byLevel.danger && 'is-danger')}>{summary ? summary.byLevel.danger || '–' : ''}</td>
      <td className={cx('num', !!summary?.byLevel.warning && 'is-warning')}>{summary ? summary.byLevel.warning || '–' : ''}</td>
      <td className="num">{summary ? summary.byLevel.info || '–' : ''}</td>
      <td>
        <div className="batch-top">
          {item.result?.top.map((t) => (
            <span key={t.label} className="batch-kw">
              <i style={{ background: t.color }} />
              {t.label}
              <b>{t.count}</b>
            </span>
          ))}
        </div>
      </td>
      <td>
        {canOpen && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            aria-label={`打开 ${item.name}`}
          >
            打开
          </button>
        )}
      </td>
    </tr>
  );
}

function StatusBadge({ item }: { item: BatchItem }) {
  if (item.status === 'pending') return <span className="batch-badge is-pending">等待中</span>;
  if (item.status === 'stopped') return <span className="batch-badge is-pending">已停止</span>;
  if (item.status === 'error' || !item.result) {
    return (
      <span className="batch-badge is-error" title={item.error}>
        失败
      </span>
    );
  }
  const verdict = item.result.stats.summary.verdict;
  return <span className={cx('batch-badge', `is-${verdict}`)}>{VERDICT_TEXT[verdict].label}</span>;
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { keywordLabel } from '../../core/library';
import { CONTENT_KIND_LABEL, detectContentKind, type ContentKind } from '../../core/detect';
import { buildSegments } from '../../core/segments';
import type { Finder } from '../../state/useFinder';
import { cx, MOD_KEY } from '../../utils/cx';
import { Segmented } from '../ui/controls';
import { Icon } from '../ui/Icon';
import { HighlightEditor } from './HighlightEditor';
import { HighlightedText } from './HighlightedText';
import { HighlightReader } from './HighlightReader';
import { LegendBar } from './LegendBar';
import { LineGutter } from './LineGutter';
import { Minimap } from './Minimap';

export type ViewMode = 'edit' | 'read';

interface ContentPaneProps {
  finder: Finder;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 拖入一个文件直接打开，多个文件进入批量检测 */
  onImportFiles: (files: File[]) => void;
  onRequestImport: () => void;
  onLoadSample: () => void;
  onOpenLibrary: () => void;
  onCopyText: () => void;
  onClear: () => void;
  onAddKeyword: (term: string, categoryId: string) => void;
  onAddExclusion: (term: string, categoryId: string) => void;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function ContentPane(props: ContentPaneProps) {
  const { finder, mode, onModeChange, textareaRef } = props;
  const { text, analyzedText, analysis, stats, visibleHits, hitsById, colorsOf, focusSet, cursor, index } = finder;

  const layerRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLDivElement>(null);
  const scrollerRef: RefObject<HTMLElement | null> = mode === 'edit' ? textareaRef : readerRef;
  const lastScrollTop = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const segments = useMemo(() => buildSegments(analyzedText.length, visibleHits), [analyzedText, visibleHits]);
  const lineCount = useMemo(() => (text ? text.split('\n').length : 0), [text]);
  const codeView = finder.settings.codeView;
  // 行号对应屏幕上显示的文本：编辑模式是输入框里的最新内容，阅读模式是已分析的内容
  const shownLines = useMemo(
    () => (mode === 'edit' ? lineCount : analyzedText ? analyzedText.split('\n').length : 0),
    [mode, lineCount, analyzedText],
  );
  const contentKind = useMemo(() => detectContentKind(analyzedText), [analyzedText]);
  const [dismissedHint, setDismissedHint] = useState<ContentKind | null>(null);
  const showCodeHint = !codeView && contentKind !== 'text' && dismissedHint !== contentKind && !!text;
  const decodedTotal = analysis.decoded.url + analysis.decoded.unicode + analysis.decoded.html;
  const variantTotal = useMemo(() => analysis.hits.filter((h) => h.variant !== undefined).length, [analysis.hits]);

  // 缩略条只在高亮布局可能变化时重新测量（对象身份变化即触发）
  const minimapVersion = useMemo(() => ({ segments, focusSet, mode }), [segments, focusSet, mode]);

  const highlighted = (
    <HighlightedText text={analyzedText} segments={segments} hitsById={hitsById} colorsOf={colorsOf} focusSet={focusSet} />
  );

  // 当前命中的强调样式直接操作 DOM，避免为了一个 class 重渲染整篇文本
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.querySelectorAll('.is-current').forEach((el) => el.classList.remove('is-current'));
    if (cursor) layer.querySelectorAll(`[data-hits~="${cursor.id}"]`).forEach((el) => el.classList.add('is-current'));
  }, [cursor, segments, focusSet, mode]);

  // 跳转到当前命中
  useEffect(() => {
    const layer = layerRef.current;
    const scroller = scrollerRef.current;
    if (!cursor || !layer || !scroller) return;
    const el =
      layer.querySelector<HTMLElement>(`[data-starts~="${cursor.id}"]`) ??
      layer.querySelector<HTMLElement>(`[data-hits~="${cursor.id}"]`);
    if (!el) return;
    const top = el.offsetTop - scroller.clientHeight / 2 + el.offsetHeight / 2;
    // 代码视图不换行：命中可能在可视区域之外，横向也要滚到它
    const outOfView = el.offsetLeft < scroller.scrollLeft || el.offsetLeft + el.offsetWidth > scroller.scrollLeft + scroller.clientWidth;
    const left = outOfView ? Math.max(0, el.offsetLeft - scroller.clientWidth / 3) : scroller.scrollLeft;
    scroller.scrollTo({ top: Math.max(0, top), left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    // 仅在发生跳转动作（seq 变化）时滚动，编辑文本不应打断阅读位置
  }, [cursor?.seq]);

  // 切换模式时保持滚动位置：两种模式排版一致，可直接沿用 scrollTop
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = lastScrollTop.current;
    const onScroll = () => (lastScrollTop.current = scroller.scrollTop);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [mode, scrollerRef]);

  const hiddenHits = analysis.hits.length - visibleHits.length;
  const isEmpty = !text;

  return (
    <section
      className={cx('pane content-pane', dragOver && 'is-drag-over')}
      aria-label="内容"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        props.onImportFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="pane-toolbar">
        <Segmented
          label="视图模式"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'edit', label: <><Icon name="edit" size={14} />编辑</>, title: `编辑模式：边输入边高亮（${MOD_KEY}+E 切换）` },
            { value: 'read', label: <><Icon name="read" size={14} />阅读</>, title: `阅读模式：悬停查看详情、划词加入词库（${MOD_KEY}+E 切换）` },
          ]}
        />
        <button
          type="button"
          className={cx('icon-btn', codeView && 'is-active')}
          aria-pressed={codeView}
          aria-label="代码视图"
          title="代码视图：等宽字体、不自动换行、显示行号（适合代码与 HTTP 报文）"
          onClick={() => finder.updateSettings({ codeView: !codeView })}
        >
          <Icon name="code" />
        </button>
        <div className="toolbar-spacer" />
        <Navigator finder={finder} />
        <div className="toolbar-divider" />
        <button type="button" className="icon-btn" title="复制全文" aria-label="复制全文" onClick={props.onCopyText} disabled={isEmpty}>
          <Icon name="copy" />
        </button>
        <button type="button" className="icon-btn" title="清空内容" aria-label="清空内容" onClick={props.onClear} disabled={isEmpty}>
          <Icon name="eraser" />
        </button>
      </div>

      {showCodeHint && (
        <div className="content-hint" role="status">
          <Icon name="info" size={14} />
          <span>
            看起来是<b>{CONTENT_KIND_LABEL[contentKind]}</b>，切换到代码视图（等宽字体、行号）更易阅读
          </span>
          <button type="button" className="btn btn-sm" onClick={() => finder.updateSettings({ codeView: true })}>
            切换
          </button>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="不再提示" onClick={() => setDismissedHint(contentKind)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div
        className={cx('surface', codeView && 'is-code')}
        style={
          {
            '--text-size': `${finder.settings.fontSize}px`,
            '--gutter-w': codeView ? `${String(Math.max(1, shownLines)).length + 3}ch` : '0px',
          } as CSSProperties
        }
      >
        {mode === 'edit' ? (
          <HighlightEditor
            value={text}
            onChange={finder.setText}
            layerEndsWithNewline={analyzedText.endsWith('\n')}
            textareaRef={textareaRef}
            layerRef={layerRef}
            hasFocus={focusSet !== null}
            codeView={codeView}
          >
            {highlighted}
          </HighlightEditor>
        ) : isEmpty ? (
          <EmptyState
            onStartTyping={() => onModeChange('edit')}
            onLoadSample={props.onLoadSample}
            onImport={props.onRequestImport}
          />
        ) : (
          <HighlightReader
            scrollerRef={readerRef}
            layerRef={layerRef}
            hitsById={hitsById}
            index={index}
            stats={stats}
            hidden={finder.hidden}
            categories={finder.library.categories.filter((c) => c.enabled)}
            onHitClick={finder.focusHit}
            hasFocus={focusSet !== null}
            suggestionFor={finder.suggestionFor}
            onAddKeyword={props.onAddKeyword}
            onAddExclusion={props.onAddExclusion}
          >
            {highlighted}
          </HighlightReader>
        )}
        {/* 放在编辑器/阅读器之后：它们的 ref 先挂载，行号栏才能绑定到正确的滚动容器 */}
        {codeView && !isEmpty && <LineGutter lineCount={shownLines} scrollerRef={scrollerRef} version={mode} />}
        {!isEmpty && (
          <Minimap
            layerRef={layerRef}
            scrollerRef={scrollerRef}
            version={minimapVersion}
            cursorId={cursor?.id ?? null}
            onJump={finder.goToHit}
          />
        )}
        {dragOver && (
          <div className="drop-overlay">
            <Icon name="upload" size={28} />
            <span>松开鼠标导入（多个文件将进入批量检测）</span>
          </div>
        )}
      </div>

      <LegendBar
        stats={stats}
        hidden={finder.hidden}
        onToggle={finder.toggleCategoryVisibility}
        onSolo={finder.soloCategory}
        onShowAll={finder.showAllCategories}
      />

      <footer className="status-bar">
        <span>{stats.summary.charCount.toLocaleString()} 字</span>
        <span>{lineCount.toLocaleString()} 行</span>
        {contentKind !== 'text' && <span className="status-kind">{CONTENT_KIND_LABEL[contentKind]}</span>}
        <span>
          命中 <b>{analysis.hits.length.toLocaleString()}</b>
          {hiddenHits > 0 && <span className="status-muted">（隐藏 {hiddenHits}）</span>}
        </span>
        <span className="toolbar-spacer" />
        {finder.contentSaveFailed && (
          <span className="status-warn" title="浏览器存储空间不足，刷新页面后最新内容可能丢失，请及时导出">
            <Icon name="alert" size={13} />
            未能自动保存
          </span>
        )}
        {finder.analysisFailure && (
          <span className="status-warn" title={finder.analysisFailure}>
            <Icon name="alert" size={13} />
            分析失败
          </span>
        )}
        {finder.ruleErrors.length > 0 && (
          <button type="button" className="status-warn" onClick={props.onOpenLibrary} title="点击打开关键词库查看">
            <Icon name="alert" size={13} />
            {finder.ruleErrors.length} 条正则无效或已暂停
          </button>
        )}
        {variantTotal > 0 && (
          <span title="关键词中间插入了空格、符号或表情等干扰字符的命中（如「全 网 第 一」）">变体 {variantTotal}</span>
        )}
        {decodedTotal > 0 && (
          <span
            title={`匹配前已先解码：URL 编码 ${analysis.decoded.url} 处、转义 ${analysis.decoded.unicode} 处、HTML 实体 ${analysis.decoded.html} 处`}
          >
            已解码 {decodedTotal}
          </span>
        )}
        {finder.excludedTotal > 0 && (
          <span title="落在例外词之内、因此未计入的命中数；例外词可在关键词库中管理">
            已排除 {finder.excludedTotal}
          </span>
        )}
        {analysis.truncated && (
          <span className="status-warn" title="单条正则最多保留 5000 处命中">
            <Icon name="alert" size={13} />
            部分正则命中已截断
          </span>
        )}
        <span>{finder.ruleCount.toLocaleString()} 条规则</span>
        <span className={cx('status-time', finder.isStale && 'is-busy')}>
          {finder.isStale ? '分析中…' : `${analysis.elapsedMs < 1 ? '<1' : analysis.elapsedMs.toFixed(1)} ms`}
        </span>
      </footer>
    </section>
  );
}

function Navigator({ finder }: { finder: Finder }) {
  const { focus, navIds, cursorPosition, index } = finder;
  let label: { name: string; color: string; sub: string } | null = null;
  if (focus?.type === 'keyword') {
    const ref = index.keywords.get(focus.key);
    if (ref) label = { name: keywordLabel(ref.keyword), color: ref.category.color, sub: ref.category.name };
  } else if (focus?.type === 'category') {
    const category = index.categories.get(focus.id);
    if (category) label = { name: category.name, color: category.color, sub: '整个分类' };
  }

  return (
    <div className="navigator" role="group" aria-label="命中导航">
      {label ? (
        <span className="focus-chip" title={`聚焦：${label.sub} / ${label.name}（Esc 取消）`}>
          <span className="dot" style={{ background: label.color }} />
          <span className="focus-chip-name">{label.name}</span>
          <button type="button" className="focus-chip-clear" aria-label="取消聚焦" onClick={finder.clearFocus}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ) : (
        <span className="navigator-label">全部命中</span>
      )}
      <button
        type="button"
        className="icon-btn icon-btn-sm"
        aria-label="上一处"
        title="上一处（Shift+F3）"
        disabled={!navIds.length}
        onClick={() => finder.step(-1)}
      >
        <Icon name="chevron-up" />
      </button>
      <span className="navigator-count" aria-live="polite">
        {cursorPosition >= 0 ? cursorPosition + 1 : '–'} / {navIds.length}
      </span>
      <button
        type="button"
        className="icon-btn icon-btn-sm"
        aria-label="下一处"
        title="下一处（F3）"
        disabled={!navIds.length}
        onClick={() => finder.step(1)}
      >
        <Icon name="chevron-down" />
      </button>
    </div>
  );
}

function EmptyState({ onStartTyping, onLoadSample, onImport }: { onStartTyping: () => void; onLoadSample: () => void; onImport: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name="search" size={28} />
      </div>
      <h3>粘贴或输入一段内容，开始发现关键词</h3>
      <p>命中的关键词会按分类着色高亮，右侧实时给出统计与上下文。也可以把文本文件直接拖到这里。</p>
      <div className="empty-actions">
        <button type="button" className="btn btn-primary" onClick={onStartTyping}>
          <Icon name="edit" size={14} />
          开始输入
        </button>
        <button type="button" className="btn" onClick={onLoadSample}>
          <Icon name="sparkles" size={14} />
          加载示例
        </button>
        <button type="button" className="btn" onClick={onImport}>
          <Icon name="upload" size={14} />
          导入文件
        </button>
      </div>
    </div>
  );
}

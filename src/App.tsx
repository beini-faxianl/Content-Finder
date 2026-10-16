import { useCallback, useEffect, useRef, useState } from 'react';
import { batchHitsCsv, batchSummaryCsv, type BatchItem, type BatchSource } from './core/batch';
import { keywordLabel } from './core/library';
import { createSuggester } from './core/replace';
import {
  fileStamp,
  toCsvReport,
  toHtmlReport,
  toJsonReport,
  toMarkdownReport,
  toPlainSummary,
  type ReportInput,
} from './core/report';
import type { KeywordType } from './core/types';
import { SAMPLES } from './data/samples';
import { AppHeader, type ExportFormat } from './components/AppHeader';
import { BatchModal } from './components/batch/BatchModal';
import { ContentPane, type ViewMode } from './components/content/ContentPane';
import { HelpDialog } from './components/HelpDialog';
import { LibraryManager } from './components/library/LibraryManager';
import { RegexReference } from './components/library/RegexReference';
import { ResultsPanel, type RevisionScope } from './components/results/ResultsPanel';
import { FeedbackProvider, useFeedback } from './components/ui/feedback';
import { isTypingTarget, useHotkeys } from './hooks/useHotkeys';
import { useBatch } from './state/useBatch';
import { useFinder } from './state/useFinder';
import { copyText, downloadText, readTextFile } from './utils/file';

export default function App() {
  return (
    <FeedbackProvider>
      <Workspace />
    </FeedbackProvider>
  );
}

/** 一次批量检测最多处理的文件数 */
const MAX_BATCH_FILES = 500;

const EXPORTS: Record<ExportFormat, { ext: string; mime: string; build: (input: ReportInput) => string }> = {
  md: { ext: 'md', mime: 'text/markdown', build: toMarkdownReport },
  html: { ext: 'html', mime: 'text/html', build: toHtmlReport },
  csv: { ext: 'csv', mime: 'text/csv', build: toCsvReport },
  json: { ext: 'json', mime: 'application/json', build: toJsonReport },
};

function Workspace() {
  const finder = useFinder();
  const { toast, confirm } = useFeedback();
  const [mode, setMode] = useState<ViewMode>(() => (finder.text ? 'read' : 'edit'));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [regexRefOpen, setRegexRefOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const batch = useBatch(finder.library, finder.settings.match);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 已保存的词库在加载时合并了新版预置内容：提示一次
  const upgradeNoticeShown = useRef(false);
  useEffect(() => {
    if (!finder.libraryUpgraded || upgradeNoticeShown.current) return;
    upgradeNoticeShown.current = true;
    toast('预置词库已更新：新增例外词（误报排除）与替换建议，你的修改均已保留', 'info');
  }, [finder.libraryUpgraded, toast]);

  const changeMode = useCallback((next: ViewMode) => {
    setMode(next);
    if (next === 'edit') requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
  }, []);

  /** 替换当前内容；若当前是用户自己的内容（不是示例，也不是批量检测中的某一条），先确认 */
  const replaceContent = async (text: string, source: string, note?: string) => {
    const current = finder.text;
    const isOwnContent =
      current.trim() !== '' &&
      current !== text &&
      !SAMPLES.some((s) => s.text === current) &&
      !batch.items.some((item) => item.text === current);
    if (
      isOwnContent &&
      !(await confirm({ title: '替换当前内容', message: `当前内容将被${source}替换，确定继续吗？`, confirmText: '替换' }))
    )
      return;
    finder.setText(text);
    finder.clearFocus();
    setMode('read');
    toast(note ? `已加载${source}：${note}` : `已加载${source}`);
  };

  const importFile = async (file: File) => {
    try {
      const { text, note } = await readTextFile(file, { html: finder.settings.htmlImport });
      if (!text.trim()) throw new Error('文件内容为空');
      await replaceContent(text, `「${file.name}」`, note);
    } catch (error) {
      toast(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  /** 多个文件进入批量检测，单个文件直接打开 */
  const importFiles = (files: File[]) => {
    if (files.length > 1) void startBatchFiles(files);
    else if (files.length === 1) void importFile(files[0]);
  };

  const startBatchFiles = async (files: File[]) => {
    if (files.length > MAX_BATCH_FILES) toast(`一次最多检测 ${MAX_BATCH_FILES} 个文件，已取前 ${MAX_BATCH_FILES} 个`, 'warning');
    setBatchOpen(true);
    const sources: BatchSource[] = [];
    for (const file of files.slice(0, MAX_BATCH_FILES)) {
      try {
        const { text } = await readTextFile(file, { html: finder.settings.htmlImport });
        sources.push(text.trim() ? { name: file.name, text } : { name: file.name, error: '文件内容为空' });
      } catch (error) {
        sources.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    void batch.run(sources);
  };

  /** 打开批量检测中的一条：载入编辑区，并提供回到列表的入口 */
  const openBatchItem = async (item: BatchItem) => {
    setBatchOpen(false);
    await replaceContent(item.text, `「${item.name}」`);
    toast(`已打开「${item.name}」`, { tone: 'info', action: { label: '返回列表', onClick: () => setBatchOpen(true) } });
  };

  const exportBatch = (kind: 'summary' | 'hits') => {
    const stamp = fileStamp();
    if (kind === 'summary') {
      downloadText(`批量检测汇总-${stamp}.csv`, batchSummaryCsv(batch.items), 'text/csv');
    } else {
      const index = batch.index ?? finder.index;
      const csv = batchHitsCsv(batch.items, index, finder.settings.contextRadius, (item) =>
        createSuggester(item.text, index, finder.settings.match),
      );
      downloadText(`批量检测命中明细-${stamp}.csv`, csv, 'text/csv');
    }
    toast('已导出');
  };

  const loadSample = (id: string) => {
    const sample = SAMPLES.find((s) => s.id === id) ?? SAMPLES[0];
    void replaceContent(sample.text, `示例「${sample.title}」`);
  };

  const reportInput = (): ReportInput => ({
    text: finder.analyzedText,
    hits: finder.analysis.hits,
    stats: finder.stats,
    index: finder.index,
    options: finder.settings.match,
    contextRadius: finder.settings.contextRadius,
    excluded: finder.analysis.excluded,
    suggester: finder.suggester,
  });

  const exportReport = (format: ExportFormat) => {
    if (!finder.analyzedText.trim()) {
      toast('没有可导出的内容', 'info');
      return;
    }
    const { ext, mime, build } = EXPORTS[format];
    downloadText(`内容发现报告-${fileStamp()}.${ext}`, build(reportInput()), mime);
    toast('报告已导出');
  };

  const addTerms = (categoryId: string, terms: string[], type: KeywordType = 'text') => {
    const result = finder.addTerms(categoryId, terms, type);
    const category = finder.index.categories.get(categoryId);
    if (!result || !category) return;
    if (result.added.length) {
      const label = result.added.length === 1 ? `「${keywordLabel(result.added[0])}」` : `${result.added.length} 个关键词`;
      toast(`已将${label}加入「${category.name}」`);
    } else if (result.duplicates.length) {
      toast(`「${result.duplicates[0]}」已在「${category.name}」中`, 'info');
    } else if (result.invalid.length) {
      toast(`正则无效：${result.invalid[0].message}`, 'error');
    }
  };

  const addExclusion = (term: string, categoryId: string) => {
    const result = finder.addExclusionTerms(categoryId, [term]);
    const category = finder.index.categories.get(categoryId);
    if (!result || !category) return;
    if (!result.added.length) {
      toast(`「${term}」已是「${category.name}」的例外词`, 'info');
      return;
    }
    toast(`已将「${term}」设为「${category.name}」的例外词，其中的命中不再计入`, {
      action: {
        label: '撤销',
        onClick: () =>
          finder.setLibrary((lib) => ({
            ...lib,
            categories: lib.categories.map((c) =>
              c.id === categoryId ? { ...c, exclusions: c.exclusions.filter((t) => t !== result.added[0]) } : c,
            ),
          })),
      },
    });
  };

  /** 按替换建议修订正文，并提供撤销 */
  const applySuggestions = (scope?: RevisionScope) => {
    const result = finder.applySuggestions(scope);
    if (!result) {
      toast(finder.isStale ? '正在分析最新内容，请稍后再试' : '没有可替换的命中', 'info');
      return;
    }
    toast(`已按建议修订 ${result.count} 处`, {
      action: {
        label: '撤销',
        onClick: () => {
          if (!result.undo()) toast('内容已再次修改，无法撤销', 'info');
        },
      },
    });
  };

  /** 清空内容：不再弹确认框，改为提供撤销 */
  const clearContent = () => {
    const previous = finder.text;
    finder.setText('');
    finder.clearFocus();
    changeMode('edit');
    toast('已清空内容', {
      tone: 'info',
      action: {
        label: '撤销',
        onClick: () => {
          finder.setText(previous);
          setMode('read');
        },
      },
    });
  };

  const openHelpUnlessTyping = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return false;
    setHelpOpen(true);
  };

  useHotkeys({
    'mod+e': () => changeMode(mode === 'edit' ? 'read' : 'edit'),
    f3: () => finder.step(1),
    'shift+f3': () => finder.step(-1),
    'mod+k': () => setLibraryOpen(true),
    'mod+o': () => fileRef.current?.click(),
    escape: () => {
      if (!finder.focus) return false;
      finder.clearFocus();
    },
    '?': openHelpUnlessTyping,
    '？': openHelpUnlessTyping,
  });

  return (
    <div className="app">
      <AppHeader
        finder={finder}
        onLoadSample={loadSample}
        onImport={() => fileRef.current?.click()}
        onOpenBatch={() => setBatchOpen(true)}
        batchCount={batch.items.length}
        batchRunning={batch.running}
        onOpenLibrary={() => setLibraryOpen(true)}
        onExport={exportReport}
        onCopySummary={async () => {
          if (await copyText(toPlainSummary(reportInput()))) toast('结果摘要已复制');
        }}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <main className="workspace">
        <ContentPane
          finder={finder}
          mode={mode}
          onModeChange={changeMode}
          textareaRef={textareaRef}
          onImportFiles={importFiles}
          onRequestImport={() => fileRef.current?.click()}
          onLoadSample={() => loadSample(SAMPLES[0].id)}
          onOpenLibrary={() => setLibraryOpen(true)}
          onCopyText={async () => {
            if (await copyText(finder.text)) toast('已复制全文');
          }}
          onClear={clearContent}
          onAddKeyword={(term, categoryId) => addTerms(categoryId, [term])}
          onAddExclusion={addExclusion}
        />
        <ResultsPanel
          finder={finder}
          onOpenLibrary={() => setLibraryOpen(true)}
          onAddTerms={addTerms}
          onApplySuggestions={applySuggestions}
        />
      </main>

      <LibraryManager
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        library={finder.library}
        onChange={finder.setLibrary}
        errors={finder.ruleErrors}
        stats={finder.stats}
        matchOptions={finder.settings.match}
        contentText={finder.text}
        excluded={finder.analysis.excluded}
      />
      <BatchModal
        open={batchOpen}
        onClose={() => setBatchOpen(false)}
        batch={batch}
        onStartFiles={(files) => void startBatchFiles(files)}
        onStartSources={(sources) => void batch.run(sources)}
        onOpenItem={(item) => void openBatchItem(item)}
        onExport={exportBatch}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} onOpenRegexReference={() => setRegexRefOpen(true)} />
      <RegexReference
        open={regexRefOpen}
        onClose={() => setRegexRefOpen(false)}
        options={finder.settings.match}
        contentText={finder.text}
      />

      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          importFiles(files);
        }}
      />
    </div>
  );
}

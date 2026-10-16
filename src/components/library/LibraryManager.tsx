import { useMemo, useRef, useState } from 'react';
import { toCsv } from '../../core/csv';
import {
  countExclusions,
  countKeywords,
  createCategory,
  libraryToCsvRows,
  mergeLibraries,
  parseLibraryCsv,
  validateLibrary,
} from '../../core/library';
import { fileStamp } from '../../core/report';
import type { Stats } from '../../core/stats';
import type { Category, KeywordLibrary, MatchOptions, RuleError } from '../../core/types';
import { createPresetLibrary } from '../../data/presetLibrary';
import { cx } from '../../utils/cx';
import { downloadText, readTextFile } from '../../utils/file';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Menu, Popover } from '../ui/Popover';
import { Switch } from '../ui/controls';
import { CategoryEditor } from './CategoryEditor';

interface LibraryManagerProps {
  open: boolean;
  onClose: () => void;
  library: KeywordLibrary;
  onChange: (library: KeywordLibrary) => void;
  errors: RuleError[];
  stats: Stats;
  matchOptions: MatchOptions;
  contentText: string;
  /** 当前内容中各分类被例外词排除的命中数 */
  excluded: Record<string, number>;
}

interface PendingImport {
  fileName: string;
  library: KeywordLibrary;
}

export function LibraryManager(props: LibraryManagerProps) {
  const { open, onClose, library, onChange, errors, stats, matchOptions, contentText, excluded } = props;
  const { toast, confirm } = useFeedback();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = library.categories.find((c) => c.id === selectedId) ?? library.categories[0] ?? null;
  const q = query.trim().toLowerCase();
  const errorsByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of errors) map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + 1);
    return map;
  }, [errors]);

  const matchCount = (category: Category) =>
    q
      ? category.keywords.filter((k) => k.term.toLowerCase().includes(q) || (k.note ?? '').toLowerCase().includes(q)).length
      : category.keywords.length;

  const updateCategory = (id: string, update: (c: Category) => Category) =>
    onChange({ ...library, categories: library.categories.map((c) => (c.id === id ? update(c) : c)) });

  const addCategory = () => {
    const category = createCategory(library, `新分类 ${library.categories.length + 1}`);
    onChange({ ...library, categories: [...library.categories, category] });
    setSelectedId(category.id);
    setQuery('');
  };

  const deleteCategory = async (category: Category) => {
    if (
      category.keywords.length &&
      !(await confirm({
        title: '删除分类',
        message: (
          <>
            确定删除「{category.name}」及其 <b>{category.keywords.length}</b> 个关键词吗？此操作无法撤销。
          </>
        ),
        confirmText: '删除',
        danger: true,
      }))
    )
      return;
    const index = library.categories.indexOf(category);
    const rest = library.categories.filter((c) => c.id !== category.id);
    onChange({ ...library, categories: rest });
    setSelectedId(rest[Math.min(index, rest.length - 1)]?.id ?? null);
    toast(`已删除分类「${category.name}」`);
  };

  const moveCategory = (category: Category, delta: -1 | 1) => {
    const list = [...library.categories];
    const from = list.indexOf(category);
    const to = from + delta;
    if (to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to], list[from]];
    onChange({ ...library, categories: list });
  };

  const onImportFile = async (file: File) => {
    try {
      const { text } = await readTextFile(file);
      const parsed = /\.csv$/i.test(file.name) ? parseLibraryCsv(text) : validateLibrary(JSON.parse(text));
      if (!parsed.categories.length) throw new Error('文件中没有分类');
      setPendingImport({ fileName: file.name, library: parsed });
    } catch (error) {
      const message = error instanceof SyntaxError ? 'JSON 格式错误' : error instanceof Error ? error.message : String(error);
      toast(`导入失败：${message}`, 'error');
    }
  };

  const applyImport = (mode: 'merge' | 'replace') => {
    if (!pendingImport) return;
    if (mode === 'replace') {
      onChange(pendingImport.library);
      setSelectedId(pendingImport.library.categories[0]?.id ?? null);
      toast(`已替换为导入的词库（${pendingImport.library.categories.length} 个分类）`);
    } else {
      const result = mergeLibraries(library, pendingImport.library);
      onChange(result.library);
      toast(
        `合并完成：新增 ${result.addedCategories} 个分类、${result.addedKeywords} 个关键词` +
          (result.addedExclusions ? `、${result.addedExclusions} 个例外词` : ''),
      );
    }
    setPendingImport(null);
  };

  const resetToPreset = async () => {
    const ok = await confirm({
      title: '恢复默认词库',
      message: '将用内置的预设分类与关键词覆盖当前词库，你的自定义修改会丢失。建议先导出备份。',
      confirmText: '恢复默认',
      danger: true,
    });
    if (!ok) return;
    const preset = createPresetLibrary();
    onChange(preset);
    setSelectedId(preset.categories[0].id);
    toast('已恢复默认词库');
  };

  const exportLibrary = (format: 'json' | 'csv') => {
    const name = `关键词库-${fileStamp()}`;
    if (format === 'json') downloadText(`${name}.json`, JSON.stringify(library, null, 2), 'application/json');
    else downloadText(`${name}.csv`, toCsv(libraryToCsvRows(library)), 'text/csv');
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        className="library-modal"
        title="关键词库"
        subtitle={`${library.categories.length} 个分类 · ${countKeywords(library)} 个关键词 · ${countExclusions(library)} 个例外词 · 修改即时生效并自动保存`}
      >
        <div className="lib-layout">
          <aside className="lib-sidebar">
            <label className="search-field">
              <Icon name="search" size={14} />
              <input
                type="search"
                placeholder="搜索关键词或备注"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="搜索关键词"
              />
            </label>
            <ul className="lib-cat-list" aria-label="分类列表">
              {library.categories.map((c) => {
                const count = matchCount(c);
                if (q && count === 0) return null;
                const errorCount = errorsByCategory.get(c.id) ?? 0;
                return (
                  <li key={c.id}>
                    <div
                      className={cx('lib-cat', selected?.id === c.id && 'is-selected', !c.enabled && 'is-disabled')}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span className="dot" style={{ background: c.color }} />
                      <button
                        type="button"
                        className="lib-cat-name"
                        aria-current={selected?.id === c.id ? 'true' : undefined}
                        onClick={() => setSelectedId(c.id)}
                      >
                        {c.name}
                      </button>
                      {errorCount > 0 && (
                        <span className="lib-cat-error" title={`${errorCount} 条正则无效`}>
                          <Icon name="alert" size={13} />
                        </span>
                      )}
                      <span className="lib-cat-count">{count}</span>
                      <Switch
                        size="sm"
                        checked={c.enabled}
                        label={c.enabled ? `停用 ${c.name}` : `启用 ${c.name}`}
                        onChange={(enabled) => updateCategory(c.id, (cat) => ({ ...cat, enabled }))}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn btn-block lib-add-cat" onClick={addCategory}>
              <Icon name="plus" size={14} />
              新建分类
            </button>
            <div className="lib-sidebar-footer">
              <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} title="导入 JSON 或 CSV 词库">
                <Icon name="upload" size={14} />
                导入
              </button>
              <Popover
                align="start"
                trigger={({ open: menuOpen, toggle }) => (
                  <button type="button" className="btn btn-sm" aria-expanded={menuOpen} onClick={toggle}>
                    <Icon name="download" size={14} />
                    导出
                  </button>
                )}
              >
                {(close) => (
                  <Menu
                    close={close}
                    label="导出词库"
                    items={[
                      { key: 'json', label: 'JSON（完整，可再导入）', onSelect: () => exportLibrary('json') },
                      { key: 'csv', label: 'CSV（可用 Excel 编辑）', onSelect: () => exportLibrary('csv') },
                    ]}
                  />
                )}
              </Popover>
              <button type="button" className="btn btn-sm" onClick={resetToPreset} title="恢复内置的默认词库">
                <Icon name="reset" size={14} />
                默认
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void onImportFile(file);
                }}
              />
            </div>
          </aside>

          <section className="lib-detail">
            {selected ? (
              <CategoryEditor
                key={selected.id}
                category={selected}
                position={library.categories.indexOf(selected)}
                total={library.categories.length}
                query={q}
                errors={errors.filter((e) => e.categoryId === selected.id)}
                stats={stats}
                matchOptions={matchOptions}
                contentText={contentText}
                excludedCount={excluded[selected.id] ?? 0}
                onChange={(update) => updateCategory(selected.id, update)}
                onMove={(delta) => moveCategory(selected, delta)}
                onDelete={() => void deleteCategory(selected)}
              />
            ) : (
              <div className="panel-empty">
                <p>还没有任何分类</p>
                <button type="button" className="btn btn-primary" onClick={addCategory}>
                  新建分类
                </button>
              </div>
            )}
          </section>
        </div>
      </Modal>

      <Modal
        open={pendingImport !== null}
        size="sm"
        title="导入词库"
        onClose={() => setPendingImport(null)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setPendingImport(null)}>
              取消
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => applyImport('replace')}>
              替换现有词库
            </button>
            <button type="button" className="btn btn-primary" onClick={() => applyImport('merge')} data-autofocus>
              合并
            </button>
          </>
        }
      >
        {pendingImport && (
          <div className="confirm-message">
            从 <b>{pendingImport.fileName}</b> 读取到 <b>{pendingImport.library.categories.length}</b> 个分类、
            <b>{countKeywords(pendingImport.library)}</b> 个关键词
            {countExclusions(pendingImport.library) > 0 && (
              <>
                、<b>{countExclusions(pendingImport.library)}</b> 个例外词
              </>
            )}
            。
            <ul className="import-options">
              <li>
                <b>合并</b>：同名分类合并关键词（自动去重），新分类追加到末尾
              </li>
              <li>
                <b>替换</b>：用导入的词库完全覆盖当前词库
              </li>
            </ul>
          </div>
        )}
      </Modal>
    </>
  );
}

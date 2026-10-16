import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { addKeywords, CATEGORY_PALETTE, keywordKey, keywordLabel, splitKeywordInput } from '../../core/library';
import { validateRegex } from '../../core/matcher';
import type { Stats } from '../../core/stats';
import {
  LEVEL_LABEL,
  type Category,
  type Keyword,
  type KeywordType,
  type Level,
  type MatchOptions,
  type RuleError,
} from '../../core/types';
import { cx } from '../../utils/cx';
import { copyText } from '../../utils/file';
import { Segmented, Switch } from '../ui/controls';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/Icon';
import { ExclusionEditor } from './ExclusionEditor';
import { RegexReference } from './RegexReference';

interface CategoryEditorProps {
  category: Category;
  position: number;
  total: number;
  /** 侧栏中的搜索词（小写），用于过滤关键词 */
  query: string;
  errors: RuleError[];
  stats: Stats;
  /** 当前匹配选项，正则测试按同样的规则运行 */
  matchOptions: MatchOptions;
  /** 当前正文，可在正则测试中使用 */
  contentText: string;
  /** 当前内容中被本分类例外词排除的命中数 */
  excludedCount: number;
  onChange: (update: (c: Category) => Category) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}

const LEVELS: Level[] = ['info', 'warning', 'danger'];

/** 分类级匹配设置：跟随全局 / 开 / 关 */
type Tri = 'inherit' | 'on' | 'off';
const toTri = (value: boolean | undefined): Tri => (value === undefined ? 'inherit' : value ? 'on' : 'off');

function withOverride(category: Category, key: 'wholeWord' | 'caseSensitive', tri: Tri): Category {
  const next = { ...category };
  if (tri === 'inherit') delete next[key];
  else next[key] = tri === 'on';
  return next;
}
const REPLACEMENT_HELP = '「一键修订」时用它替换命中。$& 表示命中原文；正则还可用 $1、$2… 引用分组，例如手机号脱敏 $1****$2';
const TYPE_OPTIONS: Array<{ value: KeywordType; label: string; title: string }> = [
  { value: 'text', label: '文本', title: '普通关键词，支持批量输入' },
  { value: 'regex', label: '正则', title: '正则表达式，每行一条' },
];

export function CategoryEditor(props: CategoryEditorProps) {
  const { category, position, total, query, errors, stats, matchOptions, contentText, excludedCount, onChange, onMove, onDelete } =
    props;
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(category.name);
  const [draft, setDraft] = useState('');
  const [draftType, setDraftType] = useState<KeywordType>('text');
  const [draftNote, setDraftNote] = useState('');
  const [draftReplacement, setDraftReplacement] = useState('');
  const [editing, setEditing] = useState<(Keyword & { error?: string }) | null>(null);
  /** 正则速查从哪里打开：新增输入框（记录打开时预填的那一行）或编辑表单 */
  const [regexRef, setRegexRef] = useState<{ target: 'draft'; initial: string } | { target: 'editing' } | null>(null);

  const errorById = new Map(errors.map((e) => [e.keywordId, e.message]));
  const visible = query
    ? category.keywords.filter((k) => k.term.toLowerCase().includes(query) || (k.note ?? '').toLowerCase().includes(query))
    : category.keywords;

  const commitName = () => {
    const trimmed = name.trim() || '未命名分类';
    setName(trimmed);
    if (trimmed !== category.name) onChange((c) => ({ ...c, name: trimmed }));
  };

  const add = () => {
    const terms = splitKeywordInput(draft, draftType);
    if (!terms.length) return;
    const result = addKeywords(category, terms, draftType, {
      note: draftNote.trim() || undefined,
      replacement: draftReplacement || undefined,
    });
    if (result.added.length) onChange(() => result.category);

    const parts: string[] = [];
    if (result.added.length) parts.push(`已添加 ${result.added.length} 个`);
    if (result.duplicates.length) parts.push(`${result.duplicates.length} 个已存在`);
    if (result.invalid.length) parts.push(`${result.invalid.length} 个正则无效：${result.invalid[0].message}`);
    toast(parts.join('，'), result.invalid.length ? 'error' : result.added.length ? 'success' : 'info');

    // 只保留未能添加的非法正则，方便修改
    setDraft(result.invalid.map((i) => i.term).join('\n'));
  };

  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      add();
    }
  };

  const removeKeyword = (keyword: Keyword) => {
    const position = category.keywords.findIndex((k) => k.id === keyword.id);
    onChange((c) => ({ ...c, keywords: c.keywords.filter((k) => k.id !== keyword.id) }));
    if (editing?.id === keyword.id) setEditing(null);
    toast(`已删除「${keywordLabel(keyword)}」`, {
      tone: 'info',
      action: {
        label: '撤销',
        onClick: () =>
          onChange((c) =>
            c.keywords.some((k) => k.id === keyword.id)
              ? c
              : { ...c, keywords: [...c.keywords.slice(0, position), keyword, ...c.keywords.slice(position)] },
          ),
      },
    });
  };

  const saveEditing = () => {
    if (!editing) return;
    const term = editing.type === 'regex' ? editing.term : editing.term.trim();
    if (!term.trim()) return setEditing({ ...editing, error: '关键词不能为空' });
    if (editing.type === 'regex') {
      const error = validateRegex(term);
      if (error) return setEditing({ ...editing, error: `正则无效：${error}` });
    }
    const duplicate = category.keywords.some(
      (k) =>
        k.id !== editing.id &&
        k.type === editing.type &&
        (k.type === 'text' ? k.term.toLowerCase() === term.toLowerCase() : k.term === term),
    );
    if (duplicate) return setEditing({ ...editing, error: '该分类中已存在相同的关键词' });

    const note = editing.note?.trim();
    const updated: Keyword = {
      id: editing.id,
      term,
      type: editing.type,
      ...(note ? { note } : {}),
      ...(editing.replacement ? { replacement: editing.replacement } : {}),
    };
    onChange((c) => ({ ...c, keywords: c.keywords.map((k) => (k.id === editing.id ? updated : k)) }));
    setEditing(null);
  };

  const openRegexForDraft = () => {
    const lines = draftType === 'regex' ? draft.split('\n').filter((l) => l.trim()) : [];
    setRegexRef({ target: 'draft', initial: lines[lines.length - 1] ?? '' });
  };

  /** 把速查中选定的表达式填回：新增时替换预填的那一行（或追加一行），编辑时替换当前表达式 */
  const applyRegex = (pattern: string, name?: string, replacement?: string) => {
    if (regexRef?.target === 'editing' && editing) {
      setEditing({
        ...editing,
        term: pattern,
        type: 'regex',
        note: editing.note || name,
        replacement: editing.replacement || replacement,
        error: undefined,
      });
    } else {
      const initial = regexRef?.target === 'draft' ? regexRef.initial : '';
      const lines = draftType === 'regex' ? draft.split('\n').filter((l) => l.trim()) : [];
      const index = initial ? lines.lastIndexOf(initial) : -1;
      if (index >= 0) lines[index] = pattern;
      else lines.push(pattern);
      setDraftType('regex');
      setDraft(lines.join('\n'));
      if (name && !draftNote.trim()) setDraftNote(name);
      if (replacement && !draftReplacement) setDraftReplacement(replacement);
      toast('已填入输入框，按回车或点击「添加」生效', 'info');
    }
    setRegexRef(null);
  };

  const clearKeywords = async () => {
    const ok = await confirm({
      title: '清空关键词',
      message: `确定清空「${category.name}」中的全部 ${category.keywords.length} 个关键词吗？`,
      confirmText: '清空',
      danger: true,
    });
    if (ok) onChange((c) => ({ ...c, keywords: [] }));
  };

  return (
    <div className="cat-editor" style={{ '--c': category.color } as CSSProperties}>
      <div className="cat-editor-head">
        <span className="cat-editor-swatch" />
        <input
          className="input cat-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          aria-label="分类名称"
          maxLength={30}
        />
        <div className="cat-editor-actions">
          <button type="button" className="icon-btn" title="上移（越靠前，重叠时颜色优先级越高）" aria-label="上移" disabled={position === 0} onClick={() => onMove(-1)}>
            <Icon name="arrow-up" />
          </button>
          <button type="button" className="icon-btn" title="下移" aria-label="下移" disabled={position === total - 1} onClick={() => onMove(1)}>
            <Icon name="arrow-down" />
          </button>
          <label className="inline-switch">
            <Switch checked={category.enabled} label="启用此分类" onChange={(enabled) => onChange((c) => ({ ...c, enabled }))} />
            <span>{category.enabled ? '已启用' : '已停用'}</span>
          </label>
          <button type="button" className="icon-btn icon-btn-danger" title="删除分类" aria-label="删除分类" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </div>
      </div>

      <div className="form-grid">
        <span className="form-label">颜色</span>
        <div className="swatches" role="radiogroup" aria-label="分类颜色">
          {CATEGORY_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={category.color === color}
              aria-label={color}
              className={cx('swatch', category.color === color && 'is-active')}
              style={{ background: color }}
              onClick={() => onChange((c) => ({ ...c, color }))}
            />
          ))}
          <label className="swatch swatch-custom" title="自定义颜色">
            <input
              type="color"
              value={category.color}
              onChange={(e) => onChange((c) => ({ ...c, color: e.target.value }))}
              aria-label="自定义颜色"
            />
            <Icon name="plus" size={12} />
          </label>
        </div>

        <span className="form-label">级别</span>
        <div className="form-inline">
          <Segmented
            size="sm"
            label="提示级别"
            value={category.level}
            onChange={(level) => onChange((c) => ({ ...c, level }))}
            options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
          />
          <span className="form-help">「风险」级命中会让整体结论显示为存在风险</span>
        </div>

        <span className="form-label">匹配</span>
        <div className="form-inline">
          <Segmented
            size="sm"
            label="英文整词匹配"
            value={toTri(category.wholeWord)}
            onChange={(t) => onChange((c) => withOverride(c, 'wholeWord', t))}
            options={[
              { value: 'inherit', label: `整词：跟随全局（${matchOptions.wholeWord ? '整词' : '子串'}）` },
              { value: 'on', label: '整词' },
              { value: 'off', label: '子串' },
            ]}
          />
          <Segmented
            size="sm"
            label="大小写"
            value={toTri(category.caseSensitive)}
            onChange={(t) => onChange((c) => withOverride(c, 'caseSensitive', t))}
            options={[
              { value: 'inherit', label: `大小写：跟随全局（${matchOptions.caseSensitive ? '区分' : '忽略'}）` },
              { value: 'on', label: '区分' },
              { value: 'off', label: '忽略' },
            ]}
          />
          <span className="form-help">代码与报文常用「子串」，让 password 也能命中 db_password、dbPassword</span>
        </div>

        <span className="form-label">说明</span>
        <input
          className="input"
          value={category.description}
          placeholder="这一类关键词的含义，悬停命中时展示"
          onChange={(e) => onChange((c) => ({ ...c, description: e.target.value }))}
          aria-label="分类说明"
        />
      </div>

      <div className="kw-add">
        <div className="kw-add-row">
          <textarea
            className="input kw-add-input"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onDraftKeyDown}
            placeholder={
              draftType === 'text'
                ? '输入关键词，多个用逗号、顿号或换行分隔，回车添加'
                : '每行一条正则，例如 1[3-9]\\d{9}，回车添加（Shift+回车换行）'
            }
            aria-label="新关键词"
          />
          <div className="kw-add-side">
            <Segmented size="sm" label="关键词类型" value={draftType} onChange={setDraftType} options={TYPE_OPTIONS} />
            <button type="button" className="btn btn-primary btn-sm" onClick={add} disabled={!draft.trim()}>
              <Icon name="plus" size={14} />
              添加
            </button>
          </div>
        </div>
        {draftType === 'regex' && (
          <div className="kw-regex-hint">
            <Icon name="info" size={13} />
            <span>JavaScript 正则语法，每行一条，无需写 /…/ 与标志</span>
            <button type="button" className="link-btn" onClick={openRegexForDraft}>
              语法速查与测试
            </button>
          </div>
        )}
        <div className="kw-add-meta">
          <input
            className="input input-sm"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="备注（可选）：命中时展示，例如违规原因"
            aria-label="新关键词备注"
          />
          <input
            className={cx('input input-sm', draftType === 'regex' && 'mono')}
            value={draftReplacement}
            onChange={(e) => setDraftReplacement(e.target.value)}
            placeholder={draftType === 'regex' ? '建议替换为（可选），如 $1****$2' : '建议替换为（可选），如「优质」'}
            title={REPLACEMENT_HELP}
            aria-label="新关键词的替换建议"
          />
        </div>
      </div>

      <div className="kw-list-head">
        <span>
          关键词 <b>{category.keywords.length}</b>
          {query && <span className="muted">（筛选出 {visible.length} 个）</span>}
        </span>
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!category.keywords.length}
          onClick={async () => {
            await copyText(category.keywords.map((k) => k.term).join('\n'));
            toast('已复制全部关键词');
          }}
        >
          <Icon name="copy" size={14} />
          复制
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!category.keywords.length} onClick={() => void clearKeywords()}>
          <Icon name="trash" size={14} />
          清空
        </button>
      </div>

      {editing && (
        <div className="kw-edit">
          <div className="kw-edit-row">
            <input
              className={cx('input', editing.type === 'regex' && 'mono')}
              value={editing.term}
              onChange={(e) => setEditing({ ...editing, term: e.target.value, error: undefined })}
              onKeyDown={(e) => e.key === 'Enter' && saveEditing()}
              aria-label="关键词"
              autoFocus
            />
            <Segmented
              size="sm"
              label="关键词类型"
              value={editing.type}
              onChange={(type) => setEditing({ ...editing, type, error: undefined })}
              options={TYPE_OPTIONS}
            />
          </div>
          <div className="kw-add-meta">
            <input
              className="input input-sm"
              value={editing.note ?? ''}
              onChange={(e) => setEditing({ ...editing, note: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && saveEditing()}
              placeholder="备注（可选）"
              aria-label="备注"
            />
            <input
              className={cx('input input-sm', editing.type === 'regex' && 'mono')}
              value={editing.replacement ?? ''}
              onChange={(e) => setEditing({ ...editing, replacement: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && saveEditing()}
              placeholder="建议替换为（可选）"
              title={REPLACEMENT_HELP}
              aria-label="替换建议"
            />
          </div>
          {editing.error && <div className="form-error">{editing.error}</div>}
          <div className="kw-edit-actions">
            <button type="button" className="btn btn-ghost btn-sm icon-btn-danger" onClick={() => removeKeyword(editing)}>
              删除
            </button>
            <span className="toolbar-spacer" />
            {editing.type === 'regex' && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRegexRef({ target: 'editing' })}>
                <Icon name="code" size={14} />
                语法与测试
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={saveEditing}>
              保存
            </button>
          </div>
        </div>
      )}

      <div className="lib-kw-list">
        {visible.length === 0 && (
          <div className="panel-empty">{query ? '没有匹配的关键词' : '还没有关键词，在上方输入添加'}</div>
        )}
        {visible.map((k) => {
          const error = errorById.get(k.id);
          const hits = stats.keywords.get(keywordKey(category.id, k.id))?.count ?? 0;
          return (
            <span
              key={k.id}
              className={cx('lib-kw', k.type === 'regex' && 'is-regex', error && 'is-invalid', editing?.id === k.id && 'is-editing')}
            >
              <button
                type="button"
                className="lib-kw-main"
                onClick={() => setEditing({ ...k })}
                title={[
                  error ? `错误：${error}` : '',
                  k.note ? `备注：${k.note}` : '',
                  k.replacement !== undefined ? `建议替换为：${k.replacement}` : '',
                  hits ? `当前内容命中 ${hits} 次` : '',
                  '点击编辑',
                ]
                  .filter(Boolean)
                  .join('\n')}
              >
                {k.type === 'regex' && <span className="regex-badge">正则</span>}
                <span className="lib-kw-term">{k.term}</span>
                {k.replacement !== undefined && <span className="lib-kw-rep">→ {k.replacement}</span>}
                {k.note && <span className="lib-kw-note-dot" aria-label="有备注" />}
                {hits > 0 && <span className="lib-kw-hits">{hits}</span>}
              </button>
              <button type="button" className="lib-kw-remove" aria-label={`删除 ${k.term}`} onClick={() => removeKeyword(k)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          );
        })}
      </div>

      <ExclusionEditor category={category} excludedCount={excludedCount} onChange={onChange} />

      <RegexReference
        open={regexRef !== null}
        onClose={() => setRegexRef(null)}
        options={matchOptions}
        contentText={contentText}
        initialPattern={regexRef?.target === 'editing' ? editing?.term : regexRef?.initial}
        onUse={applyRegex}
      />
    </div>
  );
}

import { useState } from 'react';
import { addExclusions, splitKeywordInput } from '../../core/library';
import type { Category } from '../../core/types';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/Icon';

interface ExclusionEditorProps {
  category: Category;
  /** 当前内容中被本分类例外词排除的命中数 */
  excludedCount: number;
  onChange: (update: (c: Category) => Category) => void;
}

/**
 * 例外词（误报控制）：命中如果完整落在例外词之内就不计入。
 * 例如为「最佳」添加例外「最佳实践」，为「担心」添加例外「不用担心」。
 */
export function ExclusionEditor({ category, excludedCount, onChange }: ExclusionEditorProps) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState('');

  const add = () => {
    const terms = splitKeywordInput(draft, 'text');
    if (!terms.length) return;
    const result = addExclusions(category, terms);
    if (result.added.length) onChange(() => result.category);
    toast(
      [
        result.added.length && `已添加 ${result.added.length} 个例外词`,
        result.duplicates.length && `${result.duplicates.length} 个已存在`,
      ]
        .filter(Boolean)
        .join('，'),
      result.added.length ? 'success' : 'info',
    );
    setDraft('');
  };

  const remove = (term: string) => {
    const position = category.exclusions.indexOf(term);
    onChange((c) => ({ ...c, exclusions: c.exclusions.filter((t) => t !== term) }));
    toast(`已删除例外词「${term}」`, {
      tone: 'info',
      action: {
        label: '撤销',
        onClick: () =>
          onChange((c) =>
            c.exclusions.includes(term)
              ? c
              : { ...c, exclusions: [...c.exclusions.slice(0, position), term, ...c.exclusions.slice(position)] },
          ),
      },
    });
  };

  return (
    <section className="exclusions" aria-labelledby="exclusions-title">
      <div className="kw-list-head">
        <span id="exclusions-title">
          <Icon name="shield" size={14} /> 例外词 <b>{category.exclusions.length}</b>
        </span>
        {excludedCount > 0 && <span className="muted">· 当前内容中已排除 {excludedCount} 处</span>}
      </div>
      <p className="form-help exclusions-help">
        误报控制：本分类的命中如果完整落在某个例外词之内，就不计入。例如为「最佳」添加「最佳实践」，为「担心」添加「不用担心」。也可以在阅读模式下划选短语，点「设为例外」。
      </p>
      <div className="exclusion-add">
        <input
          className="input input-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) add();
          }}
          placeholder="输入例外词，多个用逗号、顿号分隔，回车添加"
          aria-label="新例外词"
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!draft.trim()} aria-label="添加例外词">
          添加
        </button>
      </div>
      {category.exclusions.length > 0 && (
        <div className="lib-kw-list">
          {category.exclusions.map((term) => (
            <span key={term} className="lib-kw is-exclusion">
              <span className="lib-kw-main">
                <span className="lib-kw-term">{term}</span>
              </span>
              <button type="button" className="lib-kw-remove" aria-label={`删除例外词 ${term}`} onClick={() => remove(term)}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

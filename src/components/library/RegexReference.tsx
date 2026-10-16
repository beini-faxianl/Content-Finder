import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MatchOptions } from '../../core/types';
import { REGEX_SYNTAX, REGEX_TEMPLATES, REGEX_TEST_TEXT, REGEX_TIPS } from '../../data/regexReference';
import { useRegexTest } from '../../engine/useAnalysis';
import { cx } from '../../utils/cx';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';

/** 测试区最多处理的字符数与高亮数，避免误写的表达式拖慢界面 */
const MAX_TEST_CHARS = 5000;
const MAX_PREVIEW_MATCHES = 2000;
const EMPTY_RESULT = { matches: [], error: null, warnings: [], truncated: false };

interface RegexReferenceProps {
  open: boolean;
  onClose: () => void;
  options: Pick<MatchOptions, 'caseSensitive' | 'normalizeWidth' | 'decode'>;
  /** 当前正文，可一键作为测试文本 */
  contentText?: string;
  /** 打开时预填到测试区的表达式 */
  initialPattern?: string;
  /** 提供时显示「使用」按钮，把表达式填回关键词输入框；name 为模板名称（可作备注），replacement 为脱敏模板 */
  onUse?: (pattern: string, name?: string, replacement?: string) => void;
}

/** 正则表达式速查：分组语法表、常用模板、注意事项，以及与正式匹配规则一致的即时测试 */
export function RegexReference({ open, onClose, ...rest }: RegexReferenceProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      className="regex-modal"
      title="正则表达式速查"
      subtitle="JavaScript 正则语法 · 每个示例都可「试一试」，右侧按实际匹配规则即时测试"
    >
      <RegexReferenceBody {...rest} />
    </Modal>
  );
}

const SECTIONS = [
  ...REGEX_SYNTAX.map((g) => ({ id: g.id, title: g.title })),
  { id: 'templates', title: '常用模板' },
  { id: 'tips', title: '注意事项' },
];

function RegexReferenceBody({ options, contentText, initialPattern, onUse }: Omit<RegexReferenceProps, 'open' | 'onClose'>) {
  const [pattern, setPattern] = useState(initialPattern ?? '');
  const [sample, setSample] = useState(REGEX_TEST_TEXT);
  const mainRef = useRef<HTMLDivElement>(null);
  const testerRef = useRef<HTMLElement>(null);

  const testText = sample.slice(0, MAX_TEST_CHARS);
  // 在后台 Worker 中试运行，写出灾难性回溯的表达式也不会卡住页面
  const test = useRegexTest(pattern, testText, options, MAX_PREVIEW_MATCHES);
  const result = test?.result ?? EMPTY_RESULT;
  const previewText = test?.text ?? testText;
  const distinct = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of result.matches) counts.set(m.text, (counts.get(m.text) ?? 0) + 1);
    return [...counts];
  }, [result]);
  const template = REGEX_TEMPLATES.find((t) => t.pattern === pattern);

  const tryIt = (nextPattern: string, nextSample: string) => {
    setPattern(nextPattern);
    setSample(nextSample);
    testerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const jumpTo = (id: string) =>
    mainRef.current?.querySelector(`#rx-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  let status: string;
  if (!pattern) status = '输入表达式后实时显示命中';
  else if (!test) status = '计算中…';
  else if (result.error) status = result.error.startsWith('执行超时') ? result.error : `语法错误：${result.error}`;
  else status = `命中 ${result.matches.length}${result.truncated ? '+' : ''} 处`;

  return (
    <div className="rx-layout">
      <div className="rx-main" ref={mainRef}>
        <nav className="rx-nav" aria-label="章节">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => jumpTo(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>

        {REGEX_SYNTAX.map((group) => (
          <section key={group.id} id={`rx-${group.id}`} className="rx-section" aria-labelledby={`rx-${group.id}-title`}>
            <h3 id={`rx-${group.id}-title`}>{group.title}</h3>
            {group.description && <p className="rx-desc">{group.description}</p>}
            <table className="rx-table rx-table-syntax">
              <thead>
                <tr>
                  <th scope="col">语法</th>
                  <th scope="col">含义</th>
                  <th scope="col">示例</th>
                  <th scope="col">
                    <span className="sr-only">操作</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((row) => (
                  <tr key={row.syntax}>
                    <td>
                      <code className="rx-syntax">{row.syntax}</code>
                    </td>
                    <td>{row.meaning}</td>
                    <td>
                      <code className="rx-code">{row.example}</code>
                      <div className="rx-example">
                        <span className="rx-example-text">「{row.sample.replace(/\n/g, ' ↵ ')}」</span>
                        <Icon name="chevron-right" size={12} />
                        {row.expect.map((hit, i) => (
                          <span key={i} className="rx-hit">
                            {hit}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => tryIt(row.example, row.sample)}>
                        试一试
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <section id="rx-templates" className="rx-section" aria-labelledby="rx-templates-title">
          <h3 id="rx-templates-title">常用模板</h3>
          <p className="rx-desc">经过测试的现成表达式，可直接试用{onUse ? '，或一键填入关键词输入框' : ''}。</p>
          <table className="rx-table rx-table-templates">
            <thead>
              <tr>
                <th scope="col">名称</th>
                <th scope="col">表达式</th>
                <th scope="col">
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {REGEX_TEMPLATES.map((t) => (
                <tr key={t.id}>
                  <td className="rx-template-name">{t.name}</td>
                  <td>
                    <code className="rx-code">{t.pattern}</code>
                    <div className="rx-example">
                      {t.description}
                      {t.replacement && (
                        <span className="rx-mask">
                          脱敏：<code>{t.replacement}</code>
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="rx-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => tryIt(t.pattern, t.sample)}>
                        试一试
                      </button>
                      {onUse && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onUse(t.pattern, t.name, t.replacement)}
                          aria-label={`使用模板 ${t.name}`}
                        >
                          使用
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section id="rx-tips" className="rx-section" aria-labelledby="rx-tips-title">
          <h3 id="rx-tips-title">注意事项</h3>
          <ul className="rx-tips">
            {REGEX_TIPS.map((tip) => (
              <li key={tip}>
                <InlineCode text={tip} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="rx-tester" ref={testerRef} aria-label="即时测试">
        <div className="rx-tester-head">
          <Icon name="code" />
          即时测试
        </div>

        <label className="rx-label" htmlFor="rx-pattern">
          表达式
        </label>
        <input
          id="rx-pattern"
          className={cx('input mono', result.error && 'is-invalid')}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="例如 \d+元"
          spellCheck={false}
          autoComplete="off"
          data-autofocus
        />
        <div className="rx-flags" aria-label="当前匹配规则">
          <span className="rx-flag">{options.caseSensitive ? '区分大小写' : '忽略大小写'}</span>
          <span className="rx-flag">多行：^ $ 按行</span>
          <span className="rx-flag">{options.normalizeWidth ? '全半角统一' : '区分全半角'}</span>
        </div>

        <div className="rx-label-row">
          <label htmlFor="rx-sample">测试文本</label>
          <span className="toolbar-spacer" />
          {contentText?.trim() && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSample(contentText)}>
              用当前内容
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSample(REGEX_TEST_TEXT)}>
            示例文本
          </button>
        </div>
        <textarea
          id="rx-sample"
          className="input rx-sample"
          rows={4}
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          spellCheck={false}
        />
        {sample.length > MAX_TEST_CHARS && <div className="rx-note">仅测试前 {MAX_TEST_CHARS} 个字符</div>}

        <div
          className={cx('rx-status', result.error ? 'is-error' : pattern && result.matches.length > 0 && 'is-ok')}
          role="status"
        >
          {status}
        </div>
        {result.warnings.map((w) => (
          <div key={w} className="rx-warning">
            <Icon name="alert" size={14} />
            <span>{w}</span>
          </div>
        ))}

        <div className={cx('rx-preview', test?.pending && 'is-pending')} aria-label="命中预览">
          <Preview text={previewText} matches={result.matches} />
        </div>

        {distinct.length > 0 && (
          <div className="rx-distinct" aria-label="命中内容">
            {distinct.slice(0, 30).map(([text, count]) => (
              <span key={text} className="rx-hit">
                {text}
                {count > 1 && <b>×{count}</b>}
              </span>
            ))}
            {distinct.length > 30 && <span className="rx-note">等 {distinct.length} 种</span>}
          </div>
        )}

        {onUse && (
          <button
            type="button"
            className="btn btn-primary btn-block rx-use"
            disabled={!pattern.trim() || !!result.error}
            onClick={() => onUse(pattern, template?.name, template?.replacement)}
          >
            <Icon name="check" size={14} />
            使用此表达式
          </button>
        )}
      </aside>
    </div>
  );
}

function Preview({ text, matches }: { text: string; matches: Array<{ start: number; end: number }> }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of matches) {
    if (m.start > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, m.start)}</Fragment>);
    parts.push(
      <mark key={`m${m.start}`} className="rx-mark">
        {text.slice(m.start, m.end)}
      </mark>,
    );
    last = m.end;
  }
  parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}

/** 把 `反引号` 包裹的片段渲染为 <code> */
function InlineCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

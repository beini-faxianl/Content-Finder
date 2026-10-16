// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { createPresetLibrary } from './data/presetLibrary';

const markTexts = (container: HTMLElement, selector = '.reader mark.hl') =>
  [...container.querySelectorAll(selector)].map((m) => m.textContent);

describe('App', () => {
  it('renders the default sample with category highlights and a verdict', () => {
    const { container } = render(<App />);
    const marks = markTexts(container);
    expect(marks.length).toBeGreaterThan(20);
    expect(marks).toContain('人工智能');
    // "OpenAI" 中的 AI 不应被高亮
    expect(marks.filter((t) => t === 'AI')).toHaveLength(2);
    expect(screen.getByText('需要关注')).toBeTruthy();
  });

  it('focuses a keyword from the stats panel and steps through its hits', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: /^芯片\s*2$/ }));
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(container.querySelector('.reader .hl-layer')?.classList.contains('has-focus')).toBe(true);
    expect(container.querySelectorAll('.reader mark.is-focus')).toHaveLength(2);
    expect(container.querySelector('.reader mark.is-current')?.textContent).toBe('芯片');

    await user.keyboard('{F3}');
    expect(screen.getByText('2 / 2')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.getByText('全部命中')).toBeTruthy();
    expect(container.querySelector('.reader .has-focus')).toBeNull();
  });

  it('re-analyzes live while editing', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('radio', { name: /编辑/ }));
    const textarea = screen.getByLabelText('待分析的内容');
    await user.clear(textarea);
    await user.type(textarea, '这款产品全网第一，联系 13800138000');

    await waitFor(() => expect(screen.getByText('存在风险')).toBeTruthy());
    expect(markTexts(container, '.editor-backdrop mark.hl')).toEqual(['全网第一', '13800138000']);
  });

  it('adds a keyword through the library manager and highlights it immediately', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(markTexts(container)).not.toContain('深言科技');

    await user.click(screen.getByRole('button', { name: /关键词库/ }));
    const dialog = screen.getByRole('dialog', { name: '关键词库' });
    await user.type(within(dialog).getByLabelText('新关键词'), '深言科技{Enter}');
    await user.click(within(dialog).getByRole('button', { name: '关闭' }));

    expect(markTexts(container)).toContain('深言科技');
  });

  it('fills a regex template from the syntax reference and adds it as a keyword', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /关键词库/ }));
    const library = screen.getByRole('dialog', { name: '关键词库' });

    await user.click(within(library).getByRole('radio', { name: /正则/ }));
    await user.click(within(library).getByRole('button', { name: '语法速查与测试' }));
    const reference = screen.getByRole('dialog', { name: '正则表达式速查' });
    expect(within(reference).getAllByRole('table').length).toBeGreaterThan(5);

    // 试一试：右侧测试区载入示例并显示命中数
    const percentRow = within(reference).getByText('百分比').closest('tr')!;
    await user.click(within(percentRow).getByRole('button', { name: '试一试' }));
    expect(within(reference).getByRole('status').textContent).toBe('命中 2 处');

    await user.click(within(reference).getByRole('button', { name: '使用模板 百分比' }));
    expect(screen.queryByRole('dialog', { name: '正则表达式速查' })).toBeNull();
    const input = within(library).getByLabelText('新关键词') as HTMLTextAreaElement;
    expect(input.value).toBe('\\d+(?:\\.\\d+)?%');
    expect((within(library).getByLabelText('新关键词备注') as HTMLInputElement).value).toBe('百分比');

    await user.click(within(library).getByRole('button', { name: '添加' }));
    await user.click(within(library).getByRole('button', { name: '关闭' }));
    expect(markTexts(container)).toContain('30%');
  });

  it('revises the text by suggestions and can undo it', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /示例/ }));
    await user.click(screen.getByRole('menuitem', { name: /电商文案/ }));
    expect(markTexts(container)).toEqual(expect.arrayContaining(['全网第一', '13800138000']));

    await user.click(screen.getByRole('button', { name: '按建议修订' }));
    const reader = () => container.querySelector('.reader')!.textContent ?? '';
    await waitFor(() => expect(reader()).toContain('广受好评的补水神器'));
    expect(reader()).toContain('138****8000');
    expect(markTexts(container)).not.toContain('全网第一');
    // 医疗功效类承诺没有替换建议，留给人工处理
    expect(markTexts(container)).toContain('立即见效');

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(markTexts(container)).toContain('全网第一'));
  });

  it('filters the review list by level', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /示例/ }));
    await user.click(screen.getByRole('menuitem', { name: /客服工单/ }));
    await user.click(screen.getByRole('tab', { name: /命中上下文/ }));

    await user.click(screen.getByRole('radio', { name: /^风险/ }));
    const tags = [...container.querySelectorAll('.ctx-item .ctx-tag')].map((t) => t.textContent ?? '');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t.startsWith('个人敏感信息'))).toBe(true);
    expect(container.querySelector('.ctx-suggest')?.textContent).toContain('139****5678');
  });

  it('suppresses a false positive with an exclusion phrase', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /示例/ }));
    await user.click(screen.getByRole('menuitem', { name: /电商文案/ }));
    expect(markTexts(container)).toContain('全网第一');

    await user.click(screen.getByRole('button', { name: /关键词库/ }));
    const library = screen.getByRole('dialog', { name: '关键词库' });
    await user.click(within(library).getByRole('button', { name: '广告极限用语' }));
    await user.type(within(library).getByLabelText('新例外词'), '全网第一的补水神器{Enter}');
    await user.click(within(library).getByRole('button', { name: '关闭' }));

    expect(markTexts(container)).not.toContain('全网第一');
    expect(screen.getByText('已排除 1')).toBeTruthy();
  });

  it('clears the content with an undo instead of a confirmation', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: '清空内容' }));
    expect((screen.getByLabelText('待分析的内容') as HTMLTextAreaElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(markTexts(container)).toContain('人工智能'));
  });

  it('upgrades a library saved by an older version and says so once', () => {
    const old = createPresetLibrary();
    delete old.presetRevision;
    for (const category of old.categories) category.exclusions = [];
    localStorage.setItem('finder.library.v1', JSON.stringify(old));

    render(<App />);
    expect(screen.getByText(/预置词库已更新/)).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem('finder.library.v1')!);
    expect(saved.presetRevision).toBe(2);
    expect(saved.categories.find((c: { id: string }) => c.id === 'ad').exclusions).toContain('最佳实践');
  });

  it('reviews pasted lines in a batch, sorted by risk, and opens one in the editor', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: /批量检测/ }));
    const dialog = screen.getByRole('dialog', { name: '批量检测' });

    await user.type(within(dialog).getByLabelText('粘贴多条文本'), '全网第一的面霜{Enter}温和配方{Enter}申请退款');
    expect(within(dialog).getByText('共 3 条')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: '开始检测' }));

    await waitFor(() => expect(dialog.querySelectorAll('.batch-badge.is-pending')).toHaveLength(0));
    expect([...dialog.querySelectorAll('.batch-name-text')].map((e) => e.textContent)).toEqual(['第 1 行', '第 3 行', '第 2 行']);
    expect([...dialog.querySelectorAll('.batch-badge')].map((e) => e.textContent)).toEqual(['存在风险', '需要关注', '未发现命中']);

    await user.click(within(dialog).getByRole('button', { name: '打开 第 1 行' }));
    expect(screen.queryByRole('dialog', { name: '批量检测' })).toBeNull();
    await waitFor(() => expect(markTexts(container)).toEqual(['全网第一']));

    // 关闭后结果保留，可以回到列表继续处理
    await user.click(screen.getByRole('button', { name: '返回列表' }));
    expect(screen.getByRole('dialog', { name: '批量检测' }).querySelectorAll('.batch-row')).toHaveLength(3);
  });

  it('hides and restores a category from the legend', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const legend = screen.getByRole('toolbar', { name: '分类图例' });

    await user.click(within(legend).getByRole('button', { name: /地区地名/ }));
    expect(markTexts(container)).not.toContain('北京');

    await user.click(within(legend).getByRole('button', { name: /全部显示/ }));
    expect(markTexts(container)).toContain('北京');
  });

  it('loads a sample from the header menu', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.click(screen.getByRole('button', { name: /示例/ }));
    await user.click(screen.getByRole('menuitem', { name: /客服工单/ }));

    expect(markTexts(container)).toContain('zhangsan@example.com');
    expect(screen.getByText('存在风险')).toBeTruthy();
  });
});

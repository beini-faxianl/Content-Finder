import { describe, expect, it } from 'vitest';
import { indexLibrary } from './library';
import { analyze, compileLibrary } from './matcher';
import { fileStamp, toCsvReport, toHtmlReport, toJsonReport, toMarkdownReport, toPlainSummary, type ReportInput } from './report';
import { computeStats } from './stats';
import { makeLibrary } from './testUtils';
import { DEFAULT_MATCH_OPTIONS } from './types';

function input(text: string): ReportInput {
  const library = makeLibrary({ 科技: ['AI', '<b>'], 风险: { terms: ['最好'], level: 'danger' } });
  library.categories[1].keywords[0].note = '极限用语';
  const index = indexLibrary(library);
  const { hits } = analyze(text, compileLibrary(library, DEFAULT_MATCH_OPTIONS));
  return {
    text,
    hits,
    stats: computeStats(text, hits, library, index),
    index,
    options: DEFAULT_MATCH_OPTIONS,
    contextRadius: 5,
    generatedAt: new Date(2026, 9, 13, 9, 5),
  };
}

const TEXT = '第一行\nAI 是最好的工具 | 真的 <b>';

describe('reports', () => {
  it('builds a markdown report with summary, categories and escaped table cells', () => {
    const md = toMarkdownReport(input(TEXT));
    expect(md).toContain('# 内容发现报告');
    expect(md).toContain('2026-10-13 09:05');
    expect(md).toContain('**结论：存在风险**');
    expect(md).toContain('| 风险 | 风险 | 1 | 最好（1） |');
    expect(md).toContain('\\|'); // 上下文里的竖线被转义
    expect(md).toMatch(/\| 1 \| 2 \| 科技 \| AI \|/);
  });

  it('builds a CSV with BOM, header, line numbers and notes', () => {
    const rows = toCsvReport(input(TEXT)).split('\r\n');
    expect(rows[0].startsWith('\ufeff序号,行号')).toBe(true);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toContain('极限用语');
  });

  it('builds valid JSON', () => {
    const json = JSON.parse(toJsonReport(input(TEXT)));
    expect(json.summary.totalHits).toBe(3);
    expect(json.hits[1]).toMatchObject({ text: '最好', level: 'danger', line: 2 });
  });

  it('builds standalone HTML and escapes user text', () => {
    const html = toHtmlReport(input(TEXT));
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('&lt;b&gt;</mark>');
    expect(html).not.toContain('<b></mark>');
  });

  it('builds a short plain-text summary', () => {
    expect(toPlainSummary(input(TEXT))).toContain('风险（风险）1 处：最好×1');
  });

  it('formats file stamps', () => {
    expect(fileStamp(new Date(2026, 0, 2, 3, 4))).toBe('20260102-0304');
  });
});

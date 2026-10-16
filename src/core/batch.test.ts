import { describe, expect, it } from 'vitest';
import {
  batchHitsCsv,
  batchSummaryCsv,
  countByFilter,
  matchesFilter,
  sortByRisk,
  splitBatchText,
  topKeywords,
  type BatchItem,
} from './batch';
import { indexLibrary } from './library';
import { analyze, compileLibrary } from './matcher';
import { createSuggester } from './replace';
import { computeStats } from './stats';
import { makeLibrary } from './testUtils';
import { DEFAULT_MATCH_OPTIONS } from './types';

const library = makeLibrary({
  ad: { terms: ['最好 => 优质', '全网第一'], level: 'danger' },
  neg: { terms: ['退款'], level: 'warning' },
  info: ['北京'],
});
const index = indexLibrary(library);
const matcher = compileLibrary(library, DEFAULT_MATCH_OPTIONS);

function item(id: number, name: string, text: string): BatchItem {
  const { hits, excluded } = analyze(text, matcher);
  const stats = computeStats(text, hits, library, index);
  return { id, name, text, status: 'done', result: { hits, stats, excluded, top: topKeywords(stats) } };
}

describe('splitBatchText', () => {
  it('splits by line, skipping blank lines and keeping original line numbers', () => {
    expect(splitBatchText('甲\n\n  乙  \r\n丙', 'line')).toEqual([
      { name: '第 1 行', text: '甲' },
      { name: '第 3 行', text: '乙' },
      { name: '第 4 行', text: '丙' },
    ]);
  });

  it('splits by blank lines into paragraphs', () => {
    expect(splitBatchText('第一段\n续行\n\n\n第二段\n \n', 'paragraph')).toEqual([
      { name: '第 1 段', text: '第一段\n续行' },
      { name: '第 2 段', text: '第二段' },
    ]);
  });
});

describe('batch results', () => {
  const items: BatchItem[] = [
    item(0, '正常', '北京欢迎你'),
    item(1, '关注', '申请退款，退款'),
    item(2, '无命中', '你好'),
    item(3, '风险', '全网第一，最好的，北京'),
    { id: 4, name: '坏文件.bin', text: '', status: 'error', error: '看起来是二进制文件' },
  ];

  it('lists the most important keywords first: by level, then count', () => {
    expect(items[3].result!.top.map((t) => t.label)).toEqual(['全网第一', '最好', '北京']);
    expect(items[1].result!.top).toEqual([{ label: '退款', count: 2, color: '#3b82f6' }]);
  });

  it('sorts by risk and keeps input order within the same level', () => {
    expect(sortByRisk(items).map((i) => i.name)).toEqual(['风险', '关注', '坏文件.bin', '正常', '无命中']);
  });

  it('counts and filters by verdict', () => {
    expect(countByFilter(items)).toEqual({ all: 5, risk: 1, attention: 1, normal: 1, none: 1, error: 1 });
    expect(items.filter((i) => matchesFilter(i, 'error')).map((i) => i.name)).toEqual(['坏文件.bin']);
  });

  it('exports a summary row per item', () => {
    const rows = batchSummaryCsv(items).split('\r\n');
    expect(rows[0]).toBe('\ufeff序号,名称,字数,结论,风险,关注,提示,命中总数,涉及分类,例外词排除,主要命中');
    expect(rows[4]).toBe('4,风险,11,存在风险,2,0,1,3,2,0,全网第一×1、最好×1、北京×1');
    expect(rows[5]).toBe('5,坏文件.bin,,失败：看起来是二进制文件,,,,,,,');
  });

  it('exports every hit with line numbers and suggestions', () => {
    const csv = batchHitsCsv(items, index, 4, (i) => createSuggester(i.text, index, DEFAULT_MATCH_OPTIONS));
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(1 + 1 + 2 + 3);
    expect(rows).toContain('风险,1,最好,,ad,风险,最好,,优质,网第一，【最好】的，北京');
  });
});

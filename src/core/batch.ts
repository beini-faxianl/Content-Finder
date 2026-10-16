/**
 * 批量检测：一次检查多个文件或多条文本（例如一批商品文案、一周的客服工单、一列商品标题），
 * 按风险排序，逐条打开处理，并导出汇总与命中明细。
 */

import { buildLineIndex, getContext, lineAt } from './context';
import { toCsv } from './csv';
import { keywordKey, keywordLabel, type LibraryIndex } from './library';
import type { Suggester } from './replace';
import { hitLevel, VERDICT_TEXT, type Stats, type Verdict } from './stats';
import { LEVEL_LABEL, LEVEL_RANK, type Hit } from './types';

/** 待检测的一条：文件读取失败时只有 error */
export interface BatchSource {
  name: string;
  text?: string;
  error?: string;
}

/** 粘贴文本的拆分方式：每行一条（如商品标题列表），或以空行分段（如多条评论） */
export type BatchSplitMode = 'line' | 'paragraph';

export type BatchStatus = 'pending' | 'done' | 'error' | 'stopped';

export interface TopKeyword {
  label: string;
  count: number;
  color: string;
}

export interface BatchResult {
  hits: Hit[];
  stats: Stats;
  excluded: Record<string, number>;
  /** 最值得关注的几个关键词：先按级别、再按次数 */
  top: TopKeyword[];
}

export interface BatchItem {
  id: number;
  name: string;
  text: string;
  status: BatchStatus;
  error?: string;
  result?: BatchResult;
}

/** 拆分粘贴的文本，空行（或空段）跳过；名称保留原始行号，方便回到源表格定位 */
export function splitBatchText(text: string, mode: BatchSplitMode): BatchSource[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (mode === 'line') {
    return normalized.split('\n').flatMap((line, i) => (line.trim() ? [{ name: `第 ${i + 1} 行`, text: line.trim() }] : []));
  }
  return normalized
    .split(/\n[ \t　]*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, i) => ({ name: `第 ${i + 1} 段`, text: part }));
}

export function topKeywords(stats: Stats, limit = 3): TopKeyword[] {
  return stats.categories
    .flatMap((c) => c.keywords.map((k) => ({ category: c.category, keyword: k })))
    .sort(
      (a, b) =>
        LEVEL_RANK[b.category.level] - LEVEL_RANK[a.category.level] ||
        b.keyword.count - a.keyword.count ||
        a.keyword.term.localeCompare(b.keyword.term, 'zh-CN'),
    )
    .slice(0, limit)
    .map(({ category, keyword }) => {
      const source = category.keywords.find((k) => k.id === keyword.keywordId);
      return { label: source ? keywordLabel(source) : keyword.term, count: keyword.count, color: category.color };
    });
}

/** 排序用的结论权重：风险 > 关注 > 失败 > 正常 > 无命中 > 未完成 */
const VERDICT_WEIGHT: Record<Verdict, number> = { risk: 5, attention: 4, normal: 2, none: 1 };

function weight(item: BatchItem): number {
  if (item.status === 'error') return 3;
  if (item.status !== 'done' || !item.result) return 0;
  return VERDICT_WEIGHT[item.result.stats.summary.verdict];
}

/** 风险优先：先按结论，再按风险、关注、总命中数；其余保持原始顺序 */
export function sortByRisk(items: readonly BatchItem[]): BatchItem[] {
  return [...items].sort((a, b) => {
    const diff = weight(b) - weight(a);
    if (diff) return diff;
    const sa = a.result?.stats.summary;
    const sb = b.result?.stats.summary;
    if (sa && sb) {
      const levels = sb.byLevel.danger - sa.byLevel.danger || sb.byLevel.warning - sa.byLevel.warning || sb.totalHits - sa.totalHits;
      if (levels) return levels;
    }
    return a.id - b.id;
  });
}

export type BatchFilter = Verdict | 'error' | 'all';

export function matchesFilter(item: BatchItem, filter: BatchFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'error') return item.status === 'error';
  return item.status === 'done' && item.result?.stats.summary.verdict === filter;
}

export function countByFilter(items: readonly BatchItem[]): Record<BatchFilter, number> {
  const counts: Record<BatchFilter, number> = { all: items.length, risk: 0, attention: 0, normal: 0, none: 0, error: 0 };
  for (const item of items) {
    if (item.status === 'error') counts.error++;
    else if (item.status === 'done' && item.result) counts[item.result.stats.summary.verdict]++;
  }
  return counts;
}

const statusLabel = (item: BatchItem): string => {
  if (item.status === 'error') return `失败：${item.error ?? ''}`;
  if (item.status === 'stopped') return '已停止';
  if (item.status !== 'done' || !item.result) return '未检测';
  return VERDICT_TEXT[item.result.stats.summary.verdict].label;
};

/** 汇总表：每条一行 */
export function batchSummaryCsv(items: readonly BatchItem[]): string {
  const rows: Array<Array<string | number>> = [
    ['序号', '名称', '字数', '结论', '风险', '关注', '提示', '命中总数', '涉及分类', '例外词排除', '主要命中'],
  ];
  for (const item of items) {
    const summary = item.result?.stats.summary;
    rows.push([
      item.id + 1,
      item.name,
      summary?.charCount ?? '',
      statusLabel(item),
      summary?.byLevel.danger ?? '',
      summary?.byLevel.warning ?? '',
      summary?.byLevel.info ?? '',
      summary?.totalHits ?? '',
      summary?.categoriesHit ?? '',
      item.result ? Object.values(item.result.excluded).reduce((n, v) => n + v, 0) : '',
      item.result?.top.map((t) => `${t.label}×${t.count}`).join('、') ?? '',
    ]);
  }
  return toCsv(rows);
}

/** 命中明细：所有条目的全部命中，每处一行 */
export function batchHitsCsv(
  items: readonly BatchItem[],
  index: LibraryIndex,
  contextRadius: number,
  suggesterFor?: (item: BatchItem) => Suggester,
): string {
  const rows: Array<Array<string | number>> = [
    ['名称', '行号', '命中文本', '变体或解码', '分类', '级别', '关键词', '备注', '替换建议', '上下文'],
  ];
  for (const item of items) {
    if (!item.result?.hits.length) continue;
    const lineStarts = buildLineIndex(item.text);
    const suggester = suggesterFor?.(item);
    for (const hit of item.result.hits) {
      const refs = hit.entries.map((e) => index.keywords.get(keywordKey(e.categoryId, e.keywordId))).filter((r) => !!r);
      const ctx = getContext(item.text, hit, contextRadius);
      rows.push([
        item.name,
        lineAt(lineStarts, hit.start),
        hit.text,
        hit.variant ?? hit.decoded ?? '',
        [...new Set(refs.map((r) => r.category.name))].join('、'),
        LEVEL_LABEL[hitLevel(hit, index)],
        [...new Set(refs.map((r) => keywordLabel(r.keyword)))].join('、'),
        [...new Set(refs.map((r) => r.keyword.note).filter(Boolean))].join('；'),
        suggester?.first(hit)?.text ?? '',
        `${ctx.before}【${ctx.match}】${ctx.after}`,
      ]);
    }
  }
  return toCsv(rows);
}

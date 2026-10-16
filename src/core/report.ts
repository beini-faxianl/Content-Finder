import { buildLineIndex, getContext, lineAt } from './context';
import { toCsv } from './csv';
import { keywordKey, type LibraryIndex } from './library';
import type { Suggester } from './replace';
import { buildSegments } from './segments';
import { hitLevel, VERDICT_TEXT, type Stats } from './stats';
import { LEVEL_LABEL, type Hit, type MatchOptions } from './types';

export interface ReportInput {
  text: string;
  hits: Hit[];
  stats: Stats;
  index: LibraryIndex;
  options: MatchOptions;
  contextRadius: number;
  /** 被例外词排除的命中数（按分类） */
  excluded?: Record<string, number>;
  /** 提供时，报告中附带每处命中的替换建议 */
  suggester?: Suggester;
  generatedAt?: Date;
}

const totalExcluded = (input: ReportInput) => Object.values(input.excluded ?? {}).reduce((n, v) => n + v, 0);
const suggestionOf = (input: ReportInput, hit: Hit) => input.suggester?.first(hit)?.text ?? '';

/** Markdown 中最多列出的上下文条数，避免报告过长 */
const MAX_CONTEXT_ROWS = 300;

export function formatDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 用于文件名的时间戳：20261013-1530 */
export function fileStamp(date = new Date()): string {
  return formatDateTime(date).replace(/[-:]/g, '').replace(' ', '-');
}

function describeOptions(options: MatchOptions): string {
  return [
    options.caseSensitive ? '区分大小写' : '忽略大小写',
    options.wholeWord ? '英文整词匹配' : '英文子串匹配',
    options.normalizeWidth ? '全半角统一' : '全半角区分',
    options.overlap === 'longest' ? '最长优先' : '保留全部重叠',
  ].join(' · ');
}

const entryLabels = (hit: Hit, index: LibraryIndex) =>
  hit.entries.map((e) => {
    const ref = index.keywords.get(keywordKey(e.categoryId, e.keywordId));
    return { category: ref?.category.name ?? '?', keyword: ref?.keyword.term ?? '?', note: ref?.keyword.note ?? '' };
  });

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function toMarkdownReport(input: ReportInput): string {
  const { text, hits, stats, index, options, contextRadius } = input;
  const { summary } = stats;
  const date = input.generatedAt ?? new Date();
  const lines: string[] = [];

  lines.push('# 内容发现报告', '');
  lines.push(`> 生成时间：${formatDateTime(date)}　匹配选项：${describeOptions(options)}`, '');
  lines.push('## 概览', '');
  lines.push(`**结论：${VERDICT_TEXT[summary.verdict].label}** — ${VERDICT_TEXT[summary.verdict].detail}`, '');
  lines.push('| 指标 | 数值 |', '| --- | --- |');
  lines.push(`| 正文字数 | ${summary.charCount} |`);
  lines.push(`| 命中总数 | ${summary.totalHits} |`);
  lines.push(`| 命中关键词 | ${summary.uniqueKeywords} 个 |`);
  lines.push(`| 涉及分类 | ${summary.categoriesHit} / ${summary.enabledCategories} |`);
  lines.push(`| 命中密度 | ${summary.density.toFixed(1)} 次/千字 |`);
  lines.push(
    `| 级别分布 | 风险 ${summary.byLevel.danger} · 关注 ${summary.byLevel.warning} · 提示 ${summary.byLevel.info} |`,
  );
  if (totalExcluded(input)) lines.push(`| 例外词排除 | ${totalExcluded(input)} 处 |`);
  lines.push('');

  lines.push('## 分类统计', '');
  lines.push('| 分类 | 级别 | 命中次数 | 命中关键词（次数） |', '| --- | --- | ---: | --- |');
  for (const c of stats.categories) {
    if (!c.count) continue;
    const kws = c.keywords.map((k) => `${k.term}（${k.count}）`).join('、');
    lines.push(`| ${mdCell(c.category.name)} | ${LEVEL_LABEL[c.category.level]} | ${c.count} | ${mdCell(kws)} |`);
  }
  if (!summary.categoriesHit) lines.push('| — | — | 0 | — |');
  lines.push('');

  if (hits.length) {
    lines.push('## 命中明细', '');
    const withSuggestions = !!input.suggester && hits.some((hit) => suggestionOf(input, hit));
    lines.push(
      `| # | 行 | 分类 | 关键词 | 上下文 |${withSuggestions ? ' 建议 |' : ''}`,
      `| ---: | ---: | --- | --- | --- |${withSuggestions ? ' --- |' : ''}`,
    );
    const lineStarts = buildLineIndex(text);
    hits.slice(0, MAX_CONTEXT_ROWS).forEach((hit, i) => {
      const ctx = getContext(text, hit, contextRadius);
      const labels = entryLabels(hit, index);
      const decodedNote =
        (hit.decoded !== undefined ? `（解码：${hit.decoded}）` : '') + (hit.variant !== undefined ? `（变体：${hit.variant}）` : '');
      const snippet = `${ctx.clippedStart ? '…' : ''}${ctx.before}**${ctx.match}**${decodedNote}${ctx.after}${ctx.clippedEnd ? '…' : ''}`;
      const suggestion = withSuggestions ? ` ${mdCell(suggestionOf(input, hit))} |` : '';
      lines.push(
        `| ${i + 1} | ${lineAt(lineStarts, hit.start)} | ${mdCell([...new Set(labels.map((l) => l.category))].join('、'))} | ${mdCell(
          [...new Set(labels.map((l) => l.keyword))].join('、'),
        )} | ${mdCell(snippet)} |${suggestion}`,
      );
    });
    if (hits.length > MAX_CONTEXT_ROWS) lines.push('', `> 仅列出前 ${MAX_CONTEXT_ROWS} 条，共 ${hits.length} 条。`);
    lines.push('');
  }

  return lines.join('\n');
}

export function toCsvReport(input: ReportInput): string {
  const { text, hits, index, contextRadius } = input;
  const lineStarts = buildLineIndex(text);
  const rows: Array<Array<string | number>> = [
    ['序号', '行号', '起始位置', '结束位置', '命中文本', '解码后', '变体写法', '分类', '级别', '关键词', '备注', '替换建议', '上下文'],
  ];
  hits.forEach((hit, i) => {
    const ctx = getContext(text, hit, contextRadius);
    const labels = entryLabels(hit, index);
    rows.push([
      i + 1,
      lineAt(lineStarts, hit.start),
      hit.start,
      hit.end,
      hit.text,
      hit.decoded ?? '',
      hit.variant ?? '',
      [...new Set(labels.map((l) => l.category))].join('、'),
      LEVEL_LABEL[hitLevel(hit, index)],
      [...new Set(labels.map((l) => l.keyword))].join('、'),
      [...new Set(labels.map((l) => l.note).filter(Boolean))].join('；'),
      suggestionOf(input, hit),
      `${ctx.before}【${ctx.match}】${ctx.after}`,
    ]);
  });
  return toCsv(rows);
}

export function toJsonReport(input: ReportInput): string {
  const { text, hits, stats, index, options, contextRadius } = input;
  const lineStarts = buildLineIndex(text);
  return JSON.stringify(
    {
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      options,
      summary: {
        ...stats.summary,
        verdictLabel: VERDICT_TEXT[stats.summary.verdict].label,
        excludedByExceptions: totalExcluded(input),
      },
      categories: stats.categories
        .filter((c) => c.count)
        .map((c) => ({
          id: c.category.id,
          name: c.category.name,
          level: c.category.level,
          count: c.count,
          keywords: c.keywords.map((k) => ({ term: k.term, type: k.type, count: k.count, variants: k.variants })),
        })),
      hits: hits.map((hit) => {
        const ctx = getContext(text, hit, contextRadius);
        return {
          start: hit.start,
          end: hit.end,
          line: lineAt(lineStarts, hit.start),
          text: hit.text,
          ...(hit.decoded !== undefined ? { decoded: hit.decoded } : {}),
          ...(hit.variant !== undefined ? { variant: hit.variant } : {}),
          level: hitLevel(hit, index),
          matches: entryLabels(hit, index),
          ...(suggestionOf(input, hit) ? { suggestion: suggestionOf(input, hit) } : {}),
          context: `${ctx.before}${ctx.match}${ctx.after}`,
        };
      }),
    },
    null,
    2,
  );
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** 导出自包含的高亮 HTML，便于分享或归档 */
export function toHtmlReport(input: ReportInput): string {
  const { text, hits, stats, index } = input;
  const { summary } = stats;
  const date = input.generatedAt ?? new Date();
  const hitById = new Map(hits.map((h) => [h.id, h]));

  const body = buildSegments(text.length, hits)
    .map((seg) => {
      const content = escapeHtml(text.slice(seg.start, seg.end));
      if (!seg.hitIds.length) return content;
      const hit = hitById.get(seg.hitIds[0])!;
      const labels = entryLabels(hit, index);
      const color = index.categories.get(hit.entries[0].categoryId)?.color ?? '#888888';
      const title = labels.map((l) => `${l.category}：${l.keyword}${l.note ? `（${l.note}）` : ''}`).join('\n');
      return `<mark style="--c:${color}" title="${escapeHtml(title)}">${content}</mark>`;
    })
    .join('');

  const legend = stats.categories
    .filter((c) => c.count)
    .map(
      (c) =>
        `<span class="chip"><i style="background:${c.category.color}"></i>${escapeHtml(c.category.name)} <b>${c.count}</b></span>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>内容发现报告 ${formatDateTime(date)}</title>
<style>
  :root { color-scheme: light; --fg:#1f2937; --muted:#6b7280; --bg:#f7f7f8; --card:#fff; --line:#e5e7eb; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  main { max-width:880px; margin:0 auto; padding:32px 16px 64px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .meta { color:var(--muted); font-size:13px; margin-bottom:20px; }
  .summary { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; }
  .stat b { display:block; font-size:20px; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:12px; }
  .legend { display:flex; flex-wrap:wrap; gap:6px; margin:16px 0; }
  .chip { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border:1px solid var(--line); border-radius:999px; background:var(--card); font-size:13px; }
  .chip i { width:10px; height:10px; border-radius:50%; }
  article { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:24px; white-space:pre-wrap; word-break:break-word; line-height:1.9; }
  mark { color:inherit; background:color-mix(in srgb, var(--c) 22%, transparent); box-shadow:inset 0 -2px 0 var(--c); border-radius:3px; cursor:help; }
</style>
</head>
<body>
<main>
  <h1>内容发现报告</h1>
  <div class="meta">生成于 ${formatDateTime(date)} · 结论：${VERDICT_TEXT[summary.verdict].label} · 悬停高亮可查看分类与关键词</div>
  <div class="summary">
    <div class="stat"><b>${summary.totalHits}</b><span>命中总数</span></div>
    <div class="stat"><b>${summary.uniqueKeywords}</b><span>命中关键词</span></div>
    <div class="stat"><b>${summary.categoriesHit}/${summary.enabledCategories}</b><span>涉及分类</span></div>
    <div class="stat"><b>${summary.charCount}</b><span>正文字数</span></div>
  </div>
  <div class="legend">${legend}</div>
  <article>${body}</article>
</main>
</body>
</html>`;
}

/** 一段可直接粘贴到聊天工具的纯文本摘要 */
export function toPlainSummary(input: ReportInput): string {
  const { stats } = input;
  const { summary } = stats;
  const lines = [
    `【内容发现】${VERDICT_TEXT[summary.verdict].label}`,
    `字数 ${summary.charCount}，命中 ${summary.totalHits} 处，关键词 ${summary.uniqueKeywords} 个，涉及 ${summary.categoriesHit} 个分类`,
  ];
  for (const c of stats.categories) {
    if (!c.count) continue;
    const top = c.keywords
      .slice(0, 8)
      .map((k) => `${k.term}×${k.count}`)
      .join('，');
    lines.push(`· ${c.category.name}（${LEVEL_LABEL[c.category.level]}）${c.count} 处：${top}${c.keywords.length > 8 ? ' 等' : ''}`);
  }
  return lines.join('\n');
}

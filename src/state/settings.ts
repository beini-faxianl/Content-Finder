import { DEFAULT_MATCH_OPTIONS, type MatchOptions } from '../core/types';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  match: MatchOptions;
  theme: ThemePreference;
  /** 上下文列表中命中前后展示的字符数 */
  contextRadius: number;
  /** 隐藏高亮的分类 id */
  hiddenCategories: string[];
  /** 正文字号（px） */
  fontSize: number;
  /** 代码视图：等宽字体、不自动换行、显示行号，适合代码与 HTTP 报文 */
  codeView: boolean;
  /** 导入 HTML 文件时：提取正文，或保留源码（审查脚本、属性时需要） */
  htmlImport: HtmlImportMode;
}

export type HtmlImportMode = 'text' | 'source';

export const DEFAULT_SETTINGS: Settings = {
  match: DEFAULT_MATCH_OPTIONS,
  theme: 'system',
  contextRadius: 24,
  hiddenCategories: [],
  fontSize: 15,
  codeView: false,
  htmlImport: 'text',
};

export const CONTEXT_RADIUS_RANGE = { min: 8, max: 80 } as const;
export const FONT_SIZE_RANGE = { min: 13, max: 22 } as const;

const clampInt = (value: unknown, range: { min: number; max: number }, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(range.max, Math.max(range.min, Math.round(n))) : fallback;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 从存储中恢复设置，逐项校验，缺失或非法的字段使用默认值 */
export function restoreSettings(raw: unknown): Settings | undefined {
  if (!isRecord(raw)) return undefined;
  const match = isRecord(raw.match) ? raw.match : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

  return {
    match: {
      caseSensitive: bool(match.caseSensitive, DEFAULT_MATCH_OPTIONS.caseSensitive),
      wholeWord: bool(match.wholeWord, DEFAULT_MATCH_OPTIONS.wholeWord),
      normalizeWidth: bool(match.normalizeWidth, DEFAULT_MATCH_OPTIONS.normalizeWidth),
      decode: bool(match.decode, DEFAULT_MATCH_OPTIONS.decode),
      ignoreSeparators: bool(match.ignoreSeparators, DEFAULT_MATCH_OPTIONS.ignoreSeparators),
      overlap: match.overlap === 'all' ? 'all' : 'longest',
    },
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    contextRadius: clampInt(raw.contextRadius, CONTEXT_RADIUS_RANGE, DEFAULT_SETTINGS.contextRadius),
    hiddenCategories: Array.isArray(raw.hiddenCategories)
      ? raw.hiddenCategories.filter((v): v is string => typeof v === 'string')
      : [],
    fontSize: clampInt(raw.fontSize, FONT_SIZE_RANGE, DEFAULT_SETTINGS.fontSize),
    codeView: bool(raw.codeView, DEFAULT_SETTINGS.codeView),
    htmlImport: raw.htmlImport === 'source' ? 'source' : 'text',
  };
}

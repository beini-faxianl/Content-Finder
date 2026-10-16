/** 分类的提示级别：提示 / 关注 / 风险 */
export type Level = 'info' | 'warning' | 'danger';

/** 关键词类型：普通文本（Aho-Corasick 多模匹配）或正则表达式 */
export type KeywordType = 'text' | 'regex';

export interface Keyword {
  id: string;
  term: string;
  type: KeywordType;
  /** 备注：命中时在提示框中展示，例如违规原因 */
  note?: string;
  /**
   * 建议替换为：用于一键修订或脱敏。
   * `$&` 表示命中的原文；正则关键词还可用 `$1`、`$2`… 或 `$<名称>` 引用分组。
   */
  replacement?: string;
}

export interface Category {
  id: string;
  name: string;
  /** 十六进制颜色，如 #3b82f6 */
  color: string;
  level: Level;
  description: string;
  enabled: boolean;
  keywords: Keyword[];
  /**
   * 例外词（误报控制）：本分类的命中如果完整落在某个例外词之内，就不计入。
   * 例如为「最佳」添加例外「最佳实践」。
   */
  exclusions: string[];
  /** 本分类单独的英文整词匹配设置；未设置时跟随全局。代码类分类常需关闭以匹配 db_password 中的 password */
  wholeWord?: boolean;
  /** 本分类单独的大小写设置；未设置时跟随全局 */
  caseSensitive?: boolean;
}

export interface KeywordLibrary {
  version: 1;
  /** 基于哪一版预置词库；升级时据此把预置内容的改进合并进来 */
  presetRevision?: number;
  categories: Category[];
}

/**
 * 重叠处理策略：
 * - longest：最左最长优先，命中互不重叠（默认，适合阅读）
 * - all：保留所有命中，包括嵌套与交叉（适合审查）
 */
export type OverlapStrategy = 'longest' | 'all';

export interface MatchOptions {
  /** 区分大小写 */
  caseSensitive: boolean;
  /** 英文/数字关键词按整词匹配，避免 "AI" 命中 "said" */
  wholeWord: boolean;
  /** 全角字母数字符号按半角处理，"ＡＩ" 也能命中 "AI" */
  normalizeWidth: boolean;
  /** 先解码再匹配：URL 编码、\u / \x 转义、HTML 实体，代码与 HTTP 报文中的关键词才不会漏掉 */
  decode: boolean;
  /** 识别变体写法：中文关键词中间插入空格、符号、表情（如「全 网 第 一」）也能命中 */
  ignoreSeparators: boolean;
  overlap: OverlapStrategy;
}

/** 命中某个片段的一条关键词规则 */
export interface HitEntry {
  categoryId: string;
  keywordId: string;
}

/** 文本中的一处命中。同一区间若被多个关键词/分类命中，会合并为一个 Hit 的多个 entries。 */
export interface Hit {
  id: number;
  start: number;
  end: number;
  text: string;
  /** 按分类顺序排列，entries[0] 为主分类 */
  entries: HitEntry[];
  /** 命中原文经过解码时，解码后的文本（例如原文 %E6%89%8B%E6%9C%BA 对应「手机」） */
  decoded?: string;
  /** 变体写法：去掉夹在中间的干扰字符后的文本（例如原文「全 网 第 一」对应「全网第一」） */
  variant?: string;
}

export interface RuleError {
  categoryId: string;
  keywordId: string;
  message: string;
}

export interface AnalysisResult {
  hits: Hit[];
  elapsedMs: number;
  /** 某条正则命中数过多被截断 */
  truncated: boolean;
  /** 被例外词排除的命中数，按分类 id 统计 */
  excluded: Record<string, number>;
  /** 匹配前解码的编码数量（未开启解码或没有编码内容时均为 0） */
  decoded: DecodedCounts;
}

export interface DecodedCounts {
  /** URL 编码，如 %E6%89%8B */
  url: number;
  /** \u、\x 等转义 */
  unicode: number;
  /** HTML 实体，如 &lt; &#x624b; */
  html: number;
}

export const LEVEL_LABEL: Record<Level, string> = {
  info: '提示',
  warning: '关注',
  danger: '风险',
};

export const LEVEL_RANK: Record<Level, number> = { info: 0, warning: 1, danger: 2 };

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  caseSensitive: false,
  wholeWord: true,
  normalizeWidth: true,
  decode: true,
  ignoreSeparators: true,
  overlap: 'longest',
};

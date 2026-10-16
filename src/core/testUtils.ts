import type { Category, Keyword, KeywordLibrary, Level } from './types';

type CategorySpec =
  | string[]
  | {
      terms: string[];
      level?: Level;
      enabled?: boolean;
      exclusions?: string[];
      wholeWord?: boolean;
      caseSensitive?: boolean;
    };

/**
 * 测试辅助：用简洁的写法构造词库。
 * - 以 `re:` 开头的词视为正则
 * - `词 => 替换` 表示附带替换建议
 */
export function makeLibrary(spec: Record<string, CategorySpec>): KeywordLibrary {
  const categories: Category[] = Object.entries(spec).map(([id, value]) => {
    const { terms, level = 'info', enabled = true, exclusions = [], ...overrides } = Array.isArray(value)
      ? { terms: value }
      : value;
    return {
      id,
      name: id,
      color: '#3b82f6',
      level,
      description: '',
      enabled,
      exclusions,
      ...overrides,
      keywords: terms.map((raw, i): Keyword => {
        const [body, replacement] = raw.split(' => ');
        const regex = body.startsWith('re:');
        return {
          id: `${id}${i}`,
          term: regex ? body.slice(3) : body,
          type: regex ? 'regex' : 'text',
          ...(replacement !== undefined ? { replacement } : {}),
        };
      }),
    };
  });
  return { version: 1, categories };
}

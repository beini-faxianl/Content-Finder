import { describe, expect, it } from 'vitest';
import { testRegex } from '../core/matcher';
import { DEFAULT_MATCH_OPTIONS } from '../core/types';
import { REGEX_SYNTAX, REGEX_TEMPLATES, REGEX_TEST_TEXT } from './regexReference';

const matchTexts = (pattern: string, text: string) => {
  const result = testRegex(pattern, text, DEFAULT_MATCH_OPTIONS);
  expect(result.error, pattern).toBeNull();
  return result.matches.map((m) => m.text);
};

describe('regex reference', () => {
  for (const group of REGEX_SYNTAX) {
    for (const row of group.items) {
      it(`syntax ${group.id} › ${row.syntax}: ${row.example}`, () => {
        expect(matchTexts(row.example, row.sample)).toEqual(row.expect);
      });
    }
  }

  for (const template of REGEX_TEMPLATES) {
    it(`template ${template.name}`, () => {
      expect(matchTexts(template.pattern, template.sample)).toEqual(template.expect);
      // 模板不应触发任何提醒（例如孤立的全角字符）
      expect(testRegex(template.pattern, '', DEFAULT_MATCH_OPTIONS).warnings).toEqual([]);
    });
  }

  it('has unique ids', () => {
    const ids = [...REGEX_SYNTAX.map((g) => g.id), ...REGEX_TEMPLATES.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('default test text exercises several templates', () => {
    const hitTemplates = REGEX_TEMPLATES.filter((t) => matchTexts(t.pattern, REGEX_TEST_TEXT).length > 0);
    expect(hitTemplates.map((t) => t.id)).toEqual(
      expect.arrayContaining(['phone', 'landline', 'email', 'url', 'money', 'date', 'time', 'percent', 'repeat', 'superlative']),
    );
  });
});

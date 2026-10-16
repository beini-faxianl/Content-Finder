import { describe, expect, it } from 'vitest';
import type { KeywordLibrary } from '../core/types';
import { createPresetLibrary, PRESET_REVISION } from './presetLibrary';
import { upgradeLibrary } from './presetUpgrade';

const LEGACY_PHONE = '(?<!\\d)1[3-9]\\d{9}(?!\\d)';

/** 模拟修订 1 时保存下来的词库：无例外词、无替换建议、旧的正则写法、没有后来追加的关键词 */
function revision1Library(): KeywordLibrary {
  const library = createPresetLibrary();
  delete library.presetRevision;
  for (const category of library.categories) {
    category.exclusions = [];
    category.keywords = category.keywords
      .filter((k) => !(category.id === 'negative' && Number(k.id.split('-')[1]) > 36))
      .map(({ replacement: _replacement, ...k }) => k);
  }
  library.categories.find((c) => c.id === 'privacy')!.keywords[0].term = LEGACY_PHONE;
  return library;
}

describe('upgradeLibrary', () => {
  it('turns an untouched revision-1 library into the current preset', () => {
    const result = upgradeLibrary(revision1Library());
    expect(result.changed).toBe(true);
    expect(result.library).toEqual(createPresetLibrary());
  });

  it('keeps user changes and does not resurrect deleted items', () => {
    const library = revision1Library();
    const ad = library.categories.find((c) => c.id === 'ad')!;
    ad.keywords[0].term = '最佳选择'; // 用户改过的预置词
    ad.keywords[1].note = '自定义备注';
    ad.keywords.splice(2, 1); // 用户删掉的预置词「最强」
    library.categories = library.categories.filter((c) => c.id !== 'region'); // 用户删掉的分类
    library.categories.push({
      id: 'mine',
      name: '我的分类',
      color: '#000000',
      level: 'info',
      description: '',
      enabled: true,
      keywords: [{ id: 'k1', term: '自定义', type: 'text' }],
      exclusions: [],
    });

    const upgraded = upgradeLibrary(library).library;
    const upgradedAd = upgraded.categories.find((c) => c.id === 'ad')!;
    expect(upgradedAd.keywords[0]).toMatchObject({ term: '最佳选择' });
    expect(upgradedAd.keywords[0].replacement).toBeUndefined();
    expect(upgradedAd.keywords[1]).toMatchObject({ term: '最好', note: '自定义备注', replacement: '优质' });
    expect(upgradedAd.keywords.some((k) => k.term === '最强')).toBe(false);
    expect(upgradedAd.exclusions).toContain('最佳实践');
    expect(upgraded.categories.some((c) => c.id === 'region')).toBe(false);
    expect(upgraded.categories.find((c) => c.id === 'mine')).toEqual(library.categories.find((c) => c.id === 'mine'));
    expect(upgraded.presetRevision).toBe(PRESET_REVISION);
  });

  it('is a no-op for libraries already on the current revision', () => {
    const library = createPresetLibrary();
    expect(upgradeLibrary(library)).toEqual({ library, changed: false });
  });

  it('only stamps the revision on libraries unrelated to the preset', () => {
    const library: KeywordLibrary = { version: 1, categories: [] };
    expect(upgradeLibrary(library)).toEqual({ library: { ...library, presetRevision: PRESET_REVISION }, changed: false });
  });
});

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addExclusions, addKeywords, indexLibrary, keywordKey, validateLibrary } from '../core/library';
import { applyReplacements, createSuggester, planReplacements, type Replacement } from '../core/replace';
import { computeStats } from '../core/stats';
import type { Hit, HitEntry, KeywordLibrary, KeywordType, MatchOptions } from '../core/types';
import { createPresetLibrary } from '../data/presetLibrary';
import { upgradeLibrary } from '../data/presetUpgrade';
import { SAMPLES } from '../data/samples';
import { useAnalysis } from '../engine/useAnalysis';
import { usePersistentState } from '../hooks/usePersistentState';
import { STORAGE_KEYS } from '../utils/storage';
import { DEFAULT_SETTINGS, restoreSettings, type Settings, type ThemePreference } from './settings';

/** 当前聚焦的对象：某个关键词或整个分类 */
export type Focus = { type: 'keyword'; key: string } | { type: 'category'; id: string };

interface CursorState {
  id: number;
  /** 每次跳转自增，保证重复跳到同一处也会触发滚动 */
  seq: number;
  /** 光标所属的分析结果；文本变化后旧光标自动失效 */
  hits: Hit[];
}

/** 一次修订的结果，可在内容未再变化时撤销 */
export interface RevisionResult {
  count: number;
  undo: () => boolean;
}

const restoreText = (raw: unknown) => (typeof raw === 'string' ? raw : undefined);

export function sameFocus(a: Focus, b: Focus): boolean {
  if (a.type === 'keyword') return b.type === 'keyword' && a.key === b.key;
  return b.type === 'category' && a.id === b.id;
}

export function useFinder() {
  // 读取已保存的词库时顺带合并预置词库的改进；只在加载时发生一次
  const [libraryUpgraded] = useState(() => ({ value: false }));
  const restoreLibrary = useCallback(
    (raw: unknown): KeywordLibrary | undefined => {
      try {
        const { library, changed } = upgradeLibrary(validateLibrary(raw));
        if (changed) libraryUpgraded.value = true;
        return library;
      } catch {
        return undefined;
      }
    },
    [libraryUpgraded],
  );

  const [library, setLibrary] = usePersistentState(STORAGE_KEYS.library, createPresetLibrary, restoreLibrary);
  const [settings, setSettings] = usePersistentState<Settings>(STORAGE_KEYS.settings, () => DEFAULT_SETTINGS, restoreSettings);
  const [text, setText, contentPersist] = usePersistentState(STORAGE_KEYS.content, () => SAMPLES[0].text, restoreText, 400);

  // 分析在后台 Worker 中进行：输入时编辑框先更新，高亮稍后跟上，规则再复杂也不会卡住页面
  const analysisState = useAnalysis(text, library, settings.match);
  const analyzedText = analysisState.text;
  const analysis = analysisState.result;

  const index = useMemo(() => indexLibrary(library), [library]);
  const stats = useMemo(
    () => computeStats(analyzedText, analysis.hits, library, index),
    [analyzedText, analysis.hits, library, index],
  );
  const hitsById = useMemo(() => new Map(analysis.hits.map((h) => [h.id, h])), [analysis.hits]);

  const hidden = useMemo(() => new Set(settings.hiddenCategories), [settings.hiddenCategories]);
  const visibleHits = useMemo(
    () => (hidden.size ? analysis.hits.filter((h) => h.entries.some((e) => !hidden.has(e.categoryId))) : analysis.hits),
    [analysis.hits, hidden],
  );

  /** 命中所属可见分类的颜色（去重，主分类在前）；全部隐藏时退回主分类颜色 */
  const colorsOf = useCallback(
    (hit: Hit) => {
      const colors: string[] = [];
      for (const entry of hit.entries) {
        if (hidden.has(entry.categoryId)) continue;
        const color = index.categories.get(entry.categoryId)?.color;
        if (color && !colors.includes(color)) colors.push(color);
      }
      return colors.length ? colors : [index.categories.get(hit.entries[0]?.categoryId)?.color ?? '#888888'];
    },
    [hidden, index],
  );

  // ---------- 替换建议与修订 ----------
  const suggester = useMemo(() => createSuggester(analyzedText, index, settings.match), [analyzedText, index, settings.match]);
  const isVisibleEntry = useCallback((entry: HitEntry) => !hidden.has(entry.categoryId), [hidden]);

  /** 当前可见的、带替换建议的命中（「一键修订」的范围） */
  const fixPlan = useMemo(
    () => planReplacements(visibleHits, suggester, (_hit, entry) => isVisibleEntry(entry)),
    [visibleHits, suggester, isVisibleEntry],
  );
  const fixableByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of library.categories) {
      if (!category.enabled || hidden.has(category.id)) continue;
      if (!category.keywords.some((k) => k.replacement !== undefined)) continue;
      const n = planReplacements(visibleHits, suggester, (_hit, entry) => entry.categoryId === category.id).length;
      if (n) counts.set(category.id, n);
    }
    return counts;
  }, [library, hidden, visibleHits, suggester]);

  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  });

  const applyPlan = useCallback(
    (plan: Replacement[]): RevisionResult | null => {
      // 计划基于已分析的文本；编辑框里有尚未分析的输入时不执行，避免位置错乱
      if (!plan.length || latestText.current !== analyzedText) return null;
      const before = analyzedText;
      const after = applyReplacements(before, plan);
      setText(after);
      return {
        count: plan.length,
        undo: () => {
          if (latestText.current !== after) return false;
          setText(before);
          return true;
        },
      };
    },
    [analyzedText, setText],
  );

  /** 按建议修订：可限定分类或一组命中，默认处理全部可见命中 */
  const applySuggestions = useCallback(
    (scope: { categoryId?: string; hitIds?: number[] } = {}) => {
      if (!fixPlan.length) return null;
      const hitIds = scope.hitIds && new Set(scope.hitIds);
      const plan = planReplacements(
        hitIds ? visibleHits.filter((h) => hitIds.has(h.id)) : visibleHits,
        suggester,
        (_hit, entry) => isVisibleEntry(entry) && (scope.categoryId === undefined || entry.categoryId === scope.categoryId),
      );
      return applyPlan(plan);
    },
    [fixPlan, visibleHits, suggester, isVisibleEntry, applyPlan],
  );

  /** 某处命中的替换建议（按分类优先级取第一个） */
  const suggestionFor = useCallback(
    (hit: Hit) => suggester.first(hit, isVisibleEntry)?.text ?? null,
    [suggester, isVisibleEntry],
  );

  // ---------- 聚焦与导航 ----------
  const [focusState, setFocusState] = useState<Focus | null>(null);
  const focus = useMemo(() => {
    if (!focusState) return null;
    if (focusState.type === 'keyword') return index.keywords.get(focusState.key)?.category.enabled ? focusState : null;
    return stats.categories.some((c) => c.category.id === focusState.id) ? focusState : null;
  }, [focusState, stats, index]);

  const focusHitIds = useMemo(() => {
    if (!focus) return null;
    if (focus.type === 'keyword') return stats.keywords.get(focus.key)?.hitIds ?? [];
    return stats.categories.find((c) => c.category.id === focus.id)?.hitIds ?? [];
  }, [focus, stats]);

  const focusSet = useMemo(() => (focusHitIds ? new Set(focusHitIds) : null), [focusHitIds]);

  /** 可导航的命中（按出现顺序） */
  const navIds = useMemo(() => {
    const visible = visibleHits.map((h) => h.id);
    if (!focusSet) return visible;
    return visible.filter((id) => focusSet.has(id));
  }, [visibleHits, focusSet]);

  const [cursorState, setCursorState] = useState<CursorState | null>(null);
  const cursor = cursorState && cursorState.hits === analysis.hits ? cursorState : null;
  const cursorPosition = cursor ? navIds.indexOf(cursor.id) : -1;

  const goToHit = useCallback(
    (id: number) => setCursorState((c) => ({ id, seq: (c?.seq ?? 0) + 1, hits: analysis.hits })),
    [analysis.hits],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      if (!navIds.length) return;
      let next: number;
      if (cursorPosition !== -1) {
        next = (cursorPosition + direction + navIds.length) % navIds.length;
      } else if (cursor) {
        // 光标不在当前列表中：从光标所在位置向前/后找最近的一处
        const from = hitsById.get(cursor.id)?.start ?? 0;
        const after = navIds.findIndex((id) => (hitsById.get(id)?.start ?? 0) > from);
        next = direction > 0 ? (after === -1 ? 0 : after) : (after === -1 ? navIds.length : after) - 1;
        if (next < 0) next = navIds.length - 1;
      } else {
        next = direction > 0 ? 0 : navIds.length - 1;
      }
      goToHit(navIds[next]);
    },
    [navIds, cursorPosition, cursor, hitsById, goToHit],
  );

  const unhide = useCallback(
    (categoryId: string) =>
      setSettings((s) =>
        s.hiddenCategories.includes(categoryId)
          ? { ...s, hiddenCategories: s.hiddenCategories.filter((id) => id !== categoryId) }
          : s,
      ),
    [setSettings],
  );

  /** 聚焦并跳到第一处；再次点击已聚焦的对象则跳到下一处 */
  const focusOn = useCallback(
    (target: Focus) => {
      if (focus && sameFocus(focus, target)) {
        step(1);
        return;
      }
      setFocusState(target);
      const categoryId = target.type === 'keyword' ? index.keywords.get(target.key)?.category.id : target.id;
      if (categoryId) unhide(categoryId);
      const ids =
        target.type === 'keyword'
          ? stats.keywords.get(target.key)?.hitIds
          : stats.categories.find((c) => c.category.id === target.id)?.hitIds;
      if (ids?.length) goToHit(ids[0]);
    },
    [focus, step, index, unhide, stats, goToHit],
  );

  /** 点击文中某处命中：聚焦它的主关键词，并把光标放在这一处 */
  const focusHit = useCallback(
    (hitId: number) => {
      const hit = hitsById.get(hitId);
      const entry = hit?.entries.find((e) => !hidden.has(e.categoryId)) ?? hit?.entries[0];
      if (!entry) return;
      setFocusState({ type: 'keyword', key: keywordKey(entry.categoryId, entry.keywordId) });
      goToHit(hitId);
    },
    [hitsById, hidden, goToHit],
  );

  const clearFocus = useCallback(() => setFocusState(null), []);

  // ---------- 设置 ----------
  const setMatch = useCallback(
    (patch: Partial<MatchOptions>) => setSettings((s) => ({ ...s, match: { ...s.match, ...patch } })),
    [setSettings],
  );
  const setTheme = useCallback((theme: ThemePreference) => setSettings((s) => ({ ...s, theme })), [setSettings]);
  const setContextRadius = useCallback((contextRadius: number) => setSettings((s) => ({ ...s, contextRadius })), [setSettings]);
  const setFontSize = useCallback((fontSize: number) => setSettings((s) => ({ ...s, fontSize })), [setSettings]);
  const updateSettings = useCallback(
    (patch: Partial<Pick<Settings, 'codeView' | 'htmlImport'>>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings],
  );
  const resetSettings = useCallback(() => setSettings((s) => ({ ...DEFAULT_SETTINGS, theme: s.theme })), [setSettings]);

  const toggleCategoryVisibility = useCallback(
    (categoryId: string) =>
      setSettings((s) => ({
        ...s,
        hiddenCategories: s.hiddenCategories.includes(categoryId)
          ? s.hiddenCategories.filter((id) => id !== categoryId)
          : [...s.hiddenCategories, categoryId],
      })),
    [setSettings],
  );

  /** 只显示某个分类；若已经是只显示它，则恢复全部显示 */
  const soloCategory = useCallback(
    (categoryId: string) =>
      setSettings((s) => {
        const others = library.categories.filter((c) => c.enabled && c.id !== categoryId).map((c) => c.id);
        const isSolo = !s.hiddenCategories.includes(categoryId) && others.every((id) => s.hiddenCategories.includes(id));
        return { ...s, hiddenCategories: isSolo ? [] : others };
      }),
    [setSettings, library],
  );

  const showAllCategories = useCallback(() => setSettings((s) => ({ ...s, hiddenCategories: [] })), [setSettings]);

  // ---------- 词库 ----------
  const addTerms = useCallback(
    (categoryId: string, terms: string[], type: KeywordType = 'text') => {
      const category = library.categories.find((c) => c.id === categoryId);
      if (!category) return null;
      const result = addKeywords(category, terms, type);
      if (result.added.length) {
        setLibrary((lib) => ({
          ...lib,
          categories: lib.categories.map((c) => (c.id === categoryId ? result.category : c)),
        }));
        unhide(categoryId);
      }
      return result;
    },
    [library, setLibrary, unhide],
  );

  const addExclusionTerms = useCallback(
    (categoryId: string, terms: string[]) => {
      const category = library.categories.find((c) => c.id === categoryId);
      if (!category) return null;
      const result = addExclusions(category, terms);
      if (result.added.length) {
        setLibrary((lib) => ({
          ...lib,
          categories: lib.categories.map((c) => (c.id === categoryId ? result.category : c)),
        }));
      }
      return result;
    },
    [library, setLibrary],
  );

  // ---------- 主题 ----------
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);

  const excludedTotal = useMemo(
    () => Object.values(analysis.excluded).reduce((n, v) => n + v, 0),
    [analysis.excluded],
  );

  return {
    library,
    setLibrary,
    index,
    libraryUpgraded: libraryUpgraded.value,
    settings,
    setMatch,
    setTheme,
    setContextRadius,
    setFontSize,
    updateSettings,
    resetSettings,
    text,
    setText,
    contentSaveFailed: contentPersist.saveFailed,
    analyzedText,
    isStale: analysisState.stale,
    analysis,
    ruleErrors: analysisState.errors,
    ruleCount: analysisState.ruleCount,
    analysisFailure: analysisState.failure,
    excludedTotal,
    stats,
    hitsById,
    hidden,
    visibleHits,
    colorsOf,
    suggester,
    suggestionFor,
    fixableCount: fixPlan.length,
    fixableByCategory,
    applySuggestions,
    focus,
    focusOn,
    focusHit,
    clearFocus,
    focusSet,
    navIds,
    cursor,
    cursorPosition,
    goToHit,
    step,
    toggleCategoryVisibility,
    soloCategory,
    showAllCategories,
    addTerms,
    addExclusionTerms,
  };
}

export type Finder = ReturnType<typeof useFinder>;

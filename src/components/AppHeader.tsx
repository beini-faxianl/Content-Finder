import { countKeywords } from '../core/library';
import { SAMPLES } from '../data/samples';
import type { ThemePreference } from '../state/settings';
import type { Finder } from '../state/useFinder';
import { cx, MOD_KEY } from '../utils/cx';
import { Icon, type IconName } from './ui/Icon';
import { Menu, Popover } from './ui/Popover';
import { SettingsPanel } from './SettingsPanel';

export type ExportFormat = 'md' | 'html' | 'csv' | 'json';

interface AppHeaderProps {
  finder: Finder;
  onLoadSample: (id: string) => void;
  onImport: () => void;
  onOpenBatch: () => void;
  /** 批量检测结果条数；为 0 时不显示角标 */
  batchCount: number;
  batchRunning: boolean;
  onOpenLibrary: () => void;
  onExport: (format: ExportFormat) => void;
  onCopySummary: () => void;
  onOpenHelp: () => void;
}

const THEME_CYCLE: Record<ThemePreference, { next: ThemePreference; icon: IconName; label: string }> = {
  system: { next: 'light', icon: 'monitor', label: '跟随系统' },
  light: { next: 'dark', icon: 'sun', label: '浅色' },
  dark: { next: 'system', icon: 'moon', label: '深色' },
};

export function AppHeader(props: AppHeaderProps) {
  const { finder, onLoadSample, onImport, onOpenBatch, batchCount, batchRunning, onOpenLibrary, onExport, onCopySummary, onOpenHelp } =
    props;
  const theme = THEME_CYCLE[finder.settings.theme];
  const noHits = finder.analysis.hits.length === 0;

  return (
    <header className="app-header">
      <div className="brand">
        <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="9" />
          <circle cx="14" cy="14" r="6.5" />
          <path d="M19 19l6 6" />
          <path d="M11 14h6" className="brand-mark" />
        </svg>
        <div className="brand-text">
          <h1>内容发现器</h1>
          <span>按分类发现、高亮与统计关键词</span>
        </div>
      </div>

      <nav className="header-actions" aria-label="主操作">
        <Popover
          align="end"
          trigger={({ open, toggle }) => (
            <button type="button" className="btn btn-ghost" aria-expanded={open} onClick={toggle}>
              <Icon name="sparkles" />
              <span className="btn-label">示例</span>
              <Icon name="chevron-down" size={14} />
            </button>
          )}
        >
          {(close) => (
            <Menu
              close={close}
              label="示例文本"
              items={SAMPLES.map((s) => ({
                key: s.id,
                label: (
                  <span className="menu-two-line">
                    <b>{s.title}</b>
                    <small>{s.description}</small>
                  </span>
                ),
                onSelect: () => onLoadSample(s.id),
              }))}
            />
          )}
        </Popover>

        <button type="button" className="btn btn-ghost" onClick={onImport} title={`导入文本文件（${MOD_KEY}+O）`}>
          <Icon name="upload" />
          <span className="btn-label">导入</span>
        </button>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={onOpenBatch}
          title="批量检测：一次检查多个文件或多条文本"
        >
          <Icon name="layers" />
          <span className="btn-label">批量检测</span>
          {batchCount > 0 && <span className={cx('btn-count', batchRunning && 'is-busy')}>{batchCount}</span>}
        </button>

        <button type="button" className="btn btn-ghost" onClick={onOpenLibrary} title={`管理分类与关键词（${MOD_KEY}+K）`}>
          <Icon name="tag" />
          <span className="btn-label">关键词库</span>
          <span className="btn-count">{countKeywords(finder.library, true)}</span>
        </button>

        <Popover
          align="end"
          trigger={({ open, toggle }) => (
            <button type="button" className="btn btn-primary" aria-expanded={open} onClick={toggle}>
              <Icon name="download" />
              <span className="btn-label">导出</span>
              <Icon name="chevron-down" size={14} />
            </button>
          )}
        >
          {(close) => (
            <Menu
              close={close}
              label="导出报告"
              items={[
                { key: 'md', icon: <Icon name="file" />, label: 'Markdown 报告', hint: '.md', onSelect: () => onExport('md') },
                { key: 'html', icon: <Icon name="code" />, label: '高亮网页', hint: '.html', onSelect: () => onExport('html') },
                { key: 'csv', icon: <Icon name="list" />, label: '命中明细表', hint: '.csv', disabled: noHits, onSelect: () => onExport('csv') },
                { key: 'json', icon: <Icon name="layers" />, label: '结构化数据', hint: '.json', onSelect: () => onExport('json') },
                'divider',
                { key: 'copy', icon: <Icon name="copy" />, label: '复制结果摘要', onSelect: onCopySummary },
              ]}
            />
          )}
        </Popover>

        <span className="header-divider" />

        <Popover
          align="end"
          className="settings-popover"
          trigger={({ open, toggle }) => (
            <button type="button" className="icon-btn" aria-expanded={open} aria-label="匹配设置" title="匹配设置" onClick={toggle}>
              <Icon name="sliders" />
            </button>
          )}
        >
          {() => (
            <SettingsPanel
              settings={finder.settings}
              onMatchChange={finder.setMatch}
              onContextRadiusChange={finder.setContextRadius}
              onFontSizeChange={finder.setFontSize}
              onSettingsChange={finder.updateSettings}
              onReset={finder.resetSettings}
            />
          )}
        </Popover>

        <button
          type="button"
          className="icon-btn"
          aria-label={`主题：${theme.label}`}
          title={`主题：${theme.label}（点击切换）`}
          onClick={() => finder.setTheme(theme.next)}
        >
          <Icon name={theme.icon} />
        </button>

        <button type="button" className="icon-btn" aria-label="使用说明" title="使用说明（?）" onClick={onOpenHelp}>
          <Icon name="help" />
        </button>
      </nav>
    </header>
  );
}

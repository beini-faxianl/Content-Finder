import type { ReactNode } from 'react';
import type { MatchOptions } from '../core/types';
import { CONTEXT_RADIUS_RANGE, FONT_SIZE_RANGE, type HtmlImportMode, type Settings } from '../state/settings';
import { Segmented, Switch } from './ui/controls';

interface SettingsPanelProps {
  settings: Settings;
  onMatchChange: (patch: Partial<MatchOptions>) => void;
  onContextRadiusChange: (radius: number) => void;
  onFontSizeChange: (size: number) => void;
  onSettingsChange: (patch: Partial<Pick<Settings, 'codeView' | 'htmlImport'>>) => void;
  onReset: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { settings, onMatchChange, onContextRadiusChange, onFontSizeChange, onSettingsChange, onReset } = props;
  const { match } = settings;
  return (
    <div className="settings-panel">
      <h4>匹配规则</h4>
      <SettingRow
        title="区分大小写"
        description="关闭时 gpu、Gpu 都能命中 GPU"
        control={<Switch checked={match.caseSensitive} label="区分大小写" onChange={(v) => onMatchChange({ caseSensitive: v })} />}
      />
      <SettingRow
        title="英文整词匹配"
        description="避免 AI 误中 said、OpenAI 中的字母；中文不受影响"
        control={<Switch checked={match.wholeWord} label="英文整词匹配" onChange={(v) => onMatchChange({ wholeWord: v })} />}
      />
      <SettingRow
        title="全半角统一"
        description="全角 ＡＩ、１００％ 与半角 AI、100% 视为相同"
        control={
          <Switch checked={match.normalizeWidth} label="全半角统一" onChange={(v) => onMatchChange({ normalizeWidth: v })} />
        }
      />
      <SettingRow
        title="先解码再匹配"
        description="URL 编码（%E6%89%8B）、\u 转义、HTML 实体先还原再匹配，高亮仍落在原文上"
        control={<Switch checked={match.decode} label="先解码再匹配" onChange={(v) => onMatchChange({ decode: v })} />}
      />
      <SettingRow
        title="识别变体写法"
        description="中文关键词中间插了空格、符号或表情也能识别，如「全 网 第 一」「最★低★价」；不跨行、不跨句读标点"
        control={
          <Switch
            checked={match.ignoreSeparators}
            label="识别变体写法"
            onChange={(v) => onMatchChange({ ignoreSeparators: v })}
          />
        }
      />
      <SettingRow
        title="重叠处理"
        description={match.overlap === 'longest' ? '同一位置只保留最长的命中，阅读最清晰' : '保留嵌套与交叉的全部命中，适合严格审查'}
        control={
          <Segmented
            size="sm"
            label="重叠处理"
            value={match.overlap}
            onChange={(overlap) => onMatchChange({ overlap })}
            options={[
              { value: 'longest', label: '最长优先' },
              { value: 'all', label: '全部保留' },
            ]}
          />
        }
      />

      <h4>显示</h4>
      <SettingRow
        title="代码视图"
        description="等宽字体、不自动换行、显示行号，适合代码与 HTTP 报文"
        control={<Switch checked={settings.codeView} label="代码视图" onChange={(v) => onSettingsChange({ codeView: v })} />}
      />
      <SettingRow
        title="正文字号"
        description={`${settings.fontSize} px${settings.fontSize === 15 ? '（默认）' : ''}`}
        control={
          <input
            type="range"
            className="range"
            min={FONT_SIZE_RANGE.min}
            max={FONT_SIZE_RANGE.max}
            step={1}
            value={settings.fontSize}
            onChange={(e) => onFontSizeChange(Number(e.target.value))}
            aria-label="正文字号"
          />
        }
      />
      <SettingRow
        title="上下文长度"
        description={`命中前后各展示 ${settings.contextRadius} 个字符`}
        control={
          <input
            type="range"
            className="range"
            min={CONTEXT_RADIUS_RANGE.min}
            max={CONTEXT_RADIUS_RANGE.max}
            step={2}
            value={settings.contextRadius}
            onChange={(e) => onContextRadiusChange(Number(e.target.value))}
            aria-label="上下文长度"
          />
        }
      />
      <h4>导入</h4>
      <SettingRow
        title="HTML 文件"
        description={settings.htmlImport === 'text' ? '只保留页面正文文字' : '保留完整源码，可检查脚本与属性'}
        control={
          <Segmented<HtmlImportMode>
            size="sm"
            label="HTML 文件导入方式"
            value={settings.htmlImport}
            onChange={(htmlImport) => onSettingsChange({ htmlImport })}
            options={[
              { value: 'text', label: '提取正文' },
              { value: 'source', label: '保留源码' },
            ]}
          />
        }
      />
      <div className="settings-footer">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
          恢复默认设置
        </button>
      </div>
    </div>
  );
}

function SettingRow({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-title">{title}</div>
        <div className="setting-desc">{description}</div>
      </div>
      <div className="setting-control">{control}</div>
    </div>
  );
}

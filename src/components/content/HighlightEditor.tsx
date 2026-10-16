import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { cx } from '../../utils/cx';

interface HighlightEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 背景层渲染的高亮文本（与分析结果对应的文本） */
  children: ReactNode;
  /** 背景层文本是否以换行结尾，需要补一个占位字符让高度与输入框一致 */
  layerEndsWithNewline: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  layerRef: RefObject<HTMLDivElement | null>;
  /** 有聚焦对象时为 true，未聚焦的高亮会变淡 */
  hasFocus: boolean;
  /** 代码视图：不自动换行，需要同步横向滚动 */
  codeView: boolean;
}

/**
 * 实时高亮编辑器：透明背景的 textarea 叠放在高亮背景层之上。
 * 两层使用完全相同的字体、内边距与换行规则，并同步滚动，从而做到边输入边高亮。
 */
export function HighlightEditor(props: HighlightEditorProps) {
  const { value, onChange, children, layerEndsWithNewline, textareaRef, layerRef, hasFocus, codeView } = props;
  const backdropRef = useRef<HTMLDivElement>(null);

  const syncScroll = () => {
    const backdrop = backdropRef.current;
    const textarea = textareaRef.current;
    if (!backdrop || !textarea) return;
    backdrop.scrollTop = textarea.scrollTop;
    backdrop.scrollLeft = textarea.scrollLeft;
  };

  // 内容变化后（例如加载示例），背景层需要跟随输入框的滚动位置
  useLayoutEffect(syncScroll);

  return (
    <div className="editor">
      <div className="editor-backdrop" ref={backdropRef} aria-hidden="true">
        <div className={cx('hl-layer hl-text', hasFocus && 'has-focus')} ref={layerRef}>
          {children}
          {layerEndsWithNewline ? '\u200b' : null}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className="editor-input hl-text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        wrap={codeView ? 'off' : 'soft'}
        spellCheck={false}
        aria-label="待分析的内容"
        placeholder={'在此粘贴或输入内容，命中的关键词会实时高亮…\n\n也可以把 .txt / .md / .html / .csv 等文本文件拖到这里。'}
      />
    </div>
  );
}

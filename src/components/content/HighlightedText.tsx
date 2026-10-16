import { Fragment, memo, type CSSProperties } from 'react';
import type { Segment } from '../../core/segments';
import type { Hit } from '../../core/types';
import { cx } from '../../utils/cx';

interface HighlightedTextProps {
  text: string;
  segments: Segment[];
  hitsById: Map<number, Hit>;
  /** 命中所属的可见分类颜色（去重，主分类在前） */
  colorsOf: (hit: Hit) => string[];
  /** 聚焦中的命中集合；为 null 表示没有聚焦 */
  focusSet: Set<number> | null;
}

/**
 * 把分段结果渲染为带 <mark> 的文本。编辑模式的背景层与阅读模式共用此组件，
 * 以保证两种模式下高亮位置、字形完全一致。
 *
 * 视觉约定：主分类决定底色；同一片段属于多个分类时显示斜纹；嵌套命中用外层颜色描下划线。
 * 「未聚焦即变淡」由容器上的 .has-focus 通过 CSS 实现，聚焦切换时只有状态改变的 mark 需要重渲染，
 * 长文本（上万处命中）下依旧流畅。
 */
export const HighlightedText = memo(function HighlightedText({
  text,
  segments,
  hitsById,
  colorsOf,
  focusSet,
}: HighlightedTextProps) {
  return (
    <>
      {segments.map((seg) => {
        const content = text.slice(seg.start, seg.end);
        const primary = seg.hitIds.length ? hitsById.get(seg.hitIds[0]) : undefined;
        if (!primary) return <Fragment key={seg.start}>{content}</Fragment>;

        const colors = colorsOf(primary);
        const outer = seg.hitIds.length > 1 ? hitsById.get(seg.hitIds[seg.hitIds.length - 1]) : undefined;
        return (
          <Mark
            key={seg.start}
            content={content}
            color={colors[0]}
            color2={colors[1] ?? (outer ? colorsOf(outer)[0] : colors[0])}
            multi={colors.length > 1}
            nested={!!outer}
            focused={focusSet ? seg.hitIds.some((id) => focusSet.has(id)) : false}
            hits={seg.hitIds.join(' ')}
            starts={seg.startsHere.join(' ')}
          />
        );
      })}
    </>
  );
});

interface MarkProps {
  content: string;
  color: string;
  color2: string;
  multi: boolean;
  nested: boolean;
  focused: boolean;
  /** 覆盖此片段的命中 id，空格分隔，供 [data-hits~="id"] 选择器定位 */
  hits: string;
  starts: string;
}

/** 只接收原始类型的 props，浅比较即可跳过未变化的片段 */
const Mark = memo(function Mark({ content, color, color2, multi, nested, focused, hits, starts }: MarkProps) {
  return (
    <mark
      className={cx('hl', multi && 'hl-multi', nested && 'hl-nested', focused && 'is-focus')}
      style={{ '--hl': color, '--hl2': color2 } as CSSProperties}
      data-hits={hits}
      data-starts={starts || undefined}
    >
      {content}
    </mark>
  );
});

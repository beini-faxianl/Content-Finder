import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { cx } from '../../utils/cx';

interface PopoverProps {
  /** 渲染触发按钮，传入开关状态与切换函数 */
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

/** 轻量弹出层：点击外部或 Esc 关闭 */
export function Popover({ trigger, children, align = 'end', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  useDismiss(rootRef, open, close);

  return (
    <div className="popover-root" ref={rootRef}>
      {trigger({ open, toggle })}
      {open && <div className={cx('popover', `popover-${align}`, className)}>{children(close)}</div>}
    </div>
  );
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

interface MenuProps {
  items: Array<MenuItem | 'divider'>;
  close: () => void;
  label?: string;
}

export function Menu({ items, close, label }: MenuProps) {
  return (
    <div className="menu" role="menu" aria-label={label}>
      {items.map((item, i) =>
        item === 'divider' ? (
          <div key={`d${i}`} className="menu-divider" role="separator" />
        ) : (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={item.disabled}
            onClick={() => {
              close();
              item.onSelect();
            }}
          >
            {item.icon && <span className="menu-icon">{item.icon}</span>}
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

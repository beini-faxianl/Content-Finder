import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../utils/cx';
import { Icon } from './Icon';
import { Modal } from './Modal';

type Tone = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  tone?: Tone;
  /** 附带的操作按钮，例如「撤销」；带操作的提示停留更久 */
  action?: ToastAction;
}

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: Tone;
  action?: ToastAction;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (message: ReactNode, options?: Tone | ToastOptions) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('useFeedback 必须在 <FeedbackProvider> 内使用');
  return api;
}

const TONE_ICON = { info: 'info', success: 'check', warning: 'alert', error: 'alert' } as const;

/** 提供全局的轻提示（toast）与确认框（confirm） */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (message: ReactNode, options: Tone | ToastOptions = {}) => {
      const { tone = 'success', action } = typeof options === 'string' ? { tone: options } : options;
      const id = ++nextId.current;
      setToasts((list) => [...list.slice(-3), { id, message, tone, action }]);
      setTimeout(() => dismiss(id), action ? 7000 : tone === 'error' ? 5000 : 2800);
    },
    [dismiss],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const api = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('toast', `toast-${t.tone}`, t.action && 'has-action')}>
            <Icon name={TONE_ICON[t.tone]} />
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={pending !== null}
        size="sm"
        title={pending?.title}
        onClose={() => settle(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => settle(false)}>
              取消
            </button>
            <button
              type="button"
              className={cx('btn', pending?.danger ? 'btn-danger' : 'btn-primary')}
              onClick={() => settle(true)}
              data-autofocus
            >
              {pending?.confirmText ?? '确定'}
            </button>
          </>
        }
      >
        <div className="confirm-message">{pending?.message}</div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

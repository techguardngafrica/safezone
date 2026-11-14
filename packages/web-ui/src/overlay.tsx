import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { t } from '@safezone/i18n';
import { ActionButton } from './data';
import { TextAreaField } from './forms';
import { Icon } from './icons';

function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}

/** Keeps Tab focus inside the container and restores focus on close. */
function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (!node) return;
    const focusables = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      );
    const first = node.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const head = items[0] as HTMLElement;
      const tail = items[items.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [ref]);
}

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions; right-aligned. */
  actions?: ReactNode;
  /** Wraps the body in a form so Enter submits. */
  onSubmit?: () => void;
  wide?: boolean;
}

export function Dialog({ title, onClose, children, actions, onSubmit, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscape(onClose);
  useFocusTrap(ref);
  const content = (
    <>
      <h2 id={titleId}>{title}</h2>
      {children}
      {actions ? <div className="sz-dialog-actions">{actions}</div> : null}
    </>
  );
  return (
    <div
      className="sz-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="sz-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={wide ? { maxWidth: 640 } : undefined}
      >
        {onSubmit ? (
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {content}
          </form>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Ask for a reason; the confirm button stays disabled until one is typed when required. */
  reason?: { label: string; required?: boolean; helper?: string };
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** In-app confirm (AGENTS §6.1): states the object and the consequence, never Yes/No. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  reason,
  busy,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [text, setText] = useState('');
  const blocked = Boolean(reason?.required && text.trim().length === 0);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      onSubmit={() => {
        if (!blocked && !busy) onConfirm(text.trim());
      }}
      actions={
        <>
          <ActionButton variant="text" onClick={onClose}>
            {cancelLabel ?? t('common.cancel')}
          </ActionButton>
          <ActionButton
            type="submit"
            variant={destructive ? 'danger' : 'primary'}
            busy={busy}
            disabled={blocked}
          >
            {confirmLabel}
          </ActionButton>
        </>
      }
    >
      <div style={{ fontSize: 14 }}>{body}</div>
      {reason ? (
        <div style={{ marginTop: 16 }}>
          <TextAreaField
            label={reason.label}
            value={text}
            onChange={setText}
            helper={reason.helper}
            required={reason.required}
            autoFocus
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="sz-error" style={{ marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEscape(onClose);
  useFocusTrap(ref);
  return (
    <>
      <div className="sz-drawer-scrim" onClick={onClose} />
      <aside
        ref={ref}
        className="sz-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sz-drawer-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="sz-icon-btn"
            onClick={onClose}
            aria-label={t('ui.close')}
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="sz-drawer-body">{children}</div>
      </aside>
    </>
  );
}

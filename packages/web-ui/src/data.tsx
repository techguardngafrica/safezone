import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Icon, type IconName } from './icons';

export type ActionVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'text';

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  busy?: boolean;
}

/** Class-based button with hover and focus states. */
export function ActionButton({
  variant = 'primary',
  size = 'md',
  icon,
  busy,
  className,
  children,
  type = 'button',
  disabled,
  ...props
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={`sz-btn sz-btn-${variant}${size === 'sm' ? ' sz-btn-sm' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export type Tone = 'info' | 'neutral' | 'success' | 'warning' | 'danger';

const toneStyle: Record<Tone, { background: string; color: string }> = {
  info: { background: colors.statusSubtle.info.background, color: colors.statusSubtle.info.text },
  neutral: { background: colors.neutral[100], color: colors.neutral[700] },
  success: {
    background: colors.statusSubtle.success.background,
    color: colors.statusSubtle.success.text,
  },
  warning: {
    background: colors.statusSubtle.warning.background,
    color: colors.statusSubtle.warning.text,
  },
  danger: {
    background: colors.statusSubtle.danger.background,
    color: colors.statusSubtle.danger.text,
  },
};

/** Status pill, always text; safety statuses also carry an icon (UI_GUIDELINES §6.8). */
export function StatusPill({ tone, label, icon }: { tone: Tone; label: string; icon?: IconName }) {
  return (
    <span className="sz-pill" style={toneStyle[tone]}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {label}
    </span>
  );
}

export function Banner({
  tone,
  children,
  action,
}: {
  tone: Tone;
  children: ReactNode;
  action?: ReactNode;
}) {
  const icon: IconName = tone === 'danger' || tone === 'warning' ? 'alert' : 'info';
  return (
    <div
      className="sz-banner"
      role={tone === 'danger' ? 'alert' : 'status'}
      style={toneStyle[tone]}
    >
      <Icon name={icon} />
      <div style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="sz-card">
      {title || actions ? (
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
        >
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: IconName;
  hint?: string;
}) {
  return (
    <div className="sz-card">
      <div className="sz-stat-label">
        {icon ? <Icon name={icon} size={18} /> : null}
        {label}
      </div>
      <div className="sz-stat-value sz-num">{value}</div>
      {hint ? (
        <div className="sz-muted" style={{ fontSize: 13, marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  body,
  action,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sz-state">
      <div className="sz-state-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {body ? <p>{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="sz-state" role="alert">
      <div
        className="sz-state-icon"
        style={{ background: colors.statusSubtle.danger.background, color: colors.status.danger }}
      >
        <Icon name="alert" size={28} />
      </div>
      <h3>{t('ui.error.title')}</h3>
      <p>{message ?? t('common.error')}</p>
      {onRetry ? (
        <ActionButton variant="outline" icon="refresh" onClick={onRetry}>
          {t('common.retry')}
        </ActionButton>
      ) : null}
    </div>
  );
}

export function Skeleton({
  width = '100%',
  height = 14,
}: {
  width?: number | string;
  height?: number;
}) {
  return <div className="sz-skeleton" style={{ width, height }} />;
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: number | string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  caption: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; body?: string; icon?: IconName; action?: ReactNode };
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** Cursor pagination: shows a "Load more" footer while there is a next page. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

/** Data table with loading, empty and error states inside the body (UI_GUIDELINES §6.9, §6.14). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  selectedKey,
  hasMore,
  loadingMore,
  onLoadMore,
}: DataTableProps<T>) {
  const span = columns.length;
  let body: ReactNode;
  if (loading) {
    body = Array.from({ length: 5 }, (_, index) => (
      <tr key={index} aria-hidden="true">
        {columns.map((column) => (
          <td key={column.key}>
            <Skeleton width={index % 2 ? '60%' : '80%'} />
          </td>
        ))}
      </tr>
    ));
  } else if (error) {
    body = (
      <tr>
        <td colSpan={span}>
          <ErrorState message={error} onRetry={onRetry} />
        </td>
      </tr>
    );
  } else if (!rows || rows.length === 0) {
    body = (
      <tr>
        <td colSpan={span}>
          <EmptyState
            icon={empty?.icon}
            title={empty?.title ?? t('ui.empty.title')}
            body={empty?.body}
            action={empty?.action}
          />
        </td>
      </tr>
    );
  } else {
    body = rows.map((row) => {
      const key = rowKey(row);
      return (
        <tr
          key={key}
          data-clickable={onRowClick ? 'true' : undefined}
          aria-selected={selectedKey === key || undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }
              : undefined
          }
        >
          {columns.map((column) => (
            <td
              key={column.key}
              className={column.align === 'right' ? 'sz-right sz-num' : undefined}
            >
              {column.render(row)}
            </td>
          ))}
        </tr>
      );
    });
  }
  return (
    <div className="sz-table-wrap">
      <table className="sz-table" aria-busy={loading || undefined}>
        <caption className="sz-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.align === 'right' ? 'sz-right' : undefined}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
      {hasMore && !loading && !error ? (
        <div className="sz-table-footer">
          <ActionButton variant="outline" busy={loadingMore} onClick={onLoadMore}>
            {loadingMore ? t('common.loading') : t('ui.loadMore')}
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}

export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="sz-dl">
      {items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

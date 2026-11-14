import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { t } from '@safezone/i18n';
import { Icon, type IconName } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Pending count shown as a badge. */
  badge?: number;
  /** Danger badge, reserved for active SOS (UI_GUIDELINES §6.10). */
  urgent?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface AppShellProps {
  brand: ReactNode;
  nav: NavGroup[];
  /** Current path, used to mark the active item. */
  pathname: string;
  /** Renders a link; apps pass next/link so navigation stays client-side. */
  renderLink: (
    item: NavItem,
    props: { className: string; 'aria-current'?: 'page'; onClick: () => void; children: ReactNode },
  ) => ReactNode;
  topBar?: ReactNode;
  children: ReactNode;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Management shell: 264 px sidebar, 64 px top bar, content up to 1600 px (UI_GUIDELINES §8.3). */
export function AppShell({ brand, nav, pathname, renderLink, topBar, children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Longest matching href wins so /security/sos does not also light up /security.
  const active = nav
    .flatMap((group) => group.items)
    .filter((item) => isActive(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <div className="sz-shell">
      <nav className="sz-sidebar" data-open={open} aria-label={t('shell.nav')}>
        <div className="sz-brand">{brand}</div>
        {nav.map((group, index) => (
          <div key={group.label ?? index}>
            {group.label ? <div className="sz-nav-group">{group.label}</div> : null}
            {group.items.map((item) => (
              <div key={item.href}>
                {renderLink(item, {
                  className: 'sz-nav-link',
                  'aria-current': active === item.href ? 'page' : undefined,
                  onClick: () => setOpen(false),
                  children: (
                    <>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span
                          className={`sz-nav-badge${item.urgent ? ' sz-nav-badge-danger' : ''}`}
                        >
                          {item.badge > 9 ? '9+' : item.badge}
                        </span>
                      ) : null}
                    </>
                  ),
                })}
              </div>
            ))}
          </div>
        ))}
      </nav>
      {open ? (
        <div className="sz-drawer-scrim" style={{ zIndex: 39 }} onClick={() => setOpen(false)} />
      ) : null}
      <div className="sz-main">
        <header className="sz-topbar">
          <button
            type="button"
            className="sz-icon-btn sz-menu-toggle"
            onClick={() => setOpen(true)}
            aria-label={t('shell.openMenu')}
          >
            <Icon name="menu" />
          </button>
          {topBar}
        </header>
        <main className="sz-content">{children}</main>
      </div>
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
}

export function PageHeader({ title, description, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <>
      {breadcrumbs ? (
        <nav className="sz-crumbs" aria-label={t('shell.breadcrumbs')}>
          {breadcrumbs}
        </nav>
      ) : null}
      <div className="sz-page-header">
        <div>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
        ) : null}
      </div>
    </>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="sz-toolbar">{children}</div>;
}

export interface TabsProps<K extends string> {
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}

export function Tabs<K extends string>({ tabs, value, onChange, label }: TabsProps<K>) {
  return (
    <div className="sz-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          className="sz-tab"
          aria-selected={tab.key === value}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

'use client';

import type { Permission } from '@safezone/permissions';
import { t } from '@safezone/i18n';
import { EmptyState } from '@safezone/web-ui';
import type { ReactNode } from 'react';
import { useVendor } from './vendor-context';

/** Shows the page only when the vendor role allows it (the API still enforces). */
export function RequireVendor({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const { can } = useVendor();
  if (!can(permission)) return <EmptyState icon="ban" title={t('vendor.noAccess')} />;
  return <>{children}</>;
}

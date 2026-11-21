import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ConfirmModal,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  useSession,
} from '@safezone/mobile-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { EstateSwitcherModal } from '../../src/components/estate-switcher';
import { Icon, type IconName } from '../../src/components/icon';
import { useDeviceLockMissing } from '../../src/features/app-lock';
import { config } from '../../src/lib/config';
import { useManager } from '../../src/lib/manager';
import { session } from '../../src/lib/session';

function Chevron() {
  return <Icon name="chevron-forward" color={colors.semantic.textMuted} size={20} />;
}

function Leading({ name }: { name: IconName }) {
  return <Icon name={name} color={colors.brand.primary} size={20} />;
}

/** Announcements, notifications, estate switcher and account (management-mobile.md §6 tab 5). */
export default function MoreScreen() {
  const router = useRouter();
  const state = useSession(session);
  const { estateName, memberships, roles, hasFeature } = useManager();
  const [switching, setSwitching] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const lockMissing = useDeviceLockMissing();

  return (
    <ScrollScreen>
      <ScreenHeader title={t('mm.more.title')} />
      {hasFeature('announcements') ? (
        <ListRow
          title={t('announcement.title')}
          subtitle={t('mm.more.announcementsHint')}
          leading={<Leading name="megaphone-outline" />}
          trailing={<Chevron />}
          onPress={() => router.push('/announcements')}
        />
      ) : null}
      <ListRow
        title={t('mm.notifications.title')}
        leading={<Leading name="notifications-outline" />}
        trailing={<Chevron />}
        onPress={() => router.push('/notifications')}
      />

      <SectionHeader title={t('mm.more.estate')} />
      <ListRow
        title={estateName}
        subtitle={t('home.memberships.roles', { roles: roles.join(', ') || '-' })}
        leading={<Leading name="business-outline" />}
        trailing={memberships.length > 1 ? <Chevron /> : undefined}
        onPress={memberships.length > 1 ? () => setSwitching(true) : undefined}
      />

      <SectionHeader title={t('mm.more.account')} />
      {lockMissing ? <Banner tone="warning">{t('mm.lock.noDeviceLock')}</Banner> : null}
      <ListRow
        title={state.user?.fullName ?? t('mm.approvals.unknownName')}
        subtitle={state.user?.phone}
        leading={<Leading name="person-circle-outline" />}
      />
      <ListRow
        title={t('mm.more.version', { version: config.appVersion })}
        leading={<Leading name="information-circle-outline" />}
      />
      <ActionButton
        label={t('auth.signOut')}
        variant="outline"
        onPress={() => setSigningOut(true)}
      />

      <EstateSwitcherModal visible={switching} onClose={() => setSwitching(false)} />
      <ConfirmModal
        visible={signingOut}
        title={t('mm.more.signOutTitle')}
        body={t('mm.more.signOutBody')}
        confirmLabel={t('auth.signOut')}
        destructive
        onConfirm={() => {
          setSigningOut(false);
          void session.signOut();
        }}
        onCancel={() => setSigningOut(false)}
      />
    </ScrollScreen>
  );
}

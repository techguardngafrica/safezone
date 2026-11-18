import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  Card,
  ConfirmModal,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  useSession,
} from '@safezone/mobile-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Icon, type IconName } from '../../src/components/icon';
import { SOS_CLEARANCE } from '../../src/components/sos-button';
import { useResident } from '../../src/lib/resident';
import { session } from '../../src/lib/session';

function Row({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      leading={<Icon name={icon} color={colors.brand.primary} size={20} />}
      trailing={<Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />}
      onPress={onPress}
    />
  );
}

/** More (UI_GUIDELINES §8.1): household, contacts, estate switcher, profile, sign out. */
export default function MoreScreen() {
  const router = useRouter();
  const user = useSession(session).user;
  const { memberships, estateId, switchEstate, household, hasFeature } = useResident();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <ScrollScreen bottomInset={SOS_CLEARANCE}>
      <ScreenHeader title={t('res.more.title')} />
      <Card>
        <Row
          title={user?.fullName ?? t('res.more.addName')}
          subtitle={user?.phone}
          icon="person-circle-outline"
          onPress={() => router.push('/profile')}
        />
      </Card>
      <SectionHeader title={t('res.more.home')} />
      <Card>
        <Row
          title={t('res.more.household')}
          subtitle={household ? household.unit.code : t('res.more.noHousehold')}
          icon="home-outline"
          onPress={() => router.push('/household')}
        />
        <Row
          title={t('res.more.vehicles')}
          subtitle={t('res.more.vehiclesHint')}
          icon="car-outline"
          onPress={() => router.push('/vehicles')}
        />
        <Row
          title={t('res.more.staff')}
          subtitle={t('res.more.staffHint')}
          icon="people-circle-outline"
          onPress={() => router.push('/staff')}
        />
        <Row
          title={t('res.more.emergencyContacts')}
          subtitle={t('res.more.emergencyContactsHint')}
          icon="call-outline"
          onPress={() => router.push('/emergency-contacts')}
        />
        {hasFeature('maintenance') ? (
          <Row
            title={t('res.more.issues')}
            subtitle={t('res.more.issuesHint')}
            icon="construct-outline"
            onPress={() => router.push('/issues')}
          />
        ) : null}
        {hasFeature('facilities') ? (
          <Row
            title={t('res.more.bookings')}
            subtitle={t('res.more.bookingsHint')}
            icon="calendar-outline"
            onPress={() => router.push('/bookings')}
          />
        ) : null}
        <Row
          title={t('res.notifications.title')}
          icon="notifications-outline"
          onPress={() => router.push('/notifications')}
        />
      </Card>
      {memberships.length > 1 ? (
        <>
          <SectionHeader title={t('res.more.estates')} />
          <Card>
            {memberships.map((membership) => (
              <ListRow
                key={membership.estate.id}
                title={membership.estate.name}
                leading={<Icon name="business-outline" color={colors.brand.primary} size={20} />}
                trailing={
                  membership.estate.id === estateId ? (
                    <Icon name="checkmark-circle" color={colors.brand.primary} />
                  ) : undefined
                }
                onPress={() => switchEstate(membership.estate.id)}
              />
            ))}
          </Card>
        </>
      ) : null}
      <SectionHeader title={t('res.more.account')} />
      <Card>
        <Row
          title={t('res.more.joinAnother')}
          icon="add-circle-outline"
          onPress={() => router.push('/join')}
        />
        <ListRow
          title={t('auth.signOut')}
          leading={<Icon name="log-out-outline" color={colors.status.danger} size={20} />}
          onPress={() => setSigningOut(true)}
        />
      </Card>
      <ConfirmModal
        visible={signingOut}
        title={t('res.more.signOutTitle')}
        body={t('res.more.signOutBody')}
        confirmLabel={t('auth.signOut')}
        cancelLabel={t('res.more.stay')}
        onConfirm={() => {
          setSigningOut(false);
          void session.signOut();
        }}
        onCancel={() => setSigningOut(false)}
      />
    </ScrollScreen>
  );
}

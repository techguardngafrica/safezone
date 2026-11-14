import { colors } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  Card,
  EmptyState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
} from '@safezone/mobile-ui';
import { useRouter } from 'expo-router';
import { Icon } from '../src/components/icon';
import { useResident } from '../src/lib/resident';

export default function HouseholdScreen() {
  const router = useRouter();
  const { household, householdLoading, estateName } = useResident();
  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.household.title')}
        subtitle={
          household
            ? `${household.unit.code} ${household.unit.name}, ${estateName}`.trim()
            : undefined
        }
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {householdLoading ? <Skeleton height={120} /> : null}
      {!householdLoading && !household ? (
        <EmptyState
          icon={<Icon name="home-outline" size={28} color={colors.brand.primary} />}
          title={t('res.household.none')}
          body={t('res.household.noneBody')}
        />
      ) : null}
      {household ? (
        <Card>
          {household.members.map((member) => (
            <ListRow
              key={member.id}
              title={member.fullName}
              subtitle={t(`resident.relationship.${member.relationship}` as MessageKey)}
              leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
            />
          ))}
        </Card>
      ) : null}
    </ScrollScreen>
  );
}

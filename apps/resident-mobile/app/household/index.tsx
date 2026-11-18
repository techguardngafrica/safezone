import { colors } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  EmptyState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  useSession,
} from '@safezone/mobile-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { PERMISSION_KEYS } from '../../src/features/household';
import { useResident } from '../../src/lib/resident';
import { session } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Household (UI_GUIDELINES §8.1 More): members and what each may do; the head manages it. */
export default function HouseholdScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useSession(session).user?.id;
  const { household, householdLoading, estateId, estateName } = useResident();
  const pull = usePullRefresh(() =>
    queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'households', 'mine'] }),
  );
  const isHead = household?.headUserId === me;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
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
        <>
          <SectionHeader title={t('res.household.members', { count: household.members.length })} />
          <Card>
            {household.members.map((member) => {
              const allowed = PERMISSION_KEYS.filter((key) => member.permissions[key]).length;
              return (
                <ListRow
                  key={member.id}
                  title={
                    member.userId === me
                      ? t('res.household.youName', { name: member.fullName })
                      : member.fullName
                  }
                  subtitle={`${t(`resident.relationship.${member.relationship}` as MessageKey)}${member.isMinor ? ` · ${t('res.household.minor')}` : ''}${
                    member.relationship === 'head'
                      ? ''
                      : ` · ${t('res.household.canDo', { count: allowed, total: PERMISSION_KEYS.length })}`
                  }`}
                  leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
                  trailing={
                    isHead && member.relationship !== 'head' ? (
                      <Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />
                    ) : undefined
                  }
                  onPress={
                    isHead && member.relationship !== 'head'
                      ? () => router.push(`/household/${member.id}`)
                      : undefined
                  }
                />
              );
            })}
          </Card>
          {isHead ? (
            <ActionButton
              label={t('res.household.add')}
              icon={<Icon name="person-add-outline" color="#FFFFFF" size={20} />}
              onPress={() => router.push('/household/add')}
            />
          ) : (
            <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
              {t('res.household.headOnly')}
            </Text>
          )}
        </>
      ) : null}
    </ScrollScreen>
  );
}

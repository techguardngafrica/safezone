import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  Banner,
  Card,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../src/components/icon';
import { useResident } from '../src/lib/resident';
import { api } from '../src/lib/session';

const PUBLIC_WEB_URL = 'https://safezone.ng';
const SUPPORT_EMAIL = 'support@safezone.ng';

const FAQ_KEYS = ['passes', 'sos', 'pay', 'moves'] as const;

const PUBLIC_EMERGENCY_LINES = [
  { key: 'national', number: '112', labelKey: 'res.help.nationalEmergency' as const },
  { key: 'lagos', number: '767', labelKey: 'res.help.lagosEmergency' as const },
];

/** Help screen (resident-mobile.md §6.1): estate details, public emergency lines, FAQ, support & legal. */
export default function HelpScreen() {
  const router = useRouter();
  const { estateId } = useResident();
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const estate = useQuery({
    queryKey: ['estate', estateId, 'profile'],
    queryFn: () => unwrap(api.GET('/v1/estates/{estateId}', { params: { path: { estateId } } })),
    enabled: Boolean(estateId),
  });

  const data = estate.data;
  const locationText = [data?.lga, data?.state].filter(Boolean).join(', ');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.help.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
        backIcon={<Icon name="arrow-back" />}
      />

      {estateId ? (
        <>
          <SectionHeader title={t('res.help.estateSection')} />
          {estate.isPending ? <Skeleton height={104} /> : null}
          {data ? (
            <Card>
              <Text style={styles.estateName}>{data.name}</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>{t('res.help.estateCode')}</Text>
                <Text style={styles.infoValue}>{data.code}</Text>
              </View>
              {data.address ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('res.help.estateAddress')}</Text>
                  <Text style={styles.infoValue}>{data.address}</Text>
                </View>
              ) : null}
              {locationText ? (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{t('res.help.estateLocation')}</Text>
                  <Text style={styles.infoValue}>{locationText}</Text>
                </View>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}

      <SectionHeader title={t('res.help.emergencySection')} />
      <Banner tone="info">{t('res.help.emergencyNote')}</Banner>
      <Card>
        {PUBLIC_EMERGENCY_LINES.map((line) => (
          <ListRow
            key={line.key}
            title={t(line.labelKey)}
            subtitle={t('res.help.callNumber', { number: line.number })}
            leading={<Icon name="call-outline" color={colors.status.danger} size={20} />}
            trailing={
              <View style={styles.numberPill}>
                <Text style={styles.numberPillText}>{line.number}</Text>
              </View>
            }
            onPress={() => void Linking.openURL(`tel:${line.number}`)}
          />
        ))}
      </Card>

      <SectionHeader title={t('res.help.faqSection')} />
      <Card>
        {FAQ_KEYS.map((key) => {
          const expanded = openFaq === key;
          return (
            <View key={key} style={styles.faqItem}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpenFaq(expanded ? null : key)}
                style={styles.faqHeader}
              >
                <Text style={styles.faqQuestion}>{t(`res.help.faq.${key}.q` as MessageKey)}</Text>
                <Icon
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.semantic.textMuted}
                />
              </Pressable>
              {expanded ? (
                <Text style={styles.faqAnswer}>{t(`res.help.faq.${key}.a` as MessageKey)}</Text>
              ) : null}
            </View>
          );
        })}
      </Card>

      <SectionHeader title={t('res.help.supportSection')} />
      <Card>
        <ListRow
          title={t('res.help.contactSupport')}
          subtitle={SUPPORT_EMAIL}
          leading={<Icon name="mail-outline" color={colors.brand.primary} size={20} />}
          trailing={<Icon name="open-outline" size={18} color={colors.semantic.textMuted} />}
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        />
        <ListRow
          title={t('res.help.privacyPolicy')}
          leading={<Icon name="shield-checkmark-outline" color={colors.brand.primary} size={20} />}
          trailing={<Icon name="open-outline" size={18} color={colors.semantic.textMuted} />}
          onPress={() => void Linking.openURL(`${PUBLIC_WEB_URL}/privacy`)}
        />
        <ListRow
          title={t('res.help.terms')}
          leading={<Icon name="document-text-outline" color={colors.brand.primary} size={20} />}
          trailing={<Icon name="open-outline" size={18} color={colors.semantic.textMuted} />}
          onPress={() => void Linking.openURL(`${PUBLIC_WEB_URL}/terms`)}
        />
      </Card>

      <Text style={styles.version}>{t('res.help.version', { version })}</Text>
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  estateName: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing[3],
    minHeight: 28,
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
  },
  infoValue: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  numberPill: {
    backgroundColor: colors.semantic.surfaceMuted,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.pill,
  },
  numberPillText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
    color: colors.status.danger,
    fontVariant: ['tabular-nums'],
  },
  faqItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.semantic.borderSubtle,
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    minHeight: 44,
  },
  faqQuestion: {
    flex: 1,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
    color: colors.semantic.text,
  },
  faqAnswer: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
    lineHeight: 20,
    paddingBottom: spacing[2],
  },
  version: {
    textAlign: 'center',
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
    paddingVertical: spacing[2],
  },
});

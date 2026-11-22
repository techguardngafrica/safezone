import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ActionButton, Card, SponsoredBadge } from '@safezone/mobile-ui';
import type { AdPlacementKey } from '@safezone/schemas';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { useResident } from '../lib/resident';
import { api } from '../lib/session';

/**
 * One sponsored slot (advertising.md §3, ADR-0024). Use only on home, the community feed and the
 * marketplace: never on SOS, passes, gate, payment, onboarding or message screens (AGENTS.md §6.2); the
 * API also refuses those contexts. An ad never blocks or breaks the screen: no ad, an error or offline
 * all render nothing. Always labelled Sponsored.
 */
export function SponsoredSlot({
  placement,
  context,
}: {
  placement: AdPlacementKey;
  context: 'home' | 'community_feed' | 'marketplace' | 'discovery';
}) {
  const { estateId } = useResident();
  const ad = useQuery({
    queryKey: ['ads', estateId, placement, context],
    queryFn: () =>
      unwrap(api.GET('/v1/ads/decision', { params: { query: { placement, estateId, context } } })),
    enabled: Boolean(estateId),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const counted = useRef<string | null>(null);
  const data = ad.data ?? null;

  // The impression beacon fires once per ad shown; failures are ignored (best effort).
  useEffect(() => {
    if (!data || counted.current === data.impressionUrl) return;
    counted.current = data.impressionUrl;
    void fetch(data.impressionUrl).catch(() => undefined);
  }, [data]);

  if (!data) return null;
  return (
    <Card accessibilityLabel={`${t('common.sponsored')}: ${data.headline}`}>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: spacing[2],
        }}
      >
        <SponsoredBadge />
        <Text
          style={{ color: colors.semantic.textMuted, fontSize: typography.size.xs }}
          numberOfLines={1}
        >
          {data.advertiserName}
        </Text>
      </View>
      {data.imageUrl ? (
        <Image
          source={{ uri: data.imageUrl }}
          accessibilityIgnoresInvertColors
          style={{
            width: '100%',
            aspectRatio: 3,
            borderRadius: radii.md,
            backgroundColor: colors.neutral[100],
          }}
          resizeMode="cover"
        />
      ) : null}
      <Text
        style={{ fontSize: typography.size.md, fontWeight: '600', color: colors.semantic.text }}
      >
        {data.headline}
      </Text>
      {data.body ? (
        <Text style={{ fontSize: typography.size.sm, color: colors.semantic.text }}>
          {data.body}
        </Text>
      ) : null}
      <ActionButton
        label={data.cta}
        variant="outline"
        onPress={() => void Linking.openURL(data.clickUrl)}
      />
    </Card>
  );
}

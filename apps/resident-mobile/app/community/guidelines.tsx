import { unwrap } from '@safezone/api-client';
import { colors, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
} from '@safezone/mobile-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { useGuidelines } from '../../src/features/use-guidelines';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** The estate's community guidelines; agreeing is required before posting (community module rule). */
export default function GuidelinesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const guidelines = useGuidelines();
  const accept = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/community/guidelines/accept', {
          params: { path: { estateId } },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['estate', estateId, 'community', 'guidelines'], data);
      router.back();
    },
  });
  const data = guidelines.data;
  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        data && !data.acceptedAt ? (
          <ActionButton
            label={t('res.community.agree')}
            onPress={() => accept.mutate()}
            busy={accept.isPending}
          />
        ) : undefined
      }
    >
      <ScreenHeader
        title={t('res.community.guidelinesTitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {guidelines.isPending ? <Skeleton height={200} /> : null}
      {guidelines.isError ? (
        <ErrorState
          message={errorText(guidelines.error)}
          onRetry={() => void guidelines.refetch()}
        />
      ) : null}
      {data ? (
        <>
          <Card>
            <Text
              style={{ fontSize: typography.size.md, lineHeight: 24, color: colors.semantic.text }}
            >
              {data.text}
            </Text>
          </Card>
          {data.acceptedAt ? (
            <Text style={{ color: colors.semantic.textMuted }}>
              {t('res.community.agreedOn', { date: formatDateTime(data.acceptedAt) })}
            </Text>
          ) : null}
        </>
      ) : null}
      {accept.isError ? <Banner tone="danger">{errorText(accept.error)}</Banner> : null}
    </ScrollScreen>
  );
}

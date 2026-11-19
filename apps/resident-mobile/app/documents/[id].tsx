import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatDate, formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import { expiryState } from '../../src/features/documents';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Document detail: metadata, expiry status, version history, and 5-minute signed download link. */
export default function DocumentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useResident();

  const doc = useQuery({
    queryKey: ['estate', estateId, 'document', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/documents/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
  });

  const download = useMutation({
    mutationFn: (version?: number) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/documents/{id}/download', {
          params: { path: { estateId, id }, query: version ? { version } : {} },
        }),
      ),
    onSuccess: (result) => {
      void Linking.openURL(result.url);
    },
  });

  const pull = usePullRefresh(doc.refetch);
  const data = doc.data;
  const expiry = data ? expiryState(data.expiresOn) : null;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={data?.title ?? t('res.documents.title')}
        subtitle={data ? t(`res.documents.category.${data.category}` as MessageKey) : undefined}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/documents'))}
        backIcon={<Icon name="arrow-back" />}
      />

      {doc.isPending ? <Skeleton height={180} /> : null}
      {doc.isError ? (
        <ErrorState message={errorText(doc.error)} onRetry={() => void doc.refetch()} />
      ) : null}

      {data ? (
        <>
          <Card>
            <View style={styles.pills}>
              <StatusPill
                tone="info"
                label={t('res.documents.version', { version: data.currentVersion })}
              />
              {expiry === 'expired' ? (
                <StatusPill tone="danger" label={t('res.documents.expired')} />
              ) : expiry === 'expiring_soon' ? (
                <StatusPill tone="warning" label={t('res.documents.expiringSoon')} />
              ) : null}
            </View>
            {data.description ? <Text style={styles.body}>{data.description}</Text> : null}
            {data.expiresOn ? (
              <Text style={styles.meta}>
                {t('res.documents.expires', { date: formatDate(`${data.expiresOn}T12:00:00Z`) })}
              </Text>
            ) : null}
            {download.isError ? <Banner tone="danger">{errorText(download.error)}</Banner> : null}
            <ActionButton
              label={t('res.documents.download')}
              icon={<Icon name="download-outline" color="#FFFFFF" size={20} />}
              busy={download.isPending && download.variables === undefined}
              onPress={() => download.mutate(undefined)}
            />
          </Card>

          {data.versions.length > 0 ? (
            <>
              <SectionHeader title={t('res.documents.versions')} />
              <Card>
                {[...data.versions].reverse().map((ver) => (
                  <ListRow
                    key={ver.version}
                    title={t('res.documents.version', { version: ver.version })}
                    subtitle={
                      ver.notes
                        ? `${formatDateTime(ver.createdAt)} · ${ver.notes}`
                        : formatDateTime(ver.createdAt)
                    }
                    leading={
                      <Icon name="document-outline" color={colors.brand.primary} size={20} />
                    }
                    trailing={
                      <ActionButton
                        label={t('res.documents.openVersion', { version: ver.version })}
                        variant="outline"
                        busy={download.isPending && download.variables === ver.version}
                        onPress={() => download.mutate(ver.version)}
                      />
                    }
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  body: {
    fontSize: typography.size.md,
    color: colors.semantic.text,
    lineHeight: 22,
  },
  meta: {
    fontSize: typography.size.xs,
    color: colors.semantic.textMuted,
  },
});

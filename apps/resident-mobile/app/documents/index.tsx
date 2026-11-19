import { unwrap } from '@safezone/api-client';
import { colors, spacing, typography } from '@safezone/design-tokens';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  DOCUMENT_CATEGORIES,
  type DocumentCategory,
  expiryState,
} from '../../src/features/documents';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Documents (resident-mobile.md §6.11): estate rules, notices, and personal documents. */
export default function DocumentsScreen() {
  const router = useRouter();
  const { estateId, estateName } = useResident();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [folderId, setFolderId] = useState<string>('all');
  const [category, setCategory] = useState<DocumentCategory | 'all'>('all');

  const folders = useQuery({
    queryKey: ['estate', estateId, 'document-folders'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/document-folders', { params: { path: { estateId } } }),
      ),
  });

  const documents = useQuery({
    queryKey: ['estate', estateId, 'documents', folderId, category, q],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/documents', {
          params: {
            path: { estateId },
            query: {
              ...(folderId !== 'all' ? { folderId } : {}),
              ...(category !== 'all' ? { category } : {}),
              ...(q.length > 0 ? { q } : {}),
            },
          },
        }),
      ),
  });

  const pull = usePullRefresh(() => Promise.all([folders.refetch(), documents.refetch()]));
  const folderList = folders.data ?? [];
  const docList = (documents.data ?? []).filter((doc) => doc.status === 'active');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={t('res.documents.title')}
        subtitle={estateName}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
        backIcon={<Icon name="arrow-back" />}
      />

      <TextField
        label={t('res.documents.title')}
        placeholder={t('res.documents.searchPlaceholder')}
        value={search}
        onChangeText={setSearch}
        maxLength={100}
      />

      {folderList.length > 0 ? (
        <ChipGroup<string>
          label={t('res.documents.allFolders')}
          value={folderId}
          onChange={setFolderId}
          options={[
            { key: 'all', label: t('res.documents.allFolders') },
            ...folderList.map((folder) => ({ key: folder.id, label: folder.name })),
          ]}
        />
      ) : null}

      <ChipGroup<DocumentCategory | 'all'>
        label={t('res.documents.allCategories')}
        value={category}
        onChange={setCategory}
        options={[
          { key: 'all', label: t('res.documents.allCategories') },
          ...DOCUMENT_CATEGORIES.map((item) => ({
            key: item,
            label: t(`res.documents.category.${item}` as MessageKey),
          })),
        ]}
      />

      {documents.isPending ? <Skeleton height={140} /> : null}
      {documents.isError ? (
        <ErrorState message={errorText(documents.error)} onRetry={() => void documents.refetch()} />
      ) : null}
      {documents.data && docList.length === 0 ? (
        <EmptyState
          icon={<Icon name="document-text-outline" size={28} color={colors.brand.primary} />}
          title={t('res.documents.empty')}
          body={t('res.documents.emptyBody')}
        />
      ) : null}

      {docList.length > 0 ? (
        <Card>
          {docList.map((doc) => {
            const expiry = expiryState(doc.expiresOn);
            const parts = [
              t(`res.documents.category.${doc.category}` as MessageKey),
              t('res.documents.version', { version: doc.currentVersion }),
            ];
            if (doc.expiresOn) {
              parts.push(
                t('res.documents.expires', { date: formatDate(`${doc.expiresOn}T12:00:00Z`) }),
              );
            }
            return (
              <ListRow
                key={doc.id}
                title={doc.title}
                subtitle={parts.join(' · ')}
                leading={
                  <Icon name="document-text-outline" color={colors.brand.primary} size={20} />
                }
                trailing={
                  <View style={styles.trailing}>
                    {expiry === 'expired' ? (
                      <StatusPill tone="danger" label={t('res.documents.expired')} />
                    ) : expiry === 'expiring_soon' ? (
                      <StatusPill tone="warning" label={t('res.documents.expiringSoon')} />
                    ) : (
                      <Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />
                    )}
                  </View>
                }
                onPress={() => router.push(`/documents/${doc.id}`)}
              />
            );
          })}
        </Card>
      ) : null}
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  title: {
    fontSize: typography.size.md,
  },
});

import { unwrapPage } from '@safezone/api-client';
import { maskPhone } from '@safezone/auth';
import { colors, touchTarget } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Linking, Pressable } from 'react-native';
import { Icon } from '../../src/components/icon';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Waits until typing pauses before searching, so each keystroke is not a request. */
function useDebounced(value: string, ms = 350): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Resident lookup (management-mobile.md §7.3). Phone numbers are masked unless the role has
 * `pii.view` (§10); only then can the manager call the resident.
 */
export default function EstateScreen() {
  const { estateId, can, hasFeature } = useManager();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const allowed = hasFeature('occupancy') && can('resident.read');
  const showPhone = can('pii.view');
  const residents = useInfiniteQuery({
    queryKey: ['estate', estateId, 'residents', q],
    queryFn: ({ pageParam }) =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/residents', {
          params: {
            path: { estateId },
            query: { q: q || undefined, limit: 30, cursor: pageParam },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: allowed,
  });
  const pull = usePullRefresh(residents.refetch);
  const items = residents.data?.pages.flatMap((page) => page.items) ?? [];

  if (!allowed)
    return (
      <ScrollScreen>
        <ScreenHeader title={t('mm.estate.title')} />
        <EmptyState
          icon={<Icon name="lock-closed-outline" size={28} color={colors.brand.primary} />}
          title={t('mm.estate.noAccess')}
          body={t('mm.estate.noAccessBody')}
        />
      </ScrollScreen>
    );

  return (
    <ScrollScreen {...pull}>
      <ScreenHeader title={t('mm.estate.title')} subtitle={t('mm.estate.subtitle')} />
      <TextField
        label={t('resident.search')}
        placeholder={t('resident.searchPlaceholder')}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="words"
      />
      {residents.isPending ? (
        <>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </>
      ) : null}
      {residents.isError ? (
        isNetworkError(residents.error) ? (
          <Banner tone="warning">{t('mm.offline.cached')}</Banner>
        ) : (
          <ErrorState
            message={errorText(residents.error)}
            onRetry={() => void residents.refetch()}
          />
        )
      ) : null}
      {residents.data && items.length === 0 ? (
        <EmptyState
          icon={<Icon name="people-outline" size={28} color={colors.brand.primary} />}
          title={q ? t('resident.empty.searchTitle') : t('resident.empty.title')}
          body={q ? undefined : t('resident.empty.body')}
        />
      ) : null}
      {items.map((resident) => (
        <ListRow
          key={resident.memberId}
          title={resident.fullName}
          subtitle={[
            resident.unit.code,
            t(`resident.relationship.${resident.relationship}` as MessageKey),
            resident.phone
              ? showPhone
                ? resident.phone
                : maskPhone(resident.phone)
              : t('resident.noAccount'),
          ].join(' · ')}
          leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
          trailing={
            showPhone && resident.phone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mm.estate.call', { name: resident.fullName })}
                onPress={() => void Linking.openURL(`tel:${resident.phone}`)}
                style={{
                  width: touchTarget.default,
                  height: touchTarget.default,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="call-outline" color={colors.brand.primary} size={22} />
              </Pressable>
            ) : undefined
          }
        />
      ))}
      {residents.hasNextPage ? (
        <ActionButton
          label={t('ui.loadMore')}
          variant="outline"
          busy={residents.isFetchingNextPage}
          onPress={() => void residents.fetchNextPage()}
        />
      ) : null}
      {items.length > 0 ? <Banner tone="neutral">{t('mm.estate.webOnly')}</Banner> : null}
    </ScrollScreen>
  );
}

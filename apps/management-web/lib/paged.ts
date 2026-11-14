'use client';

import type { CursorPage } from '@safezone/api-client';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

/** Cursor-paginated list for DataTable: flattens pages and exposes "Load more" (server-side paging only). */
export function usePaged<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
  options: { enabled?: boolean; refetchInterval?: number } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: options.enabled,
    refetchInterval: options.refetchInterval,
  });
  return {
    rows: query.data?.pages.flatMap((page) => page.items),
    loading: query.isPending,
    error: query.error,
    refetch: () => void query.refetch(),
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}

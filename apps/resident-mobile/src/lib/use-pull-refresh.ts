import { useCallback, useState } from 'react';

/**
 * Pull-to-refresh state that only reflects a refresh the user started. Background polling must not
 * show the spinner (it shifts the layout under the user's finger).
 */
export function usePullRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);
  return { refreshing, onRefresh };
}

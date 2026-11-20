'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { ActionButton, Dialog, InputField, StatusPill } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useEstate } from '../../lib/estate';
import { api } from '../../lib/session';

export function GlobalSearch() {
  const { estateId } = useEstate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const trimmed = query.trim();
  const results = useQuery({
    queryKey: ['estate', estateId, 'search', trimmed],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/search', {
          params: { path: { estateId }, query: { q: trimmed, limit: 6 } },
        }),
      ),
    enabled: open && trimmed.length >= 2,
  });

  return (
    <>
      <ActionButton
        variant="outline"
        size="sm"
        icon="search"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        {t('search.shortcut')}
      </ActionButton>

      {open ? (
        <Dialog
          title={t('common.search')}
          wide
          onClose={() => setOpen(false)}
          actions={
            <ActionButton variant="outline" type="button" onClick={() => setOpen(false)}>
              {t('common.close')}
            </ActionButton>
          }
        >
          <div className="sz-form">
            <InputField
              label={t('common.search')}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={setQuery}
              autoFocus
            />

            {trimmed.length < 2 ? (
              <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                {t('search.hint')}
              </p>
            ) : results.isPending ? (
              <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                {t('common.loading')}
              </p>
            ) : (results.data?.hits.length ?? 0) === 0 ? (
              <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                {t('search.empty')}
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                {(results.data?.hits ?? []).map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button
                      type="button"
                      className="sz-card"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: 'pointer',
                      }}
                      onClick={() => {
                        setOpen(false);
                        router.push(hit.href);
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{hit.title}</div>
                        {hit.subtitle ? (
                          <div className="sz-muted" style={{ fontSize: 13 }}>
                            {hit.subtitle}
                          </div>
                        ) : null}
                      </div>
                      <StatusPill tone="neutral" label={hit.kind} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}

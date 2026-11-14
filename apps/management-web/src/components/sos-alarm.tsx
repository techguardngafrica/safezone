'use client';

import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import { ActionButton, Banner } from '@safezone/web-ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useEstate } from '../../lib/estate';
import { api } from '../../lib/session';

/** Short two-tone alarm through Web Audio; no audio files to load (UI_GUIDELINES §9.1 rule 9). */
function beep(context: AudioContext) {
  const now = context.currentTime;
  [0, 0.35].forEach((offset, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = index === 0 ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.32);
  });
}

/**
 * Estate-wide SOS watcher shown on every management page for users with `sos.respond`.
 * Polls active alerts every 3 s (the Socket.IO feed replaces this when realtime lands in the web app),
 * shows a Danger banner, and sounds an alarm while any real (non-drill) alert is still unacknowledged.
 */
export function SosAlarm() {
  const { estateId } = useEstate();
  const pathname = usePathname();
  const active = useQuery({
    queryKey: ['estate', estateId, 'sos', 'active'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/sos', {
          params: { path: { estateId }, query: { status: 'active' } },
        }),
      ),
    refetchInterval: 3_000,
  });
  const audio = useRef<AudioContext | null>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);

  const alerts = active.data ?? [];
  const unacknowledged = alerts.filter((alert) => alert.status === 'triggered' && !alert.isDrill);
  const ringing = unacknowledged.length > 0;

  useEffect(() => {
    if (!ringing) return;
    const ring = () => {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === 'suspended') {
          void audio.current.resume().catch(() => undefined);
          setSoundBlocked(audio.current.state === 'suspended');
        }
        if (audio.current.state === 'running') {
          setSoundBlocked(false);
          beep(audio.current);
        }
      } catch {
        setSoundBlocked(true);
      }
    };
    ring();
    const timer = window.setInterval(ring, 2_000);
    return () => window.clearInterval(timer);
  }, [ringing]);

  if (alerts.length === 0) return null;
  const onConsole = pathname.endsWith('/security/sos');
  const drillOnly = alerts.every((alert) => alert.isDrill);
  return (
    <Banner
      tone={drillOnly ? 'warning' : 'danger'}
      action={
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {soundBlocked && ringing ? (
            <ActionButton
              variant="outline"
              size="sm"
              icon="volume"
              onClick={() => {
                void audio.current?.resume().then(() => setSoundBlocked(false));
              }}
            >
              {t('sos.alarm.enableSound')}
            </ActionButton>
          ) : null}
          {onConsole ? null : (
            <Link href={`/${estateId}/security/sos`} className="sz-btn sz-btn-danger sz-btn-sm">
              {t('sos.alarm.open')}
            </Link>
          )}
        </div>
      }
    >
      <strong>
        {drillOnly
          ? t('sos.alarm.drill', { count: alerts.length })
          : t('sos.alarm.active', { count: alerts.length })}
      </strong>
      {ringing ? <> {t('sos.alarm.unacknowledged', { count: unacknowledged.length })}</> : null}
    </Banner>
  );
}

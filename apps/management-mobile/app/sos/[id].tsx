import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { formatElapsed, formatTime, t } from '@safezone/i18n';
import { ConfirmModal, ErrorState, ListRow, Skeleton } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../src/components/icon';
import {
  ACTIVE_SOS,
  SOS_POLL_MS,
  categoryText,
  eventText,
  sosActions,
  sosStatusText,
} from '../../src/features/sos';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { useNow } from '../../src/lib/use-now';

type Step = 'acknowledge' | 'responding';
type Dialog = 'note' | 'escalate' | 'resolve' | 'false' | 'close' | null;

function mapsUrl(lat: number, lng: number): string {
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?q=${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}`;
}

/** Large white-on-red button for the alarm screen (56 px target, as in the Security App). */
function AlarmButton({
  label,
  icon,
  solid = false,
  busy = false,
  onPress,
}: {
  label: string;
  icon?: IconName;
  solid?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const color = solid ? colors.status.danger : colors.neutral[0];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        solid ? styles.buttonSolid : styles.buttonGhost,
        pressed && { opacity: 0.85 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : icon ? (
        <Icon name={icon} size={22} color={color} />
      ) : null}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

/** Pick a guard or supervisor to assign (needs `security.staff.manage` to list guards). */
function AssignSheet({
  visible,
  onClose,
  onPick,
  busy,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
  busy: boolean;
}) {
  const { estateId } = useManager();
  const guards = useQuery({
    queryKey: ['estate', estateId, 'guards'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/guards', { params: { path: { estateId } } })),
    enabled: visible,
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('ui.close')}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('mm.sos.assignTitle')}
          </Text>
          {guards.isPending || busy ? <ActivityIndicator color={colors.brand.primary} /> : null}
          {guards.isError ? (
            <ErrorState message={errorText(guards.error)} onRetry={() => void guards.refetch()} />
          ) : null}
          <ScrollView style={{ maxHeight: 360 }}>
            {(guards.data ?? []).map((guard) => (
              <ListRow
                key={guard.userId}
                title={guard.fullName ?? t('mm.approvals.unknownName')}
                subtitle={guard.roles.join(', ')}
                leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
                onPress={() => onPick(guard.userId)}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Full-screen SOS response (management-mobile.md §7.1, UI_GUIDELINES §8.4). Danger red is reserved for
 * this screen. No ads. Escalation runs on the server's timers; there is no manual escalate action.
 */
export default function SosResponse() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, can } = useManager();
  const queryClient = useQueryClient();
  const now = useNow();
  const detail = useQuery({
    queryKey: ['estate', estateId, 'sos', id],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/sos/{id}', { params: { path: { estateId, id } } })),
    refetchInterval: SOS_POLL_MS,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [assigning, setAssigning] = useState(false);
  const [text, setText] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'sos'] });

  const run = async (key: string, call: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await call();
      await refresh();
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const step = (action: Step) =>
    void run(action, () =>
      action === 'acknowledge'
        ? unwrap(
            api.POST('/v1/estates/{estateId}/sos/{id}/acknowledge', {
              params: { path: { estateId, id } },
            }),
          )
        : unwrap(
            api.POST('/v1/estates/{estateId}/sos/{id}/responding', {
              params: { path: { estateId, id } },
            }),
          ),
    );

  const assign = (userId: string) =>
    void run('assign', () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/sos/{id}/assign', {
          params: { path: { estateId, id } },
          body: { userId },
        }),
      ),
    ).then((ok) => ok && setAssigning(false));

  const submitDialog = () => {
    const value = text.trim();
    const path = { estateId, id };
    void run(dialog ?? 'dialog', () => {
      if (dialog === 'note')
        return unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/notes', {
            params: { path },
            body: { note: value },
          }),
        );
      if (dialog === 'escalate')
        return unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/escalate', {
            params: { path },
            body: value ? { note: value } : {},
          }),
        );
      if (dialog === 'close')
        return unwrap(
          api.POST('/v1/estates/{estateId}/sos/{id}/close', {
            params: { path },
            body: value ? { notes: value } : {},
          }),
        );
      return unwrap(
        api.POST('/v1/estates/{estateId}/sos/{id}/resolve', {
          params: { path },
          body: { resolution: value, falseAlarm: dialog === 'false' },
        }),
      );
    }).then((ok) => {
      if (ok) {
        setDialog(null);
        setText('');
      }
    });
  };

  if (detail.isPending)
    return (
      <SafeAreaView style={[styles.screen, { padding: spacing[4], gap: spacing[3] }]}>
        <Skeleton height={64} />
        <Skeleton height={160} />
      </SafeAreaView>
    );
  if (detail.isError)
    return (
      <SafeAreaView style={[styles.screen, { padding: spacing[4], justifyContent: 'center' }]}>
        <View style={styles.panel}>
          {isNetworkError(detail.error) ? (
            <Text style={styles.panelText}>{t('mm.sos.offline')}</Text>
          ) : (
            <Text style={styles.panelText}>{errorText(detail.error)}</Text>
          )}
        </View>
        <View style={{ gap: spacing[3], marginTop: spacing[4] }}>
          <AlarmButton label={t('common.retry')} solid onPress={() => void detail.refetch()} />
          <AlarmButton label={t('ui.back')} onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );

  const alert = detail.data;
  const active = ACTIVE_SOS.has(alert.status);
  const actions = sosActions(alert.status);
  const location = alert.lastLocation;
  const dialogRequired = dialog !== 'close' && dialog !== 'escalate';

  return (
    <SafeAreaView style={[styles.screen, !active && { backgroundColor: colors.semantic.text }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`${t('mm.sos.alarm')}. ${categoryText(alert.category)}. ${
            alert.unitCode ?? t('sos.unknownUnit')
          }`}
          style={styles.head}
        >
          <Icon name="warning" size={56} color={colors.neutral[0]} />
          {alert.isDrill ? <Text style={styles.drill}>{t('sos.drillBanner')}</Text> : null}
          <Text style={styles.word}>{t('mm.sos.alarm')}</Text>
          <Text style={styles.category}>{categoryText(alert.category)}</Text>
          <Text style={styles.unit}>{alert.unitCode ?? t('sos.unknownUnit')}</Text>
          <Text style={styles.meta}>
            {t('mm.sos.ago', { time: formatElapsed(alert.triggeredAt, now) })} ·{' '}
            {sosStatusText(alert.status)}
          </Text>
        </View>

        {!active ? <Text style={styles.meta}>{t('mm.sos.ended')}</Text> : null}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <View style={{ gap: spacing[3] }}>
          {actions.acknowledge ? (
            <AlarmButton
              label={t('sos.action.acknowledge')}
              icon="hand-left-outline"
              solid
              busy={busy === 'acknowledge'}
              onPress={() => step('acknowledge')}
            />
          ) : null}
          {actions.responding ? (
            <AlarmButton
              label={t('sos.action.responding')}
              icon="walk-outline"
              solid
              busy={busy === 'responding'}
              onPress={() => step('responding')}
            />
          ) : null}
          {active && alert.residentPhone ? (
            <AlarmButton
              label={
                alert.residentName
                  ? t('mm.sos.callResident', { name: alert.residentName })
                  : t('mm.sos.callResidentPlain')
              }
              icon="call-outline"
              onPress={() => void Linking.openURL(`tel:${alert.residentPhone}`)}
            />
          ) : null}
          {active ? (
            <AlarmButton
              label={t('mm.sos.escalate')}
              icon="megaphone-outline"
              busy={busy === 'escalate'}
              onPress={() => {
                setText('');
                setDialog('escalate');
              }}
            />
          ) : null}
          {active && can('security.staff.manage') ? (
            <AlarmButton
              label={t('mm.sos.assign')}
              icon="person-add-outline"
              onPress={() => setAssigning(true)}
            />
          ) : null}
          {location ? (
            <>
              <AlarmButton
                label={t('mm.sos.openMap')}
                icon="location-outline"
                onPress={() => void Linking.openURL(mapsUrl(location.lat, location.lng))}
              />
              <Text style={styles.meta}>
                {t('mm.sos.locationAt', { time: formatTime(location.capturedAt) })}
              </Text>
            </>
          ) : active ? (
            <Text style={styles.meta}>{t('sos.field.noLocation')}</Text>
          ) : null}
          {active
            ? (alert.emergencyContacts ?? []).map((contact) => (
                <AlarmButton
                  key={`${contact.name}${contact.phone}`}
                  label={t('mm.sos.callContact', {
                    name: contact.name,
                    relationship: contact.relationship,
                  })}
                  icon="call-outline"
                  onPress={() => void Linking.openURL(`tel:${contact.phone}`)}
                />
              ))
            : null}
          {actions.note ? (
            <AlarmButton
              label={t('sos.action.note')}
              icon="create-outline"
              onPress={() => {
                setText('');
                setDialog('note');
              }}
            />
          ) : null}
          {actions.resolve ? (
            <>
              <AlarmButton
                label={t('sos.action.resolve')}
                icon="checkmark-done-outline"
                solid
                onPress={() => {
                  setText('');
                  setDialog('resolve');
                }}
              />
              <AlarmButton
                label={t('mm.sos.falseAlarm')}
                icon="close-outline"
                onPress={() => {
                  setText('');
                  setDialog('false');
                }}
              />
            </>
          ) : null}
          {actions.close ? (
            <AlarmButton
              label={t('sos.action.close')}
              icon="archive-outline"
              solid
              onPress={() => {
                setText('');
                setDialog('close');
              }}
            />
          ) : null}
        </View>

        {alert.resolution ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>{t('sos.field.resolution')}</Text>
            <Text style={styles.panelText}>
              {alert.resolution}
              {alert.falseAlarm ? ` (${t('sos.field.falseAlarm')})` : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t('sos.timeline')}</Text>
          {alert.timeline
            .slice()
            .reverse()
            .map((event) => (
              <View key={event.id} style={styles.event}>
                <Text style={styles.eventTime}>{formatTime(event.occurredAt)}</Text>
                <Text style={styles.panelText}>
                  {eventText(event.type)}
                  {typeof event.payload.note === 'string' ? `: ${event.payload.note}` : ''}
                </Text>
              </View>
            ))}
        </View>

        <AlarmButton label={t('ui.back')} icon="arrow-back" onPress={() => router.back()} />
      </ScrollView>

      <AssignSheet
        visible={assigning}
        busy={busy === 'assign'}
        onClose={() => setAssigning(false)}
        onPick={assign}
      />

      <ConfirmModal
        visible={dialog !== null}
        title={
          dialog === 'false'
            ? t('mm.sos.falseTitle')
            : dialog === 'escalate'
              ? t('mm.sos.escalateTitle')
              : dialog
                ? t(`sos.dialog.${dialog === 'resolve' ? 'resolve' : dialog}.title`)
                : ''
        }
        body={
          dialog === 'escalate'
            ? t('mm.sos.escalateBody')
            : dialog
              ? t(`mm.sos.dialogBody.${dialog}`)
              : ''
        }
        confirmLabel={
          dialog === 'false'
            ? t('mm.sos.falseAlarm')
            : dialog === 'escalate'
              ? t('mm.sos.escalate')
              : dialog
                ? t(`sos.dialog.${dialog === 'resolve' ? 'resolve' : dialog}.submit`)
                : ''
        }
        busy={busy === dialog}
        error={dialog ? error : null}
        reason={{
          label:
            dialog === 'close' || dialog === 'escalate'
              ? t('sos.dialog.close.label')
              : dialog === 'note'
                ? t('sos.dialog.note.label')
                : t('sos.dialog.resolve.label'),
          value: text,
          onChange: setText,
          required: dialogRequired,
        }}
        onConfirm={() => {
          if (dialogRequired && text.trim().length < 3) {
            setError(t('mm.sos.textTooShort'));
            return;
          }
          if (!dialogRequired && text.trim().length > 0 && text.trim().length < 3) {
            setError(t('mm.sos.textTooShort'));
            return;
          }
          submitDialog();
        }}
        onCancel={() => {
          setDialog(null);
          setError(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.status.danger },
  body: { padding: spacing[4], gap: spacing[4] },
  head: { alignItems: 'center', gap: spacing[1], paddingTop: spacing[2] },
  drill: {
    color: colors.status.danger,
    backgroundColor: colors.neutral[0],
    padding: spacing[2],
    borderRadius: radii.sm,
    fontWeight: typography.weight.bold,
    textAlign: 'center',
  },
  word: {
    color: colors.neutral[0],
    fontSize: 44,
    fontWeight: typography.weight.bold,
    letterSpacing: 2,
  },
  category: {
    color: colors.neutral[0],
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
  },
  unit: {
    color: colors.neutral[0],
    fontSize: typography.size.xl,
    fontWeight: typography.weight.semibold,
  },
  meta: {
    color: colors.neutral[0],
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    textAlign: 'center',
  },
  error: {
    color: colors.neutral[0],
    backgroundColor: colors.semantic.text,
    padding: spacing[3],
    borderRadius: radii.sm,
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
  },
  button: {
    minHeight: touchTarget.security,
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  buttonSolid: { backgroundColor: colors.neutral[0] },
  buttonGhost: { borderWidth: 2, borderColor: colors.neutral[0] },
  buttonText: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  panel: {
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.neutral[0],
  },
  panelTitle: {
    color: colors.neutral[0],
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  panelText: {
    flex: 1,
    color: colors.neutral[0],
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  event: { flexDirection: 'row', gap: spacing[3] },
  eventTime: {
    color: colors.neutral[0],
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  scrim: { flex: 1, backgroundColor: colors.overlay.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
  },
  sheetTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
});

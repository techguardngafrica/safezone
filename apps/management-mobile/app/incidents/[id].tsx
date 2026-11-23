import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Card,
  ConfirmModal,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  INCIDENT_STATUS_TONE,
  type IncidentAction,
  SEVERITY_TONE,
  canAssignIncident,
  incidentActions,
  needsText,
} from '../../src/features/incident-rules';
import { errorText } from '../../src/lib/errors';
import { useManager } from '../../src/lib/manager';
import { api } from '../../src/lib/session';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
        {label}
      </Text>
      <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>{value}</Text>
    </View>
  );
}

function AssignIncidentSheet({
  visible,
  busy,
  onClose,
  onPick,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onPick: (userId: string) => void;
}) {
  const { estateId } = useManager();
  const staff = useQuery({
    queryKey: ['estate', estateId, 'staff'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/staff', { params: { path: { estateId } } })),
    enabled: visible,
  });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('ui.close')}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('mm.incidents.assignTitle')}
          </Text>
          {staff.isPending || busy ? <ActivityIndicator color={colors.brand.primary} /> : null}
          {staff.isError ? (
            <ErrorState message={errorText(staff.error)} onRetry={() => void staff.refetch()} />
          ) : null}
          <ScrollView style={{ maxHeight: 360 }}>
            {(staff.data ?? []).map((member) => (
              <ListRow
                key={member.userId}
                title={member.fullName ?? t('mm.approvals.unknownName')}
                subtitle={member.assignments.map((a) => a.roleName).join(', ')}
                leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
                onPress={() => onPick(member.userId)}
              />
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Incident detail: facts, assignment, timeline and notes; managers can review, assign, resolve, reopen and close. */
export default function IncidentDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, can } = useManager();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['estate', estateId, 'incidents', 'detail', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/incidents/{id}', { params: { path: { estateId, id } } }),
      ),
  });
  const staff = useQuery({
    queryKey: ['estate', estateId, 'staff'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/staff', { params: { path: { estateId } } })),
    enabled: can('incident.manage'),
    staleTime: 5 * 60_000,
  });
  const pull = usePullRefresh(detail.refetch);
  const [note, setNote] = useState('');
  const [action, setAction] = useState<IncidentAction | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [text, setText] = useState('');

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'incidents'] });

  const addNote = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/incidents/{id}/notes', {
          params: { path: { estateId, id } },
          body: { body: note.trim() },
        }),
      ),
    onSuccess: () => {
      setNote('');
      void refresh();
    },
  });
  const transition = useMutation({
    mutationFn: ({ kind, version }: { kind: IncidentAction; version: number }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/incidents/{id}/transition', {
          params: { path: { estateId, id } },
          body: {
            action: kind,
            version,
            ...(kind === 'resolve' ? { resolution: text.trim() } : {}),
            ...(kind !== 'resolve' && text.trim() ? { note: text.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setAction(null);
      setText('');
      void refresh();
    },
  });
  const assign = useMutation({
    mutationFn: ({ assigneeId, version }: { assigneeId: string; version: number }) =>
      unwrap(
        api.POST('/v1/estates/{estateId}/incidents/{id}/transition', {
          params: { path: { estateId, id } },
          body: { action: 'assign', version, assigneeId },
        }),
      ),
    onSuccess: () => {
      setAssigning(false);
      void refresh();
    },
  });

  if (detail.isPending)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        <Skeleton height={28} width="70%" />
        <Skeleton height={160} />
      </ScrollScreen>
    );
  if (detail.isError)
    return (
      <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
        <ScreenHeader
          title={t('mm.incidents.title')}
          onBack={() => router.back()}
          backIcon={<Icon name="arrow-back" />}
        />
        <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
      </ScrollScreen>
    );

  const incident = detail.data;
  const actions = can('incident.manage') ? incidentActions(incident.status) : [];
  const textRequired = action ? needsText(action) : false;
  const assigneeName = incident.assignedTo
    ? (staff.data?.find((m) => m.userId === incident.assignedTo)?.fullName ??
      t('mm.approvals.unknownName'))
    : t('mm.incidents.unassigned');

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={incident.title}
        subtitle={formatDateTime(incident.occurredAt)}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <View style={{ flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' }}>
        <StatusPill
          tone={INCIDENT_STATUS_TONE[incident.status]}
          label={t(`incident.status.${incident.status}` as MessageKey)}
        />
        <StatusPill
          tone={SEVERITY_TONE[incident.severity]}
          label={t(`incident.severity.${incident.severity}` as MessageKey)}
        />
        <StatusPill
          tone="neutral"
          label={t(`incident.category.${incident.category}` as MessageKey)}
        />
      </View>

      <Card>
        <View style={{ gap: spacing[3] }}>
          <Field label={t('mm.incidents.description')} value={incident.description} />
          <Field label={t('mm.incidents.assignedTo')} value={assigneeName} />
          <Field
            label={t('mm.incidents.place')}
            value={
              incident.gateName ??
              incident.unitCode ??
              incident.locationText ??
              t(`incident.location.${incident.locationKind}` as MessageKey)
            }
          />
          <Field label={t('mm.incidents.people')} value={incident.peopleInvolved} />
          <Field label={t('incident.detail.policeRef')} value={incident.policeReportRef} />
          <Field label={t('incident.detail.resolution')} value={incident.resolution} />
          {incident.evidenceCount > 0 ? (
            <Field
              label={t('incident.detail.evidence', { count: incident.evidenceCount })}
              value={t('mm.incidents.evidenceOnWeb')}
            />
          ) : null}
        </View>
      </Card>

      {can('incident.manage') && canAssignIncident(incident.status) ? (
        <ActionButton
          label={t('mm.incidents.assign')}
          variant="outline"
          icon={<Icon name="person-add-outline" size={18} color={colors.brand.primary} />}
          onPress={() => setAssigning(true)}
        />
      ) : null}

      {actions.length > 0 ? (
        <View style={{ gap: spacing[2] }}>
          {actions.map((kind) => (
            <ActionButton
              key={kind}
              label={t(`incident.action.${kind}` as MessageKey)}
              variant={kind === 'resolve' || kind === 'close' ? 'primary' : 'outline'}
              onPress={() => {
                setText('');
                setAction(kind);
              }}
            />
          ))}
        </View>
      ) : null}

      <SectionHeader title={t('incident.detail.timeline')} />
      {incident.status !== 'closed' ? (
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t('incident.detail.addNote')}
            placeholder={t('incident.detail.notePlaceholder')}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={2000}
            error={addNote.isError ? errorText(addNote.error) : null}
          />
          <ActionButton
            label={t('incident.detail.addNote')}
            variant="outline"
            busy={addNote.isPending}
            disabled={note.trim().length === 0}
            onPress={() => addNote.mutate()}
          />
        </View>
      ) : null}
      {incident.notes
        .slice()
        .reverse()
        .map((entry) => (
          <Card key={entry.id}>
            <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
              {formatDateTime(entry.createdAt)}
              {entry.toStatus ? ` · ${t(`incident.status.${entry.toStatus}` as MessageKey)}` : ''}
            </Text>
            {entry.body ? (
              <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
                {entry.body}
              </Text>
            ) : null}
          </Card>
        ))}

      <AssignIncidentSheet
        visible={assigning}
        busy={assign.isPending}
        onClose={() => setAssigning(false)}
        onPick={(assigneeId) => assign.mutate({ assigneeId, version: incident.version })}
      />

      <ConfirmModal
        visible={action !== null}
        title={action ? t(`incident.action.${action}` as MessageKey) : ''}
        body={action ? t(`mm.incidents.confirm.${action}` as MessageKey) : ''}
        confirmLabel={action ? t(`incident.action.${action}` as MessageKey) : ''}
        busy={transition.isPending}
        error={transition.isError ? errorText(transition.error) : null}
        reason={{
          label: textRequired ? t('incident.detail.resolution') : t('join.noteOptional'),
          value: text,
          onChange: setText,
          required: textRequired,
        }}
        onConfirm={() => {
          if (!action || (textRequired && text.trim().length < 3)) return;
          transition.mutate({ kind: action, version: incident.version });
        }}
        onCancel={() => {
          setAction(null);
          transition.reset();
        }}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
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

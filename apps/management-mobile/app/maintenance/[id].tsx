import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ConfirmModal,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Segmented,
  Skeleton,
  StatusPill,
  TextField,
  ToggleRow,
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
  MAINTENANCE_PRIORITY_TONE,
  MAINTENANCE_STATUS_TONE,
  type MaintenanceAction,
  canAssignWorkOrder,
  maintenanceActions,
  maintenanceNeedsReason,
} from '../../src/features/maintenance-rules';
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

function AssignWorkOrderModal({
  visible,
  requestId,
  defaultTitle,
  spaceId,
  onClose,
}: {
  visible: boolean;
  requestId: string;
  defaultTitle: string;
  spaceId: string | null;
  onClose: () => void;
}) {
  const { estateId } = useManager();
  const queryClient = useQueryClient();
  const [assigneeType, setAssigneeType] = useState<'staff' | 'vendor'>('staff');
  const [staffUserId, setStaffUserId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorCompany, setVendorCompany] = useState('');
  const [scope, setScope] = useState('');

  const staff = useQuery({
    queryKey: ['estate', estateId, 'staff'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/staff', { params: { path: { estateId } } })),
    enabled: visible && assigneeType === 'staff',
  });

  const create = useMutation({
    mutationFn: () => {
      const assignee =
        assigneeType === 'staff'
          ? { type: 'staff' as const, userId: staffUserId ?? '' }
          : {
              type: 'vendor' as const,
              name: vendorName.trim(),
              phone: vendorPhone.trim(),
              ...(vendorCompany.trim() ? { company: vendorCompany.trim() } : {}),
            };
      return unwrap(
        api.POST('/v1/estates/{estateId}/work-orders', {
          params: { path: { estateId } },
          body: {
            requestId,
            title: defaultTitle,
            scope: scope.trim() || defaultTitle,
            ...(spaceId ? { spaceId } : {}),
            assignee,
          },
        }),
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'maintenance-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'work-orders'] }),
      ]);
      onClose();
    },
  });

  const canSubmit =
    assigneeType === 'staff'
      ? Boolean(staffUserId)
      : vendorName.trim().length >= 2 && /^\+234[789][01]\d{8}$/.test(vendorPhone.trim());

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('ui.close')}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {t('mm.maintenance.assignWorkOrder')}
          </Text>
          <Segmented
            label={t('mm.maintenance.assigneeType')}
            value={assigneeType}
            onChange={setAssigneeType}
            options={[
              { key: 'staff', label: t('mm.maintenance.assignee.staff') },
              { key: 'vendor', label: t('mm.maintenance.assignee.vendor') },
            ]}
          />
          <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: spacing[3] }}>
            {assigneeType === 'staff' ? (
              <>
                {staff.isPending ? <ActivityIndicator color={colors.brand.primary} /> : null}
                {(staff.data ?? []).map((member) => (
                  <ListRow
                    key={member.userId}
                    title={member.fullName ?? t('mm.approvals.unknownName')}
                    subtitle={member.assignments.map((a) => a.roleName).join(', ')}
                    leading={
                      <Icon
                        name={
                          staffUserId === member.userId ? 'checkmark-circle' : 'ellipse-outline'
                        }
                        color={colors.brand.primary}
                        size={20}
                      />
                    }
                    onPress={() => setStaffUserId(member.userId)}
                  />
                ))}
              </>
            ) : (
              <>
                <TextField
                  label={t('mm.maintenance.vendorName')}
                  value={vendorName}
                  onChangeText={setVendorName}
                  autoCapitalize="words"
                />
                <TextField
                  label={t('mm.maintenance.vendorPhone')}
                  value={vendorPhone}
                  onChangeText={setVendorPhone}
                  keyboardType="phone-pad"
                />
                <TextField
                  label={t('mm.maintenance.vendorCompany')}
                  value={vendorCompany}
                  onChangeText={setVendorCompany}
                  autoCapitalize="words"
                />
              </>
            )}
            <TextField
              label={t('mm.maintenance.woScope')}
              value={scope}
              onChangeText={setScope}
              multiline
            />
            {create.isError ? <Banner tone="danger">{errorText(create.error)}</Banner> : null}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            <View style={{ flex: 1 }}>
              <ActionButton label={t('common.cancel')} variant="outline" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <ActionButton
                label={t('mm.maintenance.woCreate')}
                disabled={!canSubmit}
                busy={create.isPending}
                onPress={() => create.mutate()}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Maintenance request detail, triage, work-order assignment & comments (management-mobile.md §7.5). */
export default function MaintenanceDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId, can } = useManager();
  const queryClient = useQueryClient();

  const detail = useQuery({
    queryKey: ['estate', estateId, 'maintenance-requests', 'detail', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-requests/{id}', {
          params: { path: { estateId, id } },
        }),
      ),
  });
  const workOrders = useQuery({
    queryKey: ['estate', estateId, 'work-orders', id],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/work-orders', {
          params: { path: { estateId }, query: { requestId: id } },
        }),
      ),
  });
  const pull = usePullRefresh(() => Promise.all([detail.refetch(), workOrders.refetch()]));

  const [action, setAction] = useState<MaintenanceAction | null>(null);
  const [text, setText] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'maintenance-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'work-orders'] }),
    ]);

  const transition = useMutation({
    mutationFn: (kind: MaintenanceAction) => {
      const value = text.trim();
      const path = { estateId, id };
      switch (kind) {
        case 'review':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/review', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'approve':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/approve', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'reject':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/reject', {
              params: { path },
              body: { reason: value },
            }),
          );
        case 'request_info':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/request-info', {
              params: { path },
              body: { reason: value },
            }),
          );
        case 'start':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/start', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'await_materials':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/await-materials', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'resume':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/resume', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'resolve':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/resolve', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'close':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/close', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
        case 'reopen':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/reopen', {
              params: { path },
              body: { reason: value },
            }),
          );
        case 'cancel':
          return unwrap(
            api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/cancel', {
              params: { path },
              body: value ? { note: value } : {},
            }),
          );
      }
    },
    onSuccess: () => {
      setAction(null);
      setText('');
      void refresh();
    },
  });

  const addComment = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/maintenance-requests/{id}/comments', {
          params: { path: { estateId, id } },
          body: { body: comment.trim(), internal },
        }),
      ),
    onSuccess: () => {
      setComment('');
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
          title={t('mm.maintenance.detailTitle')}
          onBack={() => router.back()}
          backIcon={<Icon name="arrow-back" />}
        />
        <ErrorState message={errorText(detail.error)} onRetry={() => void detail.refetch()} />
      </ScrollScreen>
    );

  const req = detail.data;
  const actions = can('maintenance.assign') ? maintenanceActions(req.status) : [];
  const reasonRequired = action ? maintenanceNeedsReason(action) : false;

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']} {...pull}>
      <ScreenHeader
        title={`${req.number} · ${req.title}`}
        subtitle={[req.unitCode, req.categoryName, formatDateTime(req.createdAt)]
          .filter(Boolean)
          .join(' · ')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <View style={{ flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' }}>
        <StatusPill
          tone={MAINTENANCE_STATUS_TONE[req.status]}
          label={t(`mm.maintenance.status.${req.status}` as MessageKey)}
        />
        <StatusPill
          tone={MAINTENANCE_PRIORITY_TONE[req.priority]}
          label={t(`mm.maintenance.priority.${req.priority}` as MessageKey)}
        />
        {req.slaBreached ? (
          <StatusPill tone="danger" label={t('mm.maintenance.slaBreached')} />
        ) : null}
      </View>

      <Card>
        <View style={{ gap: spacing[3] }}>
          <Field label={t('mm.maintenance.description')} value={req.description} />
          <Field label={t('mm.maintenance.preferredTimes')} value={req.preferredTimes} />
          {req.slaDueAt ? (
            <Field
              label={t('mm.maintenance.slaDue', { time: formatDateTime(req.slaDueAt) })}
              value={req.slaBreached ? t('mm.maintenance.slaBreached') : undefined}
            />
          ) : null}
        </View>
      </Card>

      {can('maintenance.assign') && canAssignWorkOrder(req.status) ? (
        <ActionButton
          label={t('mm.maintenance.assignWorkOrder')}
          icon={<Icon name="person-add-outline" size={18} color={colors.brand.onPrimary} />}
          onPress={() => setAssigning(true)}
        />
      ) : null}

      {actions.length > 0 ? (
        <View style={{ gap: spacing[2] }}>
          {actions.map((kind) => (
            <ActionButton
              key={kind}
              label={t(`mm.maintenance.action.${kind}` as MessageKey)}
              variant={
                kind === 'approve' || kind === 'resolve' || kind === 'close' ? 'primary' : 'outline'
              }
              onPress={() => {
                setText('');
                setAction(kind);
              }}
            />
          ))}
        </View>
      ) : null}

      <SectionHeader title={t('mm.maintenance.workOrders')} />
      {(workOrders.data ?? []).length === 0 ? (
        <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
          {t('mm.maintenance.workOrdersEmpty')}
        </Text>
      ) : (
        (workOrders.data ?? []).map((wo) => (
          <Card key={wo.id}>
            <View style={{ gap: spacing[1] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text
                  style={{
                    fontSize: typography.size.md,
                    fontWeight: typography.weight.semibold,
                    color: colors.semantic.text,
                  }}
                >
                  {wo.number} · {wo.title}
                </Text>
                <StatusPill tone="info" label={wo.status} />
              </View>
              <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                {[
                  wo.assigneeType === 'vendor' ? wo.vendorName : t('mm.maintenance.assignee.staff'),
                  wo.scope,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </Card>
        ))
      )}

      <SectionHeader title={t('mm.maintenance.comments')} />
      {req.status !== 'closed' && req.status !== 'cancelled' ? (
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t('mm.maintenance.addComment')}
            placeholder={t('mm.maintenance.commentPlaceholder')}
            value={comment}
            onChangeText={setComment}
            multiline
            error={addComment.isError ? errorText(addComment.error) : null}
          />
          <ToggleRow
            label={t('mm.maintenance.internalNote')}
            helper={t('mm.maintenance.internalHelper')}
            value={internal}
            onChange={setInternal}
          />
          <ActionButton
            label={t('mm.maintenance.addComment')}
            variant="outline"
            busy={addComment.isPending}
            disabled={comment.trim().length === 0}
            onPress={() => addComment.mutate()}
          />
        </View>
      ) : null}
      {req.comments
        .slice()
        .reverse()
        .map((entry) => (
          <Card key={entry.id}>
            <View style={{ gap: spacing[1] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
                  {formatDateTime(entry.createdAt)}
                </Text>
                {entry.internal ? (
                  <StatusPill tone="warning" label={t('mm.maintenance.internalBadge')} />
                ) : null}
              </View>
              <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
                {entry.body}
              </Text>
            </View>
          </Card>
        ))}

      <AssignWorkOrderModal
        visible={assigning}
        requestId={req.id}
        defaultTitle={req.title}
        spaceId={req.spaceId ?? null}
        onClose={() => setAssigning(false)}
      />

      <ConfirmModal
        visible={action !== null}
        title={action ? t(`mm.maintenance.action.${action}` as MessageKey) : ''}
        body={action ? t(`mm.maintenance.confirm.${action}` as MessageKey) : ''}
        confirmLabel={action ? t(`mm.maintenance.action.${action}` as MessageKey) : ''}
        destructive={action === 'reject' || action === 'cancel'}
        busy={transition.isPending}
        error={transition.isError ? errorText(transition.error) : null}
        reason={{
          label: reasonRequired ? t('join.reason') : t('join.noteOptional'),
          value: text,
          onChange: setText,
          required: reasonRequired,
        }}
        onConfirm={() => {
          if (!action) return;
          if (reasonRequired && text.trim().length < 3) return;
          transition.mutate(action);
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

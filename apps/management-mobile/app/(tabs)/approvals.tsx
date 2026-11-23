import { colors, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  StatusPill,
} from '@safezone/mobile-ui';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  type ApprovalCategory,
  filterApprovals,
  reasonIsValid,
} from '../../src/features/approval-items';
import {
  type ApprovalItem,
  type ApprovalKind,
  useApprovals,
  useDecideApproval,
} from '../../src/features/approvals';
import { errorText, isNetworkError } from '../../src/lib/errors';
import { usePullRefresh } from '../../src/lib/use-pull-refresh';

/** Kinds whose approval can carry a note; the others approve with no body. */
const APPROVE_NOTE: Record<ApprovalKind, boolean> = {
  join: true,
  waiver: true,
  manual_payment: true,
  refund: true,
  billing_run: false,
  booking: false,
  staff_pass: false,
  move: false,
  channel: false,
  ownership_transfer: false,
};

const CATEGORIES: readonly ApprovalCategory[] = [
  'all',
  'people',
  'finance',
  'facilities',
  'community',
];

function ApprovalCard({
  item,
  onDecide,
}: {
  item: ApprovalItem;
  onDecide: (action: 'approve' | 'reject') => void;
}) {
  return (
    <Card>
      <View style={{ gap: spacing[2] }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing[2] }}>
          <StatusPill tone="info" label={t(`mm.approvals.kind.${item.kind}` as MessageKey)} />
          {item.createdAt ? (
            <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
              {formatDateTime(item.createdAt)}
            </Text>
          ) : null}
        </View>
        <Text
          style={{
            fontSize: typography.size.lg,
            fontWeight: typography.weight.semibold,
            color: colors.semantic.text,
          }}
        >
          {item.title}
        </Text>
        {item.detail ? (
          <Text style={{ fontSize: typography.size.md, color: colors.semantic.text }}>
            {item.detail}
          </Text>
        ) : null}
        {item.note ? (
          <Text style={{ fontSize: typography.size.sm, color: colors.semantic.textMuted }}>
            “{item.note}”
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <ActionButton label={t('join.approve')} onPress={() => onDecide('approve')} />
          </View>
          <View style={{ flex: 1 }}>
            <ActionButton
              label={t('join.reject')}
              variant="outline"
              onPress={() => onDecide('reject')}
            />
          </View>
        </View>
      </View>
    </Card>
  );
}

/** Unified approvals inbox (management-mobile.md §6). Decisions need a connection (§9). */
export default function ApprovalsScreen() {
  const approvals = useApprovals();
  const decide = useDecideApproval();
  const pull = usePullRefresh(approvals.refetch);
  const [category, setCategory] = useState<ApprovalCategory>('all');
  const [pending, setPending] = useState<{
    item: ApprovalItem;
    action: 'approve' | 'reject';
  } | null>(null);
  const [reason, setReason] = useState('');

  const close = () => {
    setPending(null);
    setReason('');
    decide.reset();
  };

  const filtered = filterApprovals(approvals.items, category);
  const withNote = pending
    ? (pending.action === 'reject' && pending.item.kind !== 'staff_pass') ||
      (pending.action === 'approve' && APPROVE_NOTE[pending.item.kind])
    : false;
  const reasonRequired = pending?.action === 'reject' && pending.item.kind !== 'staff_pass';

  return (
    <ScrollScreen {...pull}>
      <ScreenHeader title={t('mm.approvals.title')} subtitle={t('mm.approvals.subtitle')} />
      {approvals.error && isNetworkError(approvals.error) ? (
        <Banner tone="warning">{t('mm.offline.actions')}</Banner>
      ) : null}
      {approvals.items.length > 0 ? (
        <ChipGroup
          label={t('mm.approvals.title')}
          options={CATEGORIES.map((key) => ({
            key,
            label: t(`mm.approvals.filter.${key}` as MessageKey),
          }))}
          value={category}
          onChange={setCategory}
        />
      ) : null}
      {approvals.isPending ? (
        <>
          <Skeleton height={140} />
          <Skeleton height={140} />
        </>
      ) : null}
      {approvals.error && !isNetworkError(approvals.error) && approvals.items.length === 0 ? (
        <ErrorState message={errorText(approvals.error)} onRetry={() => void approvals.refetch()} />
      ) : null}
      {!approvals.isPending && !approvals.error && filtered.length === 0 ? (
        <EmptyState
          icon={<Icon name="checkmark-done-outline" size={28} color={colors.brand.primary} />}
          title={approvals.anyAllowed ? t('mm.approvals.empty') : t('mm.approvals.none')}
          body={approvals.anyAllowed ? t('mm.approvals.emptyBody') : t('mm.approvals.noneBody')}
        />
      ) : null}
      {filtered.map((item) => (
        <ApprovalCard
          key={`${item.kind}-${item.id}`}
          item={item}
          onDecide={(action) => {
            setReason('');
            setPending({ item, action });
          }}
        />
      ))}

      <ConfirmModal
        visible={pending !== null}
        title={
          pending
            ? t(`mm.approvals.confirm.${pending.action}` as MessageKey, {
                name: pending.item.title,
              })
            : ''
        }
        body={
          pending
            ? t(`mm.approvals.confirmBody.${pending.item.kind}.${pending.action}` as MessageKey)
            : ''
        }
        confirmLabel={pending?.action === 'reject' ? t('join.reject') : t('join.approve')}
        destructive={pending?.action === 'reject'}
        busy={decide.isPending}
        error={decide.isError ? errorText(decide.error) : null}
        reason={
          withNote
            ? {
                label: reasonRequired ? t('join.reason') : t('join.noteOptional'),
                value: reason,
                onChange: setReason,
                required: reasonRequired,
              }
            : undefined
        }
        onConfirm={() => {
          if (!pending) return;
          if (reasonRequired && !reasonIsValid('reject', reason)) return;
          if (!reasonRequired && withNote && !reasonIsValid('approve', reason)) return;
          decide.mutate(
            { item: pending.item, action: pending.action, reason: withNote ? reason : '' },
            { onSuccess: close },
          );
        }}
        onCancel={close}
      />
    </ScrollScreen>
  );
}

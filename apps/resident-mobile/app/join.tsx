import { type ApiData, type ApiRow, unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDateTime, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  ChipGroup,
  ConfirmModal,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  Skeleton,
  StatusPill,
  TextField,
  type Tone,
  useSession,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Icon } from '../src/components/icon';
import { errorText } from '../src/lib/errors';
import { api, session } from '../src/lib/session';
import { usePullRefresh } from '../src/lib/use-pull-refresh';

type JoinRequest = ApiRow<'/v1/me/join-requests', 'get'>;
type Estate = ApiData<'/v1/join/estates/{code}', 'get'>;
type Unit = ApiRow<'/v1/join/estates/{code}/units', 'get'>;
type Relationship = JoinRequest['relationship'];

const PENDING = new Set(['awaiting_household_head', 'awaiting_owner', 'awaiting_manager']);
const TONE: Record<JoinRequest['status'], Tone> = {
  awaiting_household_head: 'info',
  awaiting_owner: 'info',
  awaiting_manager: 'info',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function MyRequests({ requests }: { requests: JoinRequest[] }) {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<JoinRequest | null>(null);
  const cancel = useMutation({
    mutationFn: (request: JoinRequest) =>
      unwrap(
        api.POST('/v1/me/join-requests/{id}/cancel', { params: { path: { id: request.id } } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'join-requests'] });
      setCancelling(null);
    },
  });
  if (requests.length === 0) return null;
  return (
    <>
      <SectionHeader title={t('res.join.yourRequests')} />
      {requests.map((request) => (
        <Card key={request.id}>
          <StatusPill
            tone={TONE[request.status]}
            label={t(`join.status.${request.status}` as MessageKey)}
          />
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.semantic.text }}>
            {t('res.join.unitLine', { unit: `${request.unit.code} ${request.unit.name}`.trim() })}
          </Text>
          <Text style={{ color: colors.semantic.textMuted }}>
            {t('res.join.sentOn', { date: formatDateTime(request.createdAt) })}
          </Text>
          {PENDING.has(request.status) ? (
            <>
              <Text style={{ color: colors.semantic.text }}>{t('res.join.pendingBody')}</Text>
              <ActionButton
                label={t('res.join.cancel')}
                variant="text"
                onPress={() => setCancelling(request)}
              />
            </>
          ) : null}
          {request.reason ? (
            <Text style={{ color: colors.semantic.textMuted }}>
              {t('res.join.reason', { reason: request.reason })}
            </Text>
          ) : null}
        </Card>
      ))}
      <ConfirmModal
        visible={Boolean(cancelling)}
        title={t('res.join.cancelTitle')}
        body={t('res.join.cancelBody')}
        confirmLabel={t('res.join.cancel')}
        cancelLabel={t('res.join.keep')}
        destructive
        busy={cancel.isPending}
        error={cancel.isError ? errorText(cancel.error) : null}
        onConfirm={() => cancelling && cancel.mutate(cancelling)}
        onCancel={() => setCancelling(null)}
      />
    </>
  );
}

function JoinForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const state = useSession(session);
  const [code, setCode] = useState('');
  const [estate, setEstate] = useState<Estate | null>(null);
  const [search, setSearch] = useState('');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [fullName, setFullName] = useState(state.user?.fullName ?? '');
  const [message, setMessage] = useState('');
  const q = useDebounced(search.trim());

  const lookup = useMutation({
    mutationFn: () =>
      unwrap(
        api.GET('/v1/join/estates/{code}', {
          params: { path: { code: code.trim().toUpperCase() } },
        }),
      ),
    onSuccess: setEstate,
  });
  const units = useQuery({
    queryKey: ['join', estate?.id, 'units', q],
    queryFn: () =>
      unwrap(
        api.GET('/v1/join/estates/{code}/units', {
          params: { path: { code: code.trim().toUpperCase() }, query: { q } },
        }),
      ),
    enabled: Boolean(estate) && !unit && q.length > 0,
  });
  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/me/join-requests', {
          body: {
            estateId: estate?.id ?? '',
            spaceId: unit?.id ?? '',
            relationship: relationship ?? 'tenant',
            fullName: fullName.trim(),
            message: message.trim() || undefined,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'join-requests'] });
      onDone();
    },
  });

  if (!estate)
    return (
      <Card>
        <TextField
          label={t('res.join.codeLabel')}
          helper={t('res.join.codeHelp')}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          maxLength={12}
          error={lookup.isError ? errorText(lookup.error) : null}
        />
        <ActionButton
          label={t('res.join.findEstate')}
          onPress={() => lookup.mutate()}
          busy={lookup.isPending}
          disabled={code.trim().length < 3}
        />
      </Card>
    );

  return (
    <View style={{ gap: 16 }}>
      <Card>
        <ListRow
          title={estate.name}
          subtitle={t('res.join.estateFound')}
          leading={<Icon name="business-outline" color={colors.brand.primary} />}
          trailing={
            <ActionButton
              label={t('res.join.change')}
              variant="text"
              onPress={() => {
                setEstate(null);
                setUnit(null);
              }}
            />
          }
        />
      </Card>
      {unit ? (
        <Card>
          <ListRow
            title={`${unit.code} ${unit.name}`.trim()}
            subtitle={t('res.join.unitChosen')}
            leading={<Icon name="home-outline" color={colors.brand.primary} />}
            trailing={
              <ActionButton
                label={t('res.join.change')}
                variant="text"
                onPress={() => setUnit(null)}
              />
            }
          />
        </Card>
      ) : (
        <Card>
          <TextField
            label={t('res.join.unitSearch')}
            placeholder={t('res.join.unitPlaceholder')}
            value={search}
            onChangeText={setSearch}
          />
          {q.length === 0 ? (
            <Text style={{ color: colors.semantic.textMuted }}>{t('res.join.unitTypeHint')}</Text>
          ) : units.isPending ? (
            <Skeleton height={48} />
          ) : null}
          {units.isError ? (
            <Text style={{ color: colors.status.danger }}>{errorText(units.error)}</Text>
          ) : null}
          {units.data?.length === 0 ? (
            <Text style={{ color: colors.semantic.textMuted }}>{t('res.join.noUnits')}</Text>
          ) : null}
          {units.data?.slice(0, 20).map((item) => (
            <ListRow
              key={item.id}
              title={item.code}
              subtitle={item.name !== item.code ? item.name : undefined}
              onPress={() => setUnit(item)}
              trailing={<Icon name="chevron-forward" size={18} color={colors.semantic.textMuted} />}
            />
          ))}
        </Card>
      )}
      {unit ? (
        <Card>
          <ChipGroup<Relationship>
            label={t('res.join.relationship')}
            value={relationship}
            onChange={setRelationship}
            options={[
              { key: 'tenant', label: t('join.relationship.tenant') },
              { key: 'owner', label: t('join.relationship.owner') },
              { key: 'household_member', label: t('join.relationship.household_member') },
            ]}
          />
          <TextField
            label={t('res.join.fullName')}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            maxLength={120}
          />
          <TextField
            label={t('res.join.message')}
            helper={t('res.join.messageHelp')}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={500}
          />
          {submit.isError ? <Banner tone="danger">{errorText(submit.error)}</Banner> : null}
          <ActionButton
            label={t('res.join.submit')}
            onPress={() => submit.mutate()}
            busy={submit.isPending}
            disabled={!relationship || fullName.trim().length < 2}
          />
        </Card>
      ) : null}
    </View>
  );
}

/** Join an estate: estate code, unit, relationship. Approval comes from the owner or management. */
export default function JoinScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const requests = useQuery({
    queryKey: ['me', 'join-requests'],
    queryFn: () => unwrap(api.GET('/v1/me/join-requests')),
    refetchInterval: 15_000,
  });
  const list = requests.data ?? [];
  const pending = list.some((request) => PENDING.has(request.status));
  const approved = list.some((request) => request.status === 'approved');

  useEffect(() => {
    if (!approved) return;
    void queryClient
      .invalidateQueries({ queryKey: ['me', 'memberships'] })
      .then(() => router.replace('/'));
  }, [approved, queryClient, router]);

  const pull = usePullRefresh(requests.refetch);
  return (
    <ScrollScreen {...pull}>
      <ScreenHeader title={t('res.join.title')} subtitle={t('res.join.subtitle')} />
      {requests.isPending ? <Skeleton height={120} /> : null}
      <MyRequests requests={list} />
      {showForm || (!pending && !requests.isPending) ? (
        <JoinForm onDone={() => setShowForm(false)} />
      ) : (
        <ActionButton
          label={t('res.join.another')}
          variant="outline"
          onPress={() => setShowForm(true)}
        />
      )}
      <ActionButton
        label={t('res.more.help')}
        variant="outline"
        icon={<Icon name="help-circle-outline" color={colors.brand.primary} size={20} />}
        onPress={() => router.push('/help')}
      />
      <ActionButton
        label={t('auth.signOut')}
        variant="text"
        onPress={() => void session.signOut()}
      />
    </ScrollScreen>
  );
}

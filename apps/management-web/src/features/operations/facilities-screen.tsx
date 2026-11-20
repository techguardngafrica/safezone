'use client';

import { type ApiRow, unwrap } from '@safezone/api-client';
import { formatDateTime, t } from '@safezone/i18n';
import {
  ActionButton,
  type Column,
  ConfirmDialog,
  DataTable,
  Dialog,
  FormError,
  InputField,
  PageHeader,
  SelectField,
  StatusPill,
  Tabs,
  TextAreaField,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useEstate } from '../../../lib/estate';
import { errorText } from '../../../lib/errors';
import { api } from '../../../lib/session';

type Facility = ApiRow<'/v1/estates/{estateId}/facilities', 'get'>;
type Booking = ApiRow<'/v1/estates/{estateId}/bookings', 'get'>;
type TabId = 'facilities' | 'bookings';

const BOOKING_TONE: Record<string, Tone> = {
  pending_approval: 'warning',
  pending_payment: 'warning',
  confirmed: 'success',
  checked_in: 'info',
  completed: 'success',
  cancelled: 'neutral',
  rejected: 'danger',
  no_show: 'danger',
};

export function FacilitiesScreen() {
  const { estateId, can } = useEstate();
  const queryClient = useQueryClient();
  const canManage = can('facility.manage');

  const [tab, setTab] = useState<TabId>('facilities');
  const [creating, setCreating] = useState(false);
  const [facName, setFacName] = useState('');
  const [facType, setFacType] = useState<Facility['type']>('event_hall');
  const [facCapacity, setFacCapacity] = useState('');
  const [facRules, setFacRules] = useState('');

  const [blackoutTarget, setBlackoutTarget] = useState<Facility | null>(null);
  const [blackoutStart, setBlackoutStart] = useState('');
  const [blackoutEnd, setBlackoutEnd] = useState('');
  const [blackoutReason, setBlackoutReason] = useState('');

  const [rejecting, setRejecting] = useState<Booking | null>(null);

  const facilities = useQuery({
    queryKey: ['estate', estateId, 'facilities'],
    queryFn: () =>
      unwrap(api.GET('/v1/estates/{estateId}/facilities', { params: { path: { estateId } } })),
  });

  const bookings = useQuery({
    queryKey: ['estate', estateId, 'bookings'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/bookings', {
          params: { path: { estateId }, query: { mine: 'false' } },
        }),
      ),
  });

  const createFacility = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/facilities', {
          params: { path: { estateId } },
          body: {
            name: facName.trim(),
            type: facType,
            capacity: facCapacity ? Number.parseInt(facCapacity, 10) : undefined,
            rules: facRules.trim() || undefined,
            photoFileIds: [],
            openingHours: [],
            policy: {
              requiresApproval: true,
              maxMinutes: 240,
              advanceDays: 30,
            },
            pricing: { basis: 'free' },
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'facilities'] });
      setCreating(false);
      setFacName('');
      setFacCapacity('');
      setFacRules('');
    },
  });

  const addBlackout = useMutation({
    mutationFn: () => {
      if (!blackoutTarget) throw new Error(t('mw.facilities.errNoFacilitySelected'));
      return unwrap(
        api.POST('/v1/estates/{estateId}/facilities/{id}/blackouts', {
          params: { path: { estateId, id: blackoutTarget.id } },
          body: {
            startsAt: new Date(`${blackoutStart}T00:00:00.000+01:00`).toISOString(),
            endsAt: new Date(`${blackoutEnd}T23:59:59.000+01:00`).toISOString(),
            reason: blackoutReason.trim(),
          },
        }),
      );
    },
    onSuccess: () => {
      setBlackoutTarget(null);
      setBlackoutReason('');
    },
  });

  const bookingAction = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'approve' | 'reject' | 'check-in' | 'no-show';
      reason?: string;
    }) => {
      if (action === 'approve') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/bookings/{id}/approve', {
            params: { path: { estateId, id } },
          }),
        );
      }
      if (action === 'reject') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/bookings/{id}/reject', {
            params: { path: { estateId, id } },
            body: { reason: reason ?? '' },
          }),
        );
      }
      if (action === 'check-in') {
        return unwrap(
          api.POST('/v1/estates/{estateId}/bookings/{id}/check-in', {
            params: { path: { estateId, id } },
          }),
        );
      }
      return unwrap(
        api.POST('/v1/estates/{estateId}/bookings/{id}/no-show', {
          params: { path: { estateId, id } },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'bookings'] });
      setRejecting(null);
    },
  });

  const facCols: Column<Facility>[] = [
    { key: 'name', header: t('mw.facilities.facility'), render: (r) => r.name },
    { key: 'type', header: t('mw.facilities.type'), render: (r) => r.type.replace(/_/g, ' ') },
    {
      key: 'cap',
      header: t('mw.facilities.capacity'),
      align: 'right',
      render: (r) => (r.capacity ? <span className="sz-num">{r.capacity}</span> : '-'),
    },
    {
      key: 'status',
      header: t('mw.facilities.status'),
      render: (r) => (
        <StatusPill tone={r.status === 'active' ? 'success' : 'neutral'} label={r.status} />
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (r: Facility) => (
              <ActionButton
                variant="outline"
                size="sm"
                onClick={() => {
                  addBlackout.reset();
                  setBlackoutTarget(r);
                }}
              >
                {t('facilities.addBlackout')}
              </ActionButton>
            ),
          },
        ]
      : []),
  ];

  const bookCols: Column<Booking>[] = [
    { key: 'fac', header: t('mw.facilities.facility'), render: (r) => r.facilityName },
    {
      key: 'when',
      header: t('mw.facilities.window'),
      render: (r) => (
        <span className="sz-num">
          {formatDateTime(r.startsAt)} - {formatDateTime(r.endsAt)}
        </span>
      ),
    },
    { key: 'purpose', header: t('mw.facilities.purpose'), render: (r) => r.purpose ?? '-' },
    {
      key: 'status',
      header: t('mw.facilities.status'),
      render: (r) => (
        <StatusPill
          tone={BOOKING_TONE[r.status] ?? 'neutral'}
          label={r.status.replace(/_/g, ' ')}
        />
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (r: Booking) => (
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {r.status === 'pending_approval' ? (
                  <>
                    <ActionButton
                      size="sm"
                      busy={bookingAction.isPending}
                      onClick={() => bookingAction.mutate({ id: r.id, action: 'approve' })}
                    >
                      {t('mw.facilities.approve')}
                    </ActionButton>
                    <ActionButton
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        bookingAction.reset();
                        setRejecting(r);
                      }}
                    >
                      {t('mw.facilities.reject')}
                    </ActionButton>
                  </>
                ) : null}
                {r.status === 'confirmed' ? (
                  <>
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      busy={bookingAction.isPending}
                      onClick={() => bookingAction.mutate({ id: r.id, action: 'check-in' })}
                    >
                      {t('mw.facilities.checkIn')}
                    </ActionButton>
                    <ActionButton
                      variant="outline"
                      size="sm"
                      busy={bookingAction.isPending}
                      onClick={() => bookingAction.mutate({ id: r.id, action: 'no-show' })}
                    >
                      {t('mw.facilities.noShow')}
                    </ActionButton>
                  </>
                ) : null}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={t('facilities.title')}
        description={t('facilities.description')}
        actions={
          canManage ? (
            <ActionButton
              icon="plus"
              onClick={() => {
                createFacility.reset();
                setCreating(true);
              }}
            >
              {t('facilities.create')}
            </ActionButton>
          ) : null
        }
      />

      <Tabs<TabId>
        label={t('facilities.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'facilities', label: t('facilities.tab.facilities') },
          { key: 'bookings', label: t('facilities.tab.bookings') },
        ]}
      />

      {tab === 'facilities' ? (
        <DataTable
          caption={t('facilities.tab.facilities')}
          columns={facCols}
          rows={facilities.data ?? []}
          rowKey={(r) => r.id}
          loading={facilities.isPending}
          error={facilities.isError ? errorText(facilities.error) : null}
          onRetry={() => void facilities.refetch()}
          empty={{
            icon: 'calendar',
            title: t('facilities.tab.facilities'),
            body: t('facilities.emptyFacilities'),
          }}
        />
      ) : (
        <DataTable
          caption={t('facilities.tab.bookings')}
          columns={bookCols}
          rows={bookings.data ?? []}
          rowKey={(r) => r.id}
          loading={bookings.isPending}
          error={bookings.isError ? errorText(bookings.error) : null}
          onRetry={() => void bookings.refetch()}
          empty={{
            icon: 'calendar',
            title: t('facilities.tab.bookings'),
            body: t('facilities.emptyBookings'),
          }}
        />
      )}

      {creating ? (
        <Dialog
          title={t('facilities.create')}
          onClose={() => setCreating(false)}
          onSubmit={() => createFacility.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!facName.trim()}
                busy={createFacility.isPending}
              >
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={createFacility.isError ? errorText(createFacility.error) : null} />
          <div className="sz-form">
            <InputField
              label={t('mw.facilities.name')}
              required
              value={facName}
              onChange={setFacName}
            />
            <div className="sz-form-2">
              <SelectField
                label={t('mw.facilities.type')}
                value={facType}
                onChange={setFacType}
                options={[
                  { value: 'event_hall', label: t('mw.facilities.eventHall') },
                  { value: 'pool', label: t('mw.facilities.swimmingPool') },
                  { value: 'gym', label: t('mw.facilities.gym') },
                  { value: 'court', label: t('mw.facilities.sportsCourt') },
                  { value: 'guest_house', label: t('mw.facilities.guestHouse') },
                  { value: 'parking', label: t('mw.facilities.parking') },
                  { value: 'other', label: t('mw.facilities.other') },
                ]}
              />
              <InputField
                label={t('mw.facilities.capacityOptional')}
                type="number"
                value={facCapacity}
                onChange={setFacCapacity}
              />
            </div>
            <TextAreaField
              label={t('mw.facilities.rulesOptional')}
              rows={3}
              value={facRules}
              onChange={setFacRules}
            />
          </div>
        </Dialog>
      ) : null}

      {blackoutTarget ? (
        <Dialog
          title={`${t('facilities.addBlackout')} (${blackoutTarget.name})`}
          onClose={() => setBlackoutTarget(null)}
          onSubmit={() => addBlackout.mutate()}
          actions={
            <>
              <ActionButton variant="outline" type="button" onClick={() => setBlackoutTarget(null)}>
                {t('common.cancel')}
              </ActionButton>
              <ActionButton
                type="submit"
                disabled={!blackoutStart || !blackoutEnd || !blackoutReason.trim()}
                busy={addBlackout.isPending}
              >
                {t('common.save')}
              </ActionButton>
            </>
          }
        >
          <FormError message={addBlackout.isError ? errorText(addBlackout.error) : null} />
          <div className="sz-form">
            <div className="sz-form-2">
              <InputField
                label={t('mw.facilities.startDate')}
                type="date"
                required
                value={blackoutStart}
                onChange={setBlackoutStart}
              />
              <InputField
                label={t('mw.facilities.endDate')}
                type="date"
                required
                value={blackoutEnd}
                onChange={setBlackoutEnd}
              />
            </div>
            <InputField
              label={t('mw.facilities.reason')}
              required
              value={blackoutReason}
              onChange={setBlackoutReason}
            />
          </div>
        </Dialog>
      ) : null}

      {rejecting ? (
        <ConfirmDialog
          title={t('mw.facilities.rejectBooking')}
          body={t('mw.facilities.rejectThisFacilityBookingRequest')}
          confirmLabel={t('mw.facilities.reject')}
          destructive
          reason={{ label: t('mw.facilities.reason'), required: true }}
          busy={bookingAction.isPending}
          error={bookingAction.isError ? errorText(bookingAction.error) : null}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) =>
            bookingAction.mutate({ id: rejecting.id, action: 'reject', reason: reason ?? '' })
          }
        />
      ) : null}
    </>
  );
}

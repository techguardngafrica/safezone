'use client';

import { unwrap } from '@safezone/api-client';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import { estateApplicationSchema } from '@safezone/schemas';
import {
  AccountBar,
  ActionButton,
  Banner,
  CheckboxField,
  ConfirmDialog,
  ErrorState,
  FormError,
  InputField,
  Panel,
  SelectField,
  SessionGate,
  Skeleton,
  StatusPill,
  TextAreaField,
  type Tone,
} from '@safezone/web-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, useState } from 'react';
import { errorText } from '../../lib/errors';
import { api, session } from '../../lib/session';
import { site } from '../site';

const ROLES = ['owner', 'developer', 'manager', 'residents_association_officer'] as const;
type RepRole = (typeof ROLES)[number];

const ESTATE_TYPES = ['gated_houses', 'apartment_complex', 'mixed'] as const;
type EstateType = (typeof ESTATE_TYPES)[number];

const NIGERIAN_STATES = [
  'Abia',
  'Adamawa',
  'Akwa Ibom',
  'Anambra',
  'Bauchi',
  'Bayelsa',
  'Benue',
  'Borno',
  'Cross River',
  'Delta',
  'Ebonyi',
  'Edo',
  'Ekiti',
  'Enugu',
  'FCT (Abuja)',
  'Gombe',
  'Imo',
  'Jigawa',
  'Kaduna',
  'Kano',
  'Katsina',
  'Kebbi',
  'Kogi',
  'Kwara',
  'Lagos',
  'Nasarawa',
  'Niger',
  'Ogun',
  'Ondo',
  'Osun',
  'Oyo',
  'Plateau',
  'Rivers',
  'Sokoto',
  'Taraba',
  'Yobe',
  'Zamfara',
] as const;

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'] as const);
type AllowedMime = 'application/pdf' | 'image/jpeg' | 'image/png';
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const MAX_DOCS = 10;
const MANAGEMENT_URL = process.env.NEXT_PUBLIC_MANAGEMENT_URL ?? '/download';

interface UploadedDoc {
  fileId: string;
  name: string;
  sizeBytes: number;
  status: string;
}

const STATUS_TONE: Record<string, Tone> = {
  submitted: 'info',
  under_review: 'info',
  info_requested: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
};

const OPEN_STATUSES = new Set(['submitted', 'under_review', 'info_requested']);

async function uploadApplicationFile(file: File): Promise<UploadedDoc> {
  if (!ALLOWED_MIME_TYPES.has(file.type as AllowedMime)) {
    throw new Error(t('public.register.docs.badType'));
  }
  if (file.size <= 0 || file.size > MAX_DOC_BYTES) {
    throw new Error(t('public.register.docs.tooLarge'));
  }
  const ticket = await unwrap(
    api.POST('/v1/me/files/upload-url', {
      body: {
        purpose: 'estate_application',
        mimeType: file.type as AllowedMime,
        sizeBytes: file.size,
      },
    }),
  );
  const putRes = await fetch(ticket.uploadUrl, {
    method: ticket.method,
    headers: ticket.headers,
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(t('common.error'));
  }
  const completed = await unwrap(
    api.POST('/v1/me/files/{id}/complete', { params: { path: { id: ticket.fileId } } }),
  );
  return {
    fileId: completed.id,
    name: file.name,
    sizeBytes: completed.sizeBytes,
    status: completed.status,
  };
}

function DocumentUploader({
  docs,
  onAdd,
  onRemove,
  maxTotal = MAX_DOCS,
}: {
  docs: UploadedDoc[];
  onAdd: (doc: UploadedDoc) => void;
  onRemove: (fileId: string) => void;
  maxTotal?: number;
}) {
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const remaining = maxTotal - docs.length;
    if (remaining <= 0) {
      setUploadError(t('public.register.docs.maxReached'));
      return;
    }
    const selected = Array.from(fileList).slice(0, remaining);
    setUploading(true);
    try {
      for (const file of selected) {
        const uploaded = await uploadApplicationFile(file);
        onAdd(uploaded);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : errorText(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="sz-muted" style={{ margin: 0 }}>
        {t('public.register.docs.help')}
      </p>
      <div>
        <label
          htmlFor={inputId}
          className="sz-btn sz-btn-outline"
          style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
        >
          {uploading ? t('public.register.docs.uploading') : t('public.register.docs.upload')}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          multiple
          disabled={uploading || docs.length >= maxTotal}
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
          }}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      <FormError message={uploadError} />
      {docs.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {docs.map((doc) => (
            <li
              key={doc.fileId}
              className="sz-card"
              style={{
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{doc.name}</div>
                <div className="sz-muted" style={{ fontSize: 13 }}>
                  {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB ·{' '}
                  {t(`public.register.docs.status.${doc.status}` as MessageKey)}
                </div>
              </div>
              <ActionButton variant="outline" size="sm" onClick={() => onRemove(doc.fileId)}>
                {t('public.register.docs.remove')}
              </ActionButton>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ResubmitBox({
  applicationId,
  existingDocCount,
  onDone,
}: {
  applicationId: string;
  existingDocCount: number;
  onDone: () => void;
}) {
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [note, setNote] = useState('');
  const resubmit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/me/estate-applications/{id}/resubmit', {
          params: { path: { id: applicationId } },
          body: {
            documentFileIds: docs.map((d) => d.fileId),
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        }),
      ),
    onSuccess: () => {
      setDocs([]);
      setNote('');
      onDone();
    },
  });

  return (
    <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>{t('public.register.apps.resubmitTitle')}</h3>
      <DocumentUploader
        docs={docs}
        maxTotal={Math.max(0, MAX_DOCS - existingDocCount)}
        onAdd={(doc) => setDocs((prev) => [...prev, doc])}
        onRemove={(fileId) => setDocs((prev) => prev.filter((d) => d.fileId !== fileId))}
      />
      <TextAreaField
        label={t('public.register.apps.resubmitNote')}
        value={note}
        onChange={setNote}
        rows={3}
        maxLength={2000}
      />
      <FormError message={resubmit.isError ? errorText(resubmit.error) : null} />
      <div>
        <ActionButton
          busy={resubmit.isPending}
          disabled={docs.length === 0 && note.trim().length === 0}
          onClick={() => resubmit.mutate()}
        >
          {t('public.register.apps.resubmitAction')}
        </ActionButton>
      </div>
    </div>
  );
}

function RegistrationWizard({ onSubmitted }: { onSubmitted: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RepRole>('manager');

  const [estateName, setEstateName] = useState('');
  const [estateType, setEstateType] = useState<EstateType>('gated_houses');
  const [address, setAddress] = useState('');
  const [stateName, setStateName] = useState<string>('Lagos');
  const [lga, setLga] = useState('');
  const [unitsEstimate, setUnitsEstimate] = useState('');
  const [gatesEstimate, setGatesEstimate] = useState('1');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locError, setLocError] = useState<string | null>(null);

  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const steps: MessageKey[] = [
    'public.register.step.representative',
    'public.register.step.estate',
    'public.register.step.documents',
    'public.register.step.review',
  ];

  const submit = useMutation({
    mutationFn: () => {
      const parsedLat = lat.trim() ? Number(lat) : undefined;
      const parsedLng = lng.trim() ? Number(lng) : undefined;
      const payload = {
        representative: {
          fullName: fullName.trim(),
          email: email.trim(),
          role,
        },
        estate: {
          name: estateName.trim(),
          type: estateType,
          address: address.trim(),
          state: stateName.trim(),
          lga: lga.trim(),
          ...(parsedLat !== undefined &&
          parsedLng !== undefined &&
          Number.isFinite(parsedLat) &&
          Number.isFinite(parsedLng)
            ? { location: { lat: parsedLat, lng: parsedLng } }
            : {}),
          unitsEstimate: Number(unitsEstimate),
          gatesEstimate: Number(gatesEstimate),
        },
        documentFileIds: docs.map((d) => d.fileId),
        acceptedTerms: true as const,
      };
      const check = estateApplicationSchema.safeParse(payload);
      if (!check.success) {
        throw new Error(check.error.issues[0]?.message ?? t('public.register.validation.estate'));
      }
      return unwrap(api.POST('/v1/me/estate-applications', { body: check.data }));
    },
    onSuccess: () => onSubmitted(),
  });

  function validateStep(current: 0 | 1 | 2 | 3): boolean {
    setStepError(null);
    if (current === 0) {
      if (fullName.trim().length < 2 || !/\S+@\S+\.\S+/.test(email.trim())) {
        setStepError(t('public.register.validation.rep'));
        return false;
      }
      return true;
    }
    if (current === 1) {
      const units = Number(unitsEstimate);
      const gates = Number(gatesEstimate);
      if (
        estateName.trim().length < 2 ||
        address.trim().length < 5 ||
        stateName.trim().length < 2 ||
        lga.trim().length < 2 ||
        !Number.isInteger(units) ||
        units <= 0 ||
        !Number.isInteger(gates) ||
        gates <= 0
      ) {
        setStepError(t('public.register.validation.estate'));
        return false;
      }
      return true;
    }
    if (current === 2) {
      if (docs.length === 0) {
        setStepError(t('public.register.docs.required'));
        return false;
      }
      return true;
    }
    if (!acceptedTerms) {
      setStepError(t('public.register.validation.consent'));
      return false;
    }
    return true;
  }

  function handleUseLocation() {
    setLocError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocError(t('public.register.estate.locationError'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      () => setLocError(t('public.register.estate.locationError')),
      { timeout: 10_000 },
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <nav aria-label={t('public.register.stepLabel', { current: step + 1, total: steps.length })}>
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          {steps.map((labelKey, index) => {
            const active = index === step;
            const done = index < step;
            return (
              <li
                key={labelKey}
                aria-current={active ? 'step' : undefined}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: active ? 700 : 500,
                  border: '1px solid var(--sz-border, #d0d7de)',
                  opacity: active || done ? 1 : 0.65,
                }}
              >
                {index + 1}. {t(labelKey)}
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 0 ? (
        <Panel title={t('public.register.rep.title')}>
          <div className="sz-form">
            <InputField
              label={t('public.register.rep.fullName')}
              value={fullName}
              onChange={setFullName}
              maxLength={120}
              required
            />
            <InputField
              label={t('public.register.rep.email')}
              type="email"
              value={email}
              onChange={setEmail}
              maxLength={200}
              required
            />
            <SelectField
              label={t('public.register.rep.role')}
              value={role}
              onChange={setRole}
              options={ROLES.map((value) => ({
                value,
                label: t(`public.register.role.${value}` as MessageKey),
              }))}
            />
            <FormError message={stepError} />
            <div style={{ display: 'flex', gap: 12 }}>
              <ActionButton
                onClick={() => {
                  if (validateStep(0)) setStep(1);
                }}
              >
                {t('public.register.next')}
              </ActionButton>
            </div>
          </div>
        </Panel>
      ) : null}

      {step === 1 ? (
        <Panel title={t('public.register.estate.title')}>
          <div className="sz-form">
            <InputField
              label={t('public.register.estate.name')}
              value={estateName}
              onChange={setEstateName}
              maxLength={160}
              required
            />
            <SelectField
              label={t('public.register.estate.type')}
              value={estateType}
              onChange={setEstateType}
              options={ESTATE_TYPES.map((value) => ({
                value,
                label: t(`public.register.estateType.${value}` as MessageKey),
              }))}
            />
            <InputField
              label={t('public.register.estate.address')}
              value={address}
              onChange={setAddress}
              maxLength={300}
              required
            />
            <SelectField
              label={t('public.register.estate.state')}
              value={stateName}
              onChange={setStateName}
              options={NIGERIAN_STATES.map((s) => ({ value: s, label: s }))}
            />
            <InputField
              label={t('public.register.estate.lga')}
              value={lga}
              onChange={setLga}
              maxLength={80}
              required
            />
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              }}
            >
              <InputField
                label={t('public.register.estate.units')}
                type="number"
                value={unitsEstimate}
                onChange={setUnitsEstimate}
                min={1}
                max={100000}
                required
              />
              <InputField
                label={t('public.register.estate.gates')}
                type="number"
                value={gatesEstimate}
                onChange={setGatesEstimate}
                min={1}
                max={100}
                required
              />
            </div>
            <fieldset className="sz-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: 4 }}>
                {t('public.register.estate.pinTitle')}
              </legend>
              <p className="sz-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
                {t('public.register.estate.pinHelp')}
              </p>
              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                }}
              >
                <InputField
                  label={t('public.register.estate.lat')}
                  inputMode="decimal"
                  value={lat}
                  onChange={setLat}
                />
                <InputField
                  label={t('public.register.estate.lng')}
                  inputMode="decimal"
                  value={lng}
                  onChange={setLng}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <ActionButton variant="outline" size="sm" onClick={handleUseLocation}>
                  {t('public.register.estate.useLocation')}
                </ActionButton>
              </div>
              <FormError message={locError} />
            </fieldset>
            <FormError message={stepError} />
            <div style={{ display: 'flex', gap: 12 }}>
              <ActionButton
                variant="outline"
                onClick={() => {
                  setStepError(null);
                  setStep(0);
                }}
              >
                {t('public.register.back')}
              </ActionButton>
              <ActionButton
                onClick={() => {
                  if (validateStep(1)) setStep(2);
                }}
              >
                {t('public.register.next')}
              </ActionButton>
            </div>
          </div>
        </Panel>
      ) : null}

      {step === 2 ? (
        <Panel title={t('public.register.docs.title')}>
          <div className="sz-form">
            <DocumentUploader
              docs={docs}
              onAdd={(doc) => {
                setStepError(null);
                setDocs((prev) => [...prev, doc]);
              }}
              onRemove={(fileId) => setDocs((prev) => prev.filter((d) => d.fileId !== fileId))}
            />
            <FormError message={stepError} />
            <div style={{ display: 'flex', gap: 12 }}>
              <ActionButton
                variant="outline"
                onClick={() => {
                  setStepError(null);
                  setStep(1);
                }}
              >
                {t('public.register.back')}
              </ActionButton>
              <ActionButton
                onClick={() => {
                  if (validateStep(2)) setStep(3);
                }}
              >
                {t('public.register.next')}
              </ActionButton>
            </div>
          </div>
        </Panel>
      ) : null}

      {step === 3 ? (
        <Panel title={t('public.register.review.title')}>
          <div className="sz-form">
            <Banner tone="info">{t('public.register.review.freeNote')}</Banner>
            <dl style={{ display: 'grid', gap: 8, margin: 0 }}>
              <div>
                <dt className="sz-muted" style={{ fontSize: 13 }}>
                  {t('public.register.step.representative')}
                </dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>
                  {fullName} ({t(`public.register.role.${role}` as MessageKey)}) · {email}
                </dd>
              </div>
              <div>
                <dt className="sz-muted" style={{ fontSize: 13 }}>
                  {t('public.register.step.estate')}
                </dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>
                  {estateName} ({t(`public.register.estateType.${estateType}` as MessageKey)})
                </dd>
                <dd className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
                  {address}, {lga}, {stateName} · {unitsEstimate} units · {gatesEstimate} gates
                </dd>
              </div>
              <div>
                <dt className="sz-muted" style={{ fontSize: 13 }}>
                  {t('public.register.step.documents')}
                </dt>
                <dd style={{ margin: 0 }}>{docs.map((d) => d.name).join(', ')}</dd>
              </div>
            </dl>
            <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
              {t('public.register.review.dpa')}
            </p>
            <CheckboxField
              label={
                <>
                  {t('public.register.review.consent')}{' '}
                  <Link href="/legal/terms">{t('public.legal.terms')}</Link> &{' '}
                  <Link href="/legal/privacy">{t('public.legal.privacy')}</Link>.
                </>
              }
              checked={acceptedTerms}
              onChange={setAcceptedTerms}
            />
            <FormError message={stepError ?? (submit.isError ? errorText(submit.error) : null)} />
            <div style={{ display: 'flex', gap: 12 }}>
              <ActionButton
                variant="outline"
                onClick={() => {
                  setStepError(null);
                  setStep(2);
                }}
              >
                {t('public.register.back')}
              </ActionButton>
              <ActionButton
                busy={submit.isPending}
                onClick={() => {
                  if (validateStep(3)) submit.mutate();
                }}
              >
                {t('public.register.review.submit')}
              </ActionButton>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function SignedInRegister() {
  const qc = useQueryClient();
  const [creatingNew, setCreatingNew] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<{ id: string; name: string } | null>(null);

  const apps = useQuery({
    queryKey: ['me', 'estate-applications'],
    queryFn: () => unwrap(api.GET('/v1/me/estate-applications')),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST('/v1/me/estate-applications/{id}/withdraw', { params: { path: { id } } })),
    onSuccess: () => {
      setWithdrawTarget(null);
      void qc.invalidateQueries({ queryKey: ['me', 'estate-applications'] });
    },
  });

  if (apps.isPending) {
    return (
      <div style={{ display: 'grid', gap: 12 }} role="status" aria-label={t('common.loading')}>
        <Skeleton height={48} />
        <Skeleton height={160} />
      </div>
    );
  }
  if (apps.isError) {
    return <ErrorState message={errorText(apps.error)} onRetry={() => void apps.refetch()} />;
  }

  const list = apps.data;
  const openCount = list.filter((a) => OPEN_STATUSES.has(a.status)).length;
  const showWizard = list.length === 0 || creatingNew;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <AccountBar controller={session} />
      {showWizard ? (
        <RegistrationWizard
          onSubmitted={() => {
            setCreatingNew(false);
            void qc.invalidateQueries({ queryKey: ['me', 'estate-applications'] });
          }}
        />
      ) : (
        <Panel
          title={t('public.register.apps.title')}
          actions={
            openCount < 3 ? (
              <ActionButton variant="outline" size="sm" onClick={() => setCreatingNew(true)}>
                {t('public.register.apps.new')}
              </ActionButton>
            ) : null
          }
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <Banner tone="info">{t('public.register.apps.reviewTime')}</Banner>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
              {list.map((app) => (
                <li
                  key={app.id}
                  className="sz-card"
                  style={{ padding: 16, display: 'grid', gap: 8 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong>{app.estate.name}</strong>
                    <StatusPill
                      tone={STATUS_TONE[app.status] ?? 'neutral'}
                      label={t(`public.register.apps.status.${app.status}` as MessageKey)}
                    />
                  </div>
                  <div className="sz-muted" style={{ fontSize: 14 }}>
                    {app.estate.address}, {app.estate.lga}, {app.estate.state} ·{' '}
                    {t('public.register.apps.submittedOn', { date: formatDate(app.submittedAt) })}
                  </div>
                  {app.decisionReason ? (
                    <Banner tone={app.status === 'rejected' ? 'danger' : 'warning'}>
                      {t('public.register.apps.reason', { reason: app.decisionReason })}
                    </Banner>
                  ) : null}
                  {app.status === 'approved' ? (
                    <div>
                      <a
                        href={MANAGEMENT_URL}
                        className="sz-btn sz-btn-primary"
                        style={{ display: 'inline-flex', textDecoration: 'none' }}
                      >
                        {t('public.register.apps.openSetup')}
                      </a>
                    </div>
                  ) : null}
                  {app.status === 'info_requested' ? (
                    <ResubmitBox
                      applicationId={app.id}
                      existingDocCount={app.documents.length}
                      onDone={() =>
                        void qc.invalidateQueries({ queryKey: ['me', 'estate-applications'] })
                      }
                    />
                  ) : null}
                  {OPEN_STATUSES.has(app.status) ? (
                    <div style={{ marginTop: 4 }}>
                      <ActionButton
                        variant="outline"
                        size="sm"
                        onClick={() => setWithdrawTarget({ id: app.id, name: app.estate.name })}
                      >
                        {t('public.register.apps.withdraw')}
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="sz-muted" style={{ margin: 0, fontSize: 14 }}>
              {t('public.register.apps.contactHelp', { email: site.contact.support })}{' '}
              <Link href="/contact">{t('public.register.apps.contactLink')}</Link>.
            </p>
          </div>
        </Panel>
      )}
      {withdrawTarget ? (
        <ConfirmDialog
          title={t('public.register.apps.withdrawTitle', { name: withdrawTarget.name })}
          body={t('public.register.apps.withdrawBody')}
          confirmLabel={t('public.register.apps.withdrawConfirm')}
          destructive
          busy={withdraw.isPending}
          error={withdraw.isError ? errorText(withdraw.error) : null}
          onConfirm={() => withdraw.mutate(withdrawTarget.id)}
          onClose={() => setWithdrawTarget(null)}
        />
      ) : null}
    </div>
  );
}

/** Self-service estate registration flow (public-web.md §5). Onboarding is free. */
export function RegisterFlow() {
  return (
    <SessionGate
      controller={session}
      title={t('public.register.title')}
      intro={t('public.register.signInIntro')}
    >
      <SignedInRegister />
    </SessionGate>
  );
}

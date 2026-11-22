import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { formatDate, type MessageKey, t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  CheckboxRow,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  SectionHeader,
  StatusPill,
  TextField,
  useSession,
} from '@safezone/mobile-ui';
import { AD_CATEGORIES, type AdCategory } from '@safezone/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import { marketStyles, Muted, Row } from '../../src/features/market-text';
import { errorText } from '../../src/lib/errors';
import { api, session } from '../../src/lib/session';

const BUDGETS = ['under_100k', '100k_500k', '500k_2m', '2m_10m', 'over_10m', 'not_sure'] as const;
type Budget = (typeof BUDGETS)[number];
const CATEGORIES = AD_CATEGORIES.filter((c) => c !== 'tobacco');

/** Advertising enquiry from the Resident App (advertising.md §2.1) and the status of earlier ones. */
export default function AdvertiseScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useSession(session).user;
  const [type, setType] = useState<'individual' | 'organisation'>('individual');
  const [contactName, setContactName] = useState(user?.fullName ?? '');
  const [orgName, setOrgName] = useState('');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<AdCategory | null>(null);
  const [objectives, setObjectives] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState<Budget>('not_sure');
  const [consent, setConsent] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const mine = useQuery({
    queryKey: ['me', 'ad-enquiries'],
    queryFn: () => unwrap(api.GET('/v1/me/ad-enquiries')),
  });
  const send = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/me/ad-enquiries', {
          body: {
            advertiserType: type,
            contactName: contactName.trim(),
            ...(type === 'organisation' && orgName.trim() ? { orgName: orgName.trim() } : {}),
            phone: phone.trim(),
            email: email.trim(),
            category: category ?? 'other',
            objectives: objectives.trim(),
            description: description.trim(),
            budgetRange: budget,
            placements: [],
            consent: true,
          },
        }),
      ),
    onSuccess: () => {
      setObjectives('');
      setDescription('');
      setConsent(false);
      void qc.invalidateQueries({ queryKey: ['me', 'ad-enquiries'] });
    },
  });
  const valid =
    contactName.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    /\S+@\S+\.\S+/.test(email) &&
    category !== null &&
    objectives.trim().length >= 3 &&
    description.trim().length >= 10 &&
    consent;

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={t('public.advertise.form.submit')}
          busy={send.isPending}
          onPress={() => {
            setInvalid(!valid);
            if (valid) send.mutate();
          }}
        />
      }
    >
      <ScreenHeader
        title={t('res.advertise.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Banner tone="info">{t('res.advertise.intro')}</Banner>
      {mine.data && mine.data.length > 0 ? (
        <>
          <SectionHeader title={t('res.advertise.mine')} />
          {mine.data.map((enquiry) => (
            <Card key={enquiry.id}>
              <Row>
                <Text style={marketStyles.title}>{enquiry.objectives}</Text>
                <StatusPill
                  tone={
                    enquiry.status === 'rejected'
                      ? 'neutral'
                      : enquiry.status === 'converted_to_campaign'
                        ? 'success'
                        : 'info'
                  }
                  label={t(`res.advertise.status.${enquiry.status}` as MessageKey)}
                />
              </Row>
              <Muted>{formatDate(enquiry.createdAt)}</Muted>
            </Card>
          ))}
        </>
      ) : null}
      <SectionHeader title={t('res.advertise.new')} />
      {send.isSuccess ? <Banner tone="success">{t('res.advertise.sent')}</Banner> : null}
      <ChipGroup
        label={t('public.advertise.form.who')}
        value={type}
        onChange={setType}
        options={[
          { key: 'individual', label: t('public.advertise.form.individual') },
          { key: 'organisation', label: t('public.advertise.form.organisation') },
        ]}
      />
      <TextField
        label={t('public.advertise.form.name')}
        value={contactName}
        onChangeText={setContactName}
        maxLength={120}
      />
      {type === 'organisation' ? (
        <TextField
          label={t('public.advertise.form.org')}
          value={orgName}
          onChangeText={setOrgName}
          maxLength={160}
        />
      ) : null}
      <TextField
        label={t('public.advertise.form.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={20}
      />
      <TextField
        label={t('public.advertise.form.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        maxLength={200}
      />
      <ChipGroup
        label={t('public.advertise.form.category')}
        value={category}
        onChange={setCategory}
        options={CATEGORIES.map((key) => ({ key, label: t(`ads.category.${key}` as MessageKey) }))}
      />
      <TextField
        label={t('public.advertise.form.objectives')}
        value={objectives}
        onChangeText={setObjectives}
        maxLength={500}
      />
      <TextField
        label={t('public.advertise.form.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
      />
      <ChipGroup
        label={t('public.advertise.form.budget')}
        value={budget}
        onChange={setBudget}
        options={BUDGETS.map((key) => ({
          key,
          label: t(`public.advertise.budget.${key}` as MessageKey),
        }))}
      />
      <CheckboxRow
        label={t('public.advertise.form.consent')}
        checked={consent}
        onChange={setConsent}
      />
      {invalid ? (
        <Text style={{ color: colors.status.danger }}>{t('public.advertise.form.required')}</Text>
      ) : null}
      {send.isError ? <Banner tone="danger">{errorText(send.error)}</Banner> : null}
    </ScrollScreen>
  );
}

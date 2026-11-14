import { type ApiRow, unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  CheckboxRow,
  ConfirmModal,
  EmptyState,
  ErrorState,
  ListRow,
  ScreenHeader,
  ScrollScreen,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { normalizeNigerianPhone } from '@safezone/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { Icon } from '../src/components/icon';
import { errorText } from '../src/lib/errors';
import { api } from '../src/lib/session';

type Contact = ApiRow<'/v1/me/emergency-contacts', 'get'>;

/** People called during an SOS (never during a drill). They must have agreed to be listed. */
export default function EmergencyContactsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [consent, setConsent] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);

  const contacts = useQuery({
    queryKey: ['me', 'emergency-contacts'],
    queryFn: () => unwrap(api.GET('/v1/me/emergency-contacts')),
  });
  const add = useMutation({
    mutationFn: (e164: string) =>
      unwrap(
        api.POST('/v1/me/emergency-contacts', {
          body: {
            name: name.trim(),
            phone: e164,
            relationship: relationship.trim(),
            consentConfirmed: true,
          },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'emergency-contacts'] });
      setAdding(false);
      setName('');
      setPhone('');
      setRelationship('');
      setConsent(false);
    },
  });
  const remove = useMutation({
    mutationFn: (contact: Contact) =>
      unwrap(
        api.DELETE('/v1/me/emergency-contacts/{id}', { params: { path: { id: contact.id } } }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['me', 'emergency-contacts'] });
      setRemoving(null);
    },
  });

  const submit = () => {
    const e164 = normalizeNigerianPhone(phone);
    if (!e164) return setPhoneError(t('auth.phone.invalid'));
    setPhoneError(null);
    add.mutate(e164);
  };

  return (
    <ScrollScreen edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        title={t('res.contacts.title')}
        subtitle={t('res.contacts.subtitle')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      {contacts.isPending ? <Skeleton height={96} /> : null}
      {contacts.isError ? (
        <ErrorState message={errorText(contacts.error)} onRetry={() => void contacts.refetch()} />
      ) : null}
      {contacts.data && contacts.data.length === 0 && !adding ? (
        <EmptyState
          icon={<Icon name="call-outline" size={28} color={colors.brand.primary} />}
          title={t('res.contacts.empty')}
          body={t('res.contacts.emptyBody')}
        />
      ) : null}
      {contacts.data && contacts.data.length > 0 ? (
        <Card>
          {contacts.data.map((contact) => (
            <ListRow
              key={contact.id}
              title={contact.name}
              subtitle={`${contact.relationship} · ${contact.phone}`}
              leading={<Icon name="person-outline" color={colors.brand.primary} size={20} />}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('res.contacts.remove', { name: contact.name })}
                  onPress={() => setRemoving(contact)}
                  style={{
                    minWidth: 48,
                    minHeight: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="trash-outline" color={colors.semantic.textMuted} size={20} />
                </Pressable>
              }
            />
          ))}
        </Card>
      ) : null}
      {adding ? (
        <Card>
          <TextField
            label={t('res.contacts.name')}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            maxLength={120}
          />
          <TextField
            label={t('auth.phone.label')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder={t('auth.phone.placeholder')}
            error={phoneError}
            maxLength={20}
          />
          <TextField
            label={t('res.contacts.relationship')}
            placeholder={t('res.contacts.relationshipPlaceholder')}
            value={relationship}
            onChangeText={setRelationship}
            maxLength={40}
          />
          <CheckboxRow label={t('res.contacts.consent')} checked={consent} onChange={setConsent} />
          {add.isError ? <Banner tone="danger">{errorText(add.error)}</Banner> : null}
          <ActionButton
            label={t('res.contacts.save')}
            onPress={submit}
            busy={add.isPending}
            disabled={!consent || name.trim().length < 2 || relationship.trim().length < 2}
          />
          <ActionButton
            label={t('common.cancel')}
            variant="text"
            onPress={() => setAdding(false)}
          />
        </Card>
      ) : (
        <ActionButton
          label={t('res.contacts.add')}
          variant="outline"
          onPress={() => setAdding(true)}
        />
      )}
      <ConfirmModal
        visible={Boolean(removing)}
        title={t('res.contacts.removeTitle', { name: removing?.name ?? '' })}
        body={t('res.contacts.removeBody')}
        confirmLabel={t('res.contacts.removeConfirm')}
        cancelLabel={t('res.contacts.keep')}
        destructive
        busy={remove.isPending}
        error={remove.isError ? errorText(remove.error) : null}
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </ScrollScreen>
  );
}

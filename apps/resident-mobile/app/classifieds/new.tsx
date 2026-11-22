import { unwrap } from '@safezone/api-client';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  ChipGroup,
  ScreenHeader,
  ScrollScreen,
  TextField,
  ToggleRow,
} from '@safezone/mobile-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Icon } from '../../src/components/icon';
import { nairaToKobo } from '../../src/features/marketplace';
import { errorText } from '../../src/lib/errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

type Kind = 'item' | 'service';
type Condition = 'new' | 'like_new' | 'good' | 'fair';

/** Post an item or service for neighbours (ADR-0023). Visible only inside this estate, for 30 days. */
export default function NewClassifiedScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId } = useResident();
  const [kind, setKind] = useState<Kind>('item');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [negotiable, setNegotiable] = useState(false);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: () => {
      const priceKobo = price.trim() ? (nairaToKobo(price) ?? undefined) : undefined;
      return unwrap(
        api.POST('/v1/estates/{estateId}/classifieds', {
          params: { path: { estateId } },
          body: {
            kind,
            title: title.trim(),
            description: description.trim(),
            ...(priceKobo ? { priceKobo } : {}),
            negotiable,
            ...(kind === 'item' && condition ? { condition } : {}),
            photoFileIds: [],
          },
        }),
      );
    },
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'classifieds'] });
      router.replace(`/classifieds/${item.id}`);
    },
  });
  const submit = () => {
    const next: Record<string, string> = {};
    if (title.trim().length < 3) next.title = t('res.classifieds.new.titleRequired');
    if (description.trim().length < 10)
      next.description = t('res.classifieds.new.descriptionRequired');
    if (price.trim() && nairaToKobo(price) === null)
      next.price = t('res.classifieds.new.priceInvalid');
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };
  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <ActionButton
          label={t('res.classifieds.new.submit')}
          busy={create.isPending}
          onPress={submit}
        />
      }
    >
      <ScreenHeader
        title={t('res.classifieds.new.title')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Banner tone="info">{t('res.classifieds.new.note')}</Banner>
      <ChipGroup
        label={t('res.classifieds.new.kind')}
        value={kind}
        onChange={setKind}
        options={[
          { key: 'item', label: t('res.classifieds.kind.item') },
          { key: 'service', label: t('res.classifieds.kind.service') },
        ]}
      />
      <TextField
        label={t('res.classifieds.new.title.label')}
        value={title}
        onChangeText={setTitle}
        error={errors.title}
        maxLength={120}
      />
      <TextField
        label={t('res.classifieds.new.description')}
        value={description}
        onChangeText={setDescription}
        error={errors.description}
        multiline
        maxLength={4000}
      />
      <TextField
        label={t('res.classifieds.new.price')}
        helper={t('res.classifieds.new.priceHelper')}
        value={price}
        onChangeText={setPrice}
        error={errors.price}
        keyboardType="number-pad"
        maxLength={12}
      />
      <ToggleRow
        label={t('res.classifieds.new.negotiable')}
        value={negotiable}
        onChange={setNegotiable}
      />
      {kind === 'item' ? (
        <ChipGroup
          label={t('res.classifieds.new.condition')}
          value={condition}
          onChange={setCondition}
          options={(['new', 'like_new', 'good', 'fair'] as const).map((key) => ({
            key,
            label: t(`res.classifieds.condition.${key}`),
          }))}
        />
      ) : null}
      {create.isError ? <Banner tone="danger">{errorText(create.error)}</Banner> : null}
    </ScrollScreen>
  );
}

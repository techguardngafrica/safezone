import { unwrap } from '@safezone/api-client';
import { colors } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import {
  ActionButton,
  Banner,
  Card,
  CheckboxRow,
  ChipGroup,
  ErrorState,
  ScreenHeader,
  ScrollScreen,
  Segmented,
  Skeleton,
  TextField,
} from '@safezone/mobile-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Icon } from '../../src/components/icon';
import {
  checkIssue,
  ISSUE_FIELD_PATHS,
  type IssueInput,
  type IssueKind,
} from '../../src/features/issues';
import { errorText } from '../../src/lib/errors';
import { formErrors } from '../../src/lib/form-errors';
import { useResident } from '../../src/lib/resident';
import { api } from '../../src/lib/session';

/** Report an issue (UI_GUIDELINES §8.1): kind, category, what and where. */
export default function NewIssueScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { estateId, household } = useResident();
  const [kind, setKind] = useState<IssueKind>('maintenance');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [preferredTimes, setPreferredTimes] = useState('');
  const [aboutNeighbour, setAboutNeighbour] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<IssueInput, string>>>({});
  const [otherErrors, setOtherErrors] = useState<string[]>([]);

  const categories = useQuery({
    queryKey: ['estate', estateId, 'maintenance-categories'],
    queryFn: () =>
      unwrap(
        api.GET('/v1/estates/{estateId}/maintenance-categories', {
          params: { path: { estateId } },
        }),
      ),
  });
  const options = (categories.data ?? []).filter((c) => c.active && c.kind === kind);

  const clear = (input: IssueInput) => {
    if (errors[input]) setErrors((current) => ({ ...current, [input]: undefined }));
  };

  const submit = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/v1/estates/{estateId}/maintenance-requests', {
          params: { path: { estateId } },
          body: {
            kind,
            categoryId: categoryId ?? '',
            // In-unit work is about the resident's own unit; complaints may be estate-wide.
            spaceId: kind === 'maintenance' ? household?.unit.id : undefined,
            title: title.trim(),
            description: description.trim(),
            preferredTimes:
              kind === 'maintenance' && preferredTimes.trim() ? preferredTimes.trim() : undefined,
            aboutNeighbour: kind === 'complaint' ? aboutNeighbour : false,
          },
        }),
      ),
    onSuccess: (issue) => {
      void queryClient.invalidateQueries({
        queryKey: ['estate', estateId, 'maintenance-requests'],
      });
      queryClient.setQueryData(['estate', estateId, 'maintenance-request', issue.id], issue);
      router.replace(`/issues/${issue.id}`);
    },
    onError: (error) => {
      const server = formErrors(error, ISSUE_FIELD_PATHS);
      setErrors(server.fields);
      setOtherErrors(server.other);
    },
  });

  const send = () => {
    setOtherErrors([]);
    const found = checkIssue({ categoryId, title, description });
    setErrors(found);
    if (Object.keys(found).length === 0) submit.mutate();
  };
  const invalidCount = Object.values(errors).filter(Boolean).length + otherErrors.length;

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          {invalidCount > 0 ? (
            <Text
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={{ color: colors.status.danger, fontSize: 14, marginBottom: 8 }}
            >
              {invalidCount === 1
                ? t('res.newPass.fixOne')
                : t('res.newPass.fixMany', { count: invalidCount })}
            </Text>
          ) : null}
          <ActionButton label={t('res.issue.send')} onPress={send} busy={submit.isPending} />
        </>
      }
    >
      <ScreenHeader
        title={t('res.issue.report')}
        onBack={() => router.back()}
        backIcon={<Icon name="arrow-back" />}
      />
      <Segmented
        label={t('res.issue.kind')}
        value={kind}
        onChange={(value) => {
          setKind(value);
          setCategoryId(null);
        }}
        options={[
          { key: 'maintenance', label: t('res.issue.kind.maintenance') },
          { key: 'complaint', label: t('res.issue.kind.complaint') },
        ]}
      />
      <Card>
        {categories.isPending ? <Skeleton height={48} /> : null}
        {categories.isError ? (
          <ErrorState
            message={errorText(categories.error)}
            onRetry={() => void categories.refetch()}
          />
        ) : null}
        {categories.data && options.length === 0 ? (
          <Text style={{ color: colors.semantic.textMuted }}>{t('res.issue.noCategories')}</Text>
        ) : null}
        {options.length > 0 ? (
          <ChipGroup<string>
            label={t('res.issue.category')}
            value={categoryId}
            onChange={(value) => {
              setCategoryId(value);
              clear('category');
            }}
            options={options.map((c) => ({ key: c.id, label: c.name }))}
            error={errors.category}
          />
        ) : null}
        <TextField
          label={t('res.issue.titleLabel')}
          placeholder={t('res.issue.titlePlaceholder')}
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            clear('title');
          }}
          error={errors.title}
          maxLength={120}
        />
        <TextField
          label={t('res.issue.description')}
          helper={t('res.issue.descriptionHelp')}
          value={description}
          onChangeText={(value) => {
            setDescription(value);
            clear('description');
          }}
          error={errors.description}
          multiline
          maxLength={4000}
        />
        {kind === 'maintenance' ? (
          <TextField
            label={t('res.issue.preferredTimes')}
            placeholder={t('res.issue.preferredTimesPlaceholder')}
            value={preferredTimes}
            onChangeText={(value) => {
              setPreferredTimes(value);
              clear('preferredTimes');
            }}
            error={errors.preferredTimes}
            maxLength={300}
          />
        ) : (
          <CheckboxRow
            label={t('res.issue.aboutNeighbour')}
            checked={aboutNeighbour}
            onChange={setAboutNeighbour}
          />
        )}
      </Card>
      {kind === 'maintenance' && household ? (
        <Text style={{ color: colors.semantic.textMuted, fontSize: 13 }}>
          {t('res.issue.forUnit', { unit: household.unit.code })}
        </Text>
      ) : null}
      {otherErrors.map((message) => (
        <Banner key={message} tone="danger">
          {message}
        </Banner>
      ))}
      {submit.isError && invalidCount === 0 ? (
        <Banner tone="danger">{errorText(submit.error)}</Banner>
      ) : null}
    </ScrollScreen>
  );
}

import { type ApiRow, unwrap, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { type MessageKey, t } from '@safezone/i18n';
import { ChipGroup, ScrollScreen, TextField } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BackRow, BigButton, BodyText, GateTitle } from '../../src/components/gate-ui';
import { Icon } from '../../src/components/icon';
import { PhotoCapture } from '../../src/components/photo-capture';
import { uploadEvidencePhoto } from '../../src/features/evidence-upload';
import { errorText } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

const CATEGORIES = [
  'suspicious_activity',
  'unauthorised_access',
  'theft',
  'fight',
  'fire',
  'accident',
  'damage',
  'other',
] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const PLACES = ['gate', 'unit', 'common_area', 'other'] as const;
const WHEN = { now: 0, m15: 15, m60: 60 } as const;
type Category = (typeof CATEGORIES)[number];
type Severity = (typeof SEVERITIES)[number];
type Place = (typeof PLACES)[number];
type Unit = ApiRow<'/v1/estates/{estateId}/units', 'get'>;

const PLACE_LABEL: Record<Place, MessageKey> = {
  gate: 'sec.incident.whereGate',
  unit: 'sec.incident.whereUnit',
  common_area: 'sec.incident.whereCommon',
  other: 'sec.incident.whereOther',
};

function UnitSearch({ onPick }: { onPick: (unit: Unit) => void }) {
  const { estateId } = useGate();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const units = useQuery({
    queryKey: ['estate', estateId, 'units', 'search', q],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/units', {
          params: { path: { estateId }, query: { q, limit: 6 } },
        }),
      ),
    enabled: q.length >= 1,
  });
  return (
    <View style={{ gap: spacing[2] }}>
      <TextField
        label={t('sec.walkin.unitSearch')}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="characters"
      />
      {units.data?.items.map((unit) => (
        <Pressable
          key={unit.id}
          accessibilityRole="button"
          accessibilityLabel={`${unit.code}, ${unit.name}`}
          onPress={() => onPick(unit)}
          style={({ pressed }) => [styles.unit, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.unitCode}>{unit.code}</Text>
          <Text style={styles.muted}>{unit.name}</Text>
        </Pressable>
      ))}
      {units.data && units.data.items.length === 0 ? (
        <BodyText muted>{t('sec.walkin.unitNone', { query: q })}</BodyText>
      ) : null}
    </View>
  );
}

/** Incident report (security-mobile.md §7.7). Needs a connection; photos are uploaded before sending. */
export default function NewIncident() {
  const { estateId, gate, sync } = useGate();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<Category | null>(null);
  const [severity, setSeverity] = useState<Severity>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState<Place>('gate');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [placeText, setPlaceText] = useState('');
  const [when, setWhen] = useState<keyof typeof WHEN>('now');
  const [people, setPeople] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [camera, setCamera] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!category) next.category = t('sec.incident.category');
    if (title.trim().length < 3) next.title = t('sec.incident.titleRequired');
    if (description.trim().length < 5) next.description = t('sec.incident.descriptionRequired');
    if (place === 'unit' && !unit) next.place = t('sec.walkin.unitRequired');
    if ((place === 'common_area' || place === 'other') && !placeText.trim())
      next.place = t('sec.incident.placeRequired');
    setErrors(next);
    if (Object.keys(next).length > 0 || !category) return;
    setError(null);
    try {
      const fileIds: string[] = [];
      for (const [index, uri] of photos.entries()) {
        setProgress(t('sec.incident.uploading', { number: index + 1, total: photos.length }));
        fileIds.push(await uploadEvidencePhoto(estateId, uri));
      }
      setProgress(t('common.loading'));
      const created = await unwrap(
        api.POST('/v1/estates/{estateId}/incidents', {
          params: { path: { estateId } },
          body: {
            category,
            severity,
            title: title.trim(),
            description: description.trim(),
            locationKind: place,
            ...(place === 'gate' && gate ? { gateId: gate.id } : {}),
            ...(place === 'unit' && unit ? { spaceId: unit.id } : {}),
            ...(placeText.trim() && place !== 'gate' && place !== 'unit'
              ? { locationText: placeText.trim() }
              : {}),
            occurredAt: new Date(Date.now() - WHEN[when] * 60_000).toISOString(),
            ...(people.trim() ? { peopleInvolved: people.trim() } : {}),
            evidenceFileIds: fileIds,
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'incidents'] });
      router.replace(`/incidents/${created.id}`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setProgress(null);
    }
  };

  return (
    <ScrollScreen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <BigButton
          label={progress ?? t('sec.incident.submit')}
          icon="send-outline"
          disabled={busy || !sync.online}
          onPress={() => void submit()}
        />
      }
    >
      <BackRow onBack={() => router.back()} />
      <GateTitle>{t('sec.incident.newTitle')}</GateTitle>
      {!sync.online ? (
        <View style={styles.offline} accessibilityLiveRegion="polite">
          <BodyText>{t('sec.incidents.offline')}</BodyText>
        </View>
      ) : null}
      <ChipGroup
        label={t('sec.incident.category')}
        value={category}
        onChange={setCategory}
        error={errors.category ? t('sec.incident.category') : null}
        options={CATEGORIES.map((key) => ({ key, label: t(`incident.category.${key}`) }))}
      />
      <ChipGroup
        label={t('sec.incident.severity')}
        value={severity}
        onChange={setSeverity}
        options={SEVERITIES.map((key) => ({ key, label: t(`incident.severity.${key}`) }))}
      />
      {severity === 'critical' ? <BodyText>{t('sec.incident.criticalNote')}</BodyText> : null}
      <TextField
        label={t('sec.incident.titleLabel')}
        value={title}
        onChangeText={setTitle}
        placeholder={t('sec.incident.titlePlaceholder')}
        maxLength={120}
        error={errors.title}
      />
      <TextField
        label={t('sec.incident.description')}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={4000}
        error={errors.description}
      />
      <ChipGroup
        label={t('sec.incident.where')}
        value={place}
        onChange={(key) => {
          setPlace(key);
          setErrors((current) => ({ ...current, place: '' }));
        }}
        options={PLACES.map((key) => ({ key, label: t(PLACE_LABEL[key]) }))}
      />
      {place === 'gate' && gate ? <BodyText muted>{gate.name}</BodyText> : null}
      {place === 'unit' ? (
        unit ? (
          <View style={styles.picked}>
            <Text style={[styles.unitCode, { flex: 1 }]}>{unit.code}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setUnit(null)}
              style={styles.change}
            >
              <Text style={styles.changeText}>{t('sec.walkin.unitChange')}</Text>
            </Pressable>
          </View>
        ) : (
          <UnitSearch onPick={setUnit} />
        )
      ) : null}
      {place === 'common_area' || place === 'other' ? (
        <TextField
          label={t('sec.incident.placeLabel')}
          value={placeText}
          onChangeText={setPlaceText}
          maxLength={200}
        />
      ) : null}
      {errors.place ? <Text style={styles.error}>{errors.place}</Text> : null}
      <ChipGroup
        label={t('sec.incident.when')}
        value={when}
        onChange={setWhen}
        options={[
          { key: 'now', label: t('sec.incident.whenNow') },
          { key: 'm15', label: t('sec.incident.when15') },
          { key: 'm60', label: t('sec.incident.when60') },
        ]}
      />
      <TextField
        label={t('sec.incident.people')}
        value={people}
        onChangeText={setPeople}
        multiline
        maxLength={1000}
      />
      <Text accessibilityRole="header" style={styles.section}>
        {t('sec.incident.photos')}
      </Text>
      <BodyText muted>{t('sec.incident.photoCount', { count: photos.length })}</BodyText>
      <View style={styles.photos}>
        {photos.map((uri, index) => (
          <Pressable
            key={uri}
            accessibilityRole="button"
            accessibilityLabel={t('sec.incident.removePhoto', { number: index + 1 })}
            onPress={() => setPhotos((current) => current.filter((item) => item !== uri))}
            style={styles.photo}
          >
            <Image source={{ uri }} style={StyleSheet.absoluteFill} />
            <View style={styles.remove}>
              <Icon name="close" size={22} color={colors.neutral[0]} />
            </View>
          </Pressable>
        ))}
      </View>
      {photos.length < 10 ? (
        <BigButton
          label={t('sec.incident.addPhoto')}
          tone="outline"
          icon="camera-outline"
          disabled={busy}
          onPress={() => setCamera(true)}
        />
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <PhotoCapture
        visible={camera}
        onClose={() => setCamera(false)}
        onPhoto={(uri) => {
          setPhotos((current) => [...current, uri].slice(0, 10));
          setCamera(false);
        }}
      />
    </ScrollScreen>
  );
}

const styles = StyleSheet.create({
  offline: {
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.status.warning,
    padding: spacing[3],
  },
  unit: {
    minHeight: 64,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    justifyContent: 'center',
  },
  picked: {
    minHeight: 64,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.brand.primary,
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitCode: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  muted: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  change: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing[2] },
  changeText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.brand.primary,
  },
  section: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  photo: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.neutral[100],
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.overlay.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});

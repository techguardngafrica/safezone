import { unwrap } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { formatDateTime, t } from '@safezone/i18n';
import { ConfirmModal, ErrorState, Skeleton } from '@safezone/mobile-ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BackRow,
  BigButton,
  BodyText,
  Fact,
  gateStyles,
  GateTitle,
} from '../../src/components/gate-ui';
import { PhotoCapture } from '../../src/components/photo-capture';
import { uploadEvidencePhoto } from '../../src/features/evidence-upload';
import { errorText } from '../../src/lib/errors';
import { useGate } from '../../src/lib/gate';
import { api } from '../../src/lib/session';

type Detail = Awaited<ReturnType<typeof fetchIncident>>;

function fetchIncident(estateId: string, id: string) {
  return unwrap(
    api.GET('/v1/estates/{estateId}/incidents/{id}', { params: { path: { estateId, id } } }),
  );
}

function whereText(incident: Detail): string {
  if (incident.locationKind === 'gate') return incident.gateName ?? t('sec.incident.whereGate');
  if (incident.locationKind === 'unit') return incident.unitCode ?? t('sec.incident.whereUnit');
  return incident.locationText ?? '';
}

/** One incident: details, photos with their fingerprints, timeline, and append-only additions. */
export default function IncidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { estateId } = useGate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['estate', estateId, 'incidents', id],
    queryFn: () => fetchIncident(estateId, id),
  });
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = (data: Detail) => {
    queryClient.setQueryData(['estate', estateId, 'incidents', id], data);
    void queryClient.invalidateQueries({ queryKey: ['estate', estateId, 'incidents', 'list'] });
  };

  const saveNote = async () => {
    setBusy(true);
    setError(null);
    try {
      refresh(
        await unwrap(
          api.POST('/v1/estates/{estateId}/incidents/{id}/notes', {
            params: { path: { estateId, id } },
            body: { body: note.trim() },
          }),
        ),
      );
      setNoteOpen(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const addPhoto = async (uri: string) => {
    setCamera(false);
    setBusy(true);
    setError(null);
    try {
      const fileId = await uploadEvidencePhoto(estateId, uri);
      refresh(
        await unwrap(
          api.POST('/v1/estates/{estateId}/incidents/{id}/evidence', {
            params: { path: { estateId, id } },
            body: { fileIds: [fileId] },
          }),
        ),
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending)
    return (
      <SafeAreaView style={gateStyles.screen}>
        <View style={gateStyles.content}>
          <Skeleton height={40} width="70%" />
          <Skeleton height={200} />
        </View>
      </SafeAreaView>
    );
  if (query.isError)
    return (
      <SafeAreaView style={[gateStyles.screen, { justifyContent: 'center', padding: spacing[4] }]}>
        <ErrorState message={errorText(query.error)} onRetry={() => void query.refetch()} />
        <BigButton label={t('ui.back')} tone="outline" onPress={() => router.back()} />
      </SafeAreaView>
    );

  const incident = query.data;
  const closed = incident.status === 'closed';

  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <BackRow onBack={() => router.back()} />
        <GateTitle>{incident.title}</GateTitle>
        <View style={styles.pills}>
          <Text style={styles.pill}>{t(`incident.category.${incident.category}`)}</Text>
          <Text style={styles.pill}>{t(`incident.severity.${incident.severity}`)}</Text>
          <Text style={styles.pill}>{t(`incident.status.${incident.status}`)}</Text>
        </View>
        <BodyText>{incident.description}</BodyText>
        <Fact label={t('sec.incident.location')} value={whereText(incident)} />
        <Fact label={t('sec.incident.when')} value={formatDateTime(incident.occurredAt)} />
        {incident.peopleInvolved ? (
          <Fact label={t('sec.incident.people')} value={incident.peopleInvolved} />
        ) : null}
        {incident.resolution ? (
          <Fact label={t('sec.incident.resolution')} value={incident.resolution} />
        ) : null}

        {incident.evidence.length > 0 ? (
          <View style={{ gap: spacing[1] }}>
            <Text accessibilityRole="header" style={styles.section}>
              {t('sec.incident.photos')}
            </Text>
            {incident.evidence.map((item, index) => (
              <Text key={item.id} style={styles.muted}>
                {t('sec.incident.photoHash', {
                  number: index + 1,
                  hash: item.sha256 ? item.sha256.slice(0, 12) : '-',
                })}
              </Text>
            ))}
          </View>
        ) : null}

        <Text accessibilityRole="header" style={styles.section}>
          {t('sec.incident.timeline')}
        </Text>
        <View style={styles.event}>
          <Text style={styles.time}>{formatDateTime(incident.createdAt)}</Text>
          <Text style={styles.eventText}>{t('sec.incident.created')}</Text>
        </View>
        {incident.notes.map((item) => (
          <View key={item.id} style={styles.event}>
            <Text style={styles.time}>{formatDateTime(item.createdAt)}</Text>
            <Text style={styles.eventText}>
              {item.kind === 'status' && item.toStatus
                ? t('sec.incident.event.status', { status: t(`incident.status.${item.toStatus}`) })
                : t('sec.incident.event.note')}
              {item.body ? `: ${item.body}` : ''}
            </Text>
          </View>
        ))}

        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
        {closed ? (
          <BodyText muted>{t('sec.incident.closed')}</BodyText>
        ) : (
          <>
            <BigButton
              label={t('sec.incident.note')}
              icon="create-outline"
              disabled={busy}
              onPress={() => {
                setNote('');
                setNoteOpen(true);
              }}
            />
            <BigButton
              label={t('sec.incident.addPhoto')}
              tone="outline"
              icon="camera-outline"
              busy={busy}
              onPress={() => setCamera(true)}
            />
          </>
        )}
      </ScrollView>
      <ConfirmModal
        visible={noteOpen}
        title={t('sec.incident.noteTitle')}
        body={t('sec.incident.noteBody')}
        confirmLabel={t('sec.incident.noteSave')}
        busy={busy}
        error={error}
        reason={{ label: t('sec.sos.noteLabel'), value: note, onChange: setNote, required: true }}
        onConfirm={() => void saveNote()}
        onCancel={() => setNoteOpen(false)}
      />
      <PhotoCapture
        visible={camera}
        onClose={() => setCamera(false)}
        onPhoto={(uri) => void addPhoto(uri)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.semantic.borderStrong,
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  section: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  muted: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
    color: colors.semantic.textMuted,
  },
  event: { flexDirection: 'row', gap: spacing[3] },
  time: {
    width: 120,
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  eventText: {
    flex: 1,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
    color: colors.semantic.text,
  },
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});

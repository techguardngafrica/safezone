import { type ApiRow, unwrapPage } from '@safezone/api-client';
import { colors, radii, spacing, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Skeleton, TextField } from '@safezone/mobile-ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { errorText } from '../lib/errors';
import { useGate } from '../lib/gate';
import { api } from '../lib/session';
import { BodyText } from './gate-ui';

export type Unit = ApiRow<'/v1/estates/{estateId}/units', 'get'>;

function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [ms, value]);
  return debounced;
}

/** Search and pick a host unit (walk-ins, deliveries). */
export function UnitPicker({ onPick }: { onPick: (unit: Unit) => void }) {
  const { estateId } = useGate();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const units = useQuery({
    queryKey: ['estate', estateId, 'units', 'search', q],
    queryFn: () =>
      unwrapPage(
        api.GET('/v1/estates/{estateId}/units', {
          params: { path: { estateId }, query: { q, limit: 8 } },
        }),
      ),
    enabled: q.length >= 1,
  });
  return (
    <View style={{ gap: spacing[2] }}>
      <TextField
        label={t('sec.walkin.unit')}
        value={query}
        onChangeText={setQuery}
        placeholder={t('sec.walkin.unitSearch')}
        autoCapitalize="characters"
      />
      {units.isFetching && !units.data ? <Skeleton height={56} /> : null}
      {units.data?.items.map((unit) => (
        <Pressable
          key={unit.id}
          accessibilityRole="button"
          accessibilityLabel={`${unit.code}, ${unit.name}`}
          onPress={() => onPick(unit)}
          style={({ pressed }) => [pickerStyles.unit, pressed && { opacity: 0.8 }]}
        >
          <Text style={pickerStyles.unitCode}>{unit.code}</Text>
          <Text style={pickerStyles.unitName}>{unit.name}</Text>
        </Pressable>
      ))}
      {units.data && units.data.items.length === 0 ? (
        <BodyText muted>{t('sec.walkin.unitNone', { query: q })}</BodyText>
      ) : null}
      {units.isError ? <Text style={pickerStyles.error}>{errorText(units.error)}</Text> : null}
    </View>
  );
}

/** The chosen unit with a large Change button. */
export function PickedUnit({ unit, onChange }: { unit: Unit; onChange: () => void }) {
  return (
    <View style={pickerStyles.picked}>
      <View style={{ flex: 1 }}>
        <Text style={pickerStyles.unitCode}>{unit.code}</Text>
        <Text style={pickerStyles.unitName}>{unit.name}</Text>
      </View>
      <Pressable accessibilityRole="button" onPress={onChange} style={pickerStyles.change}>
        <Text style={pickerStyles.changeText}>{t('sec.walkin.unitChange')}</Text>
      </Pressable>
    </View>
  );
}

const pickerStyles = StyleSheet.create({
  unit: {
    minHeight: 64,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.semantic.border,
    backgroundColor: colors.neutral[0],
    justifyContent: 'center',
  },
  picked: {
    minHeight: 72,
    padding: spacing[3],
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.brand.primary,
    backgroundColor: colors.neutral[0],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  unitCode: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  unitName: {
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
  error: {
    color: colors.status.danger,
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
  },
});

import { colors, radii, spacing } from '@safezone/design-tokens';
import { useMemo } from 'react';
import { View } from 'react-native';
import { toQR } from 'toqr';

/**
 * QR code drawn with plain Views from the toqr matrix (no native modules). Each row is one View of
 * merged dark runs (a few hundred Views for a pass code). White card with a 16 px quiet zone
 * (UI_GUIDELINES §8.1); at least 240 px wide.
 */
export function QrCode({
  value,
  size = 240,
  label,
}: {
  value: string;
  size?: number;
  label: string;
}) {
  const { modules, rows } = useMemo(() => {
    const matrix = toQR(value);
    const count = Math.round(Math.sqrt(matrix.length));
    const runs: { start: number; length: number }[][] = [];
    for (let y = 0; y < count; y++) {
      const row: { start: number; length: number }[] = [];
      let x = 0;
      while (x < count) {
        if (matrix[y * count + x]) {
          const start = x;
          while (x < count && matrix[y * count + x]) x++;
          row.push({ start, length: x - start });
        } else x++;
      }
      runs.push(row);
    }
    return { modules: count, rows: runs };
  }, [value]);
  const cell = Math.floor(size / modules);
  const quiet = spacing[4];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        backgroundColor: '#FFFFFF',
        padding: quiet,
        borderRadius: radii.lg,
        alignSelf: 'center',
        borderWidth: 1,
        borderColor: colors.semantic.borderSubtle,
      }}
    >
      <View style={{ width: cell * modules, height: cell * modules }}>
        {rows.map((row, y) =>
          row.map((run) => (
            <View
              key={`${y}-${run.start}`}
              style={{
                position: 'absolute',
                top: y * cell,
                left: run.start * cell,
                width: run.length * cell,
                height: cell,
                backgroundColor: '#000000',
              }}
            />
          )),
        )}
      </View>
    </View>
  );
}

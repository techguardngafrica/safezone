import { colors, typography } from '@safezone/design-tokens';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Shared text styles for marketplace screens (design tokens only). */
export const marketStyles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: { flex: 1, fontSize: typography.size.md, fontWeight: '600', color: colors.semantic.text },
  body: { fontSize: typography.size.sm, color: colors.semantic.text, lineHeight: 20 },
  muted: { fontSize: typography.size.sm, color: colors.semantic.textMuted },
  price: { fontSize: typography.size.md, fontWeight: '700', color: colors.brand.primary },
  big: { fontSize: typography.size.xl, fontWeight: '700', color: colors.semantic.text },
  label: { fontSize: typography.size.sm, fontWeight: '600', color: colors.semantic.text },
});

export function Row({ children }: { children: ReactNode }) {
  return <View style={marketStyles.rowBetween}>{children}</View>;
}

export function Muted({
  children,
  numberOfLines,
}: {
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text style={marketStyles.muted} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <Text style={marketStyles.body}>{children}</Text>;
}

/** A message bubble line: author, time, text. */
export function MessageLine({
  author,
  when,
  body,
  mine,
}: {
  author: string;
  when: string;
  body: string;
  mine: boolean;
}) {
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        backgroundColor: mine ? colors.statusSubtle.info.background : colors.semantic.surface,
        borderColor: colors.semantic.borderSubtle,
        borderWidth: 1,
        borderRadius: 12,
        padding: 10,
        gap: 2,
      }}
    >
      <Text style={marketStyles.muted}>
        {author} · {when}
      </Text>
      <Text style={marketStyles.body}>{body}</Text>
    </View>
  );
}

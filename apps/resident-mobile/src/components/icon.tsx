import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@safezone/design-tokens';
import type { ComponentProps } from 'react';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Outline icons (Ionicons until the icon ADR lands, UI_GUIDELINES §4.10). Decorative by default. */
export function Icon({
  name,
  size = 22,
  color = colors.semantic.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

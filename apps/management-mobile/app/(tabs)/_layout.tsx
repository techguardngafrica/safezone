import { colors, spacing, touchTarget } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../src/components/icon';
import { useApprovalCount } from '../../src/features/approvals';

function tabIcon(name: IconName, activeName: IconName) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={focused ? activeName : name} color={String(color)} size={24} />;
  }
  return TabIcon;
}

/** Bottom tabs (management-mobile.md §6): Home, Approvals, Security, Estate, More. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const approvals = useApprovalCount();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.semantic.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
        tabBarStyle: {
          height: touchTarget.default + spacing[3] + insets.bottom,
          paddingTop: spacing[1],
          backgroundColor: colors.semantic.surface,
          borderTopColor: colors.semantic.borderSubtle,
        },
        sceneStyle: { backgroundColor: colors.semantic.background },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: t('mm.tab.home'), tabBarIcon: tabIcon('home-outline', 'home') }}
      />
      <Tabs.Screen
        name="approvals"
        options={{
          title: t('mm.tab.approvals'),
          tabBarIcon: tabIcon('checkmark-done-outline', 'checkmark-done'),
          tabBarBadge: approvals.count > 0 ? approvals.label : undefined,
        }}
      />
      <Tabs.Screen
        name="security"
        options={{
          title: t('mm.tab.security'),
          tabBarIcon: tabIcon('shield-outline', 'shield'),
        }}
      />
      <Tabs.Screen
        name="estate"
        options={{
          title: t('mm.tab.estate'),
          tabBarIcon: tabIcon('business-outline', 'business'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: t('mm.tab.more'), tabBarIcon: tabIcon('menu-outline', 'menu') }}
      />
    </Tabs>
  );
}

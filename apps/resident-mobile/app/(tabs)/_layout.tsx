import { colors, spacing } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { Tabs } from 'expo-router';
import { type ColorValue, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../src/components/icon';
import { SosButton, TAB_BAR_HEIGHT } from '../../src/components/sos-button';
import { useResident } from '../../src/lib/resident';
import { useMyActiveSos } from '../../src/lib/sos';

function tabIcon(name: IconName, activeName: IconName) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Icon name={focused ? activeName : name} color={String(color)} size={24} />;
  }
  return TabIcon;
}

/** Phase 1 tabs: Home, Visitors, More (UI_GUIDELINES §6.10), with the SOS control above the tab bar. */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { can, hasFeature } = useResident();
  const activeSos = useMyActiveSos();
  const showSos = hasFeature('emergency') && can('sos.trigger');
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.brand.primary,
          tabBarInactiveTintColor: colors.semantic.textMuted,
          tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
          tabBarStyle: {
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingTop: spacing[1],
            backgroundColor: colors.semantic.surface,
            borderTopColor: colors.semantic.borderSubtle,
          },
          sceneStyle: { backgroundColor: colors.semantic.background },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{ title: t('res.tab.home'), tabBarIcon: tabIcon('home-outline', 'home') }}
        />
        <Tabs.Screen
          name="visitors"
          options={{
            title: t('res.tab.visitors'),
            tabBarIcon: tabIcon('people-outline', 'people'),
            href: hasFeature('visitors') ? undefined : null,
          }}
        />
        <Tabs.Screen
          name="more"
          options={{ title: t('res.tab.more'), tabBarIcon: tabIcon('menu-outline', 'menu') }}
        />
      </Tabs>
      {showSos ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            right: spacing[4],
            bottom: insets.bottom + TAB_BAR_HEIGHT + spacing[3],
          }}
        >
          <SosButton activeAlertId={activeSos?.id ?? null} />
        </View>
      ) : null}
    </View>
  );
}

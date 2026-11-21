import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ListRow } from '@safezone/mobile-ui';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useManager } from '../lib/manager';
import { Icon } from './icon';

/** Bottom-sheet estate switcher: last-used estate first, with the user's roles there. */
export function EstateSwitcherModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { memberships, estateId, switchEstate } = useManager();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('ui.close')}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('management.picker.title')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('ui.close')}
              onPress={onClose}
              style={styles.close}
            >
              <Icon name="close" size={22} color={colors.semantic.textMuted} />
            </Pressable>
          </View>
          <ScrollView style={styles.list}>
            {memberships.map((membership) => {
              const current = membership.estate.id === estateId;
              return (
                <ListRow
                  key={membership.estate.id}
                  title={membership.estate.name}
                  subtitle={t('home.memberships.roles', {
                    roles: membership.roles.join(', ') || '-',
                  })}
                  leading={<Icon name="business-outline" color={colors.brand.primary} size={20} />}
                  trailing={
                    current ? (
                      <View style={styles.current}>
                        <Icon name="checkmark-circle" color={colors.brand.primary} size={18} />
                        <Text style={styles.currentText}>{t('mm.estates.current')}</Text>
                      </View>
                    ) : undefined
                  }
                  onPress={() => {
                    switchEstate(membership.estate.id);
                    onClose();
                  }}
                />
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.overlay.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
    maxHeight: '75%',
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  close: {
    width: touchTarget.default,
    height: touchTarget.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { maxHeight: 360 },
  current: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  currentText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.brand.primary,
  },
});

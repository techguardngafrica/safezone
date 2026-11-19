import { colors, radii, spacing, touchTarget, typography } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { ActionButton, ListRow } from '@safezone/mobile-ui';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { roleText } from '../lib/labels';
import { type Membership, useResident } from '../lib/resident';
import { Icon } from './icon';

function formatRoles(roles: Membership['roles']): string | undefined {
  if (roles.length === 0) return undefined;
  return roles.map(roleText).join(', ');
}

/** Bottom-sheet estate switcher: last-used estate first, with roles and a join shortcut. */
export function EstateSwitcherModal({
  visible,
  onClose,
  onJoinAnother,
}: {
  visible: boolean;
  onClose: () => void;
  onJoinAnother: () => void;
}) {
  const { memberships, estateId, switchEstate } = useResident();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('ui.close')}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('res.estates.title')}
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
          <Text style={styles.hint}>{t('res.estates.hint')}</Text>
          <ScrollView style={styles.list}>
            {memberships.map((membership) => {
              const current = membership.estate.id === estateId;
              return (
                <ListRow
                  key={membership.estate.id}
                  title={membership.estate.name}
                  subtitle={formatRoles(membership.roles)}
                  leading={<Icon name="business-outline" color={colors.brand.primary} size={20} />}
                  trailing={
                    current ? (
                      <View style={styles.current}>
                        <Icon name="checkmark-circle" color={colors.brand.primary} size={18} />
                        <Text style={styles.currentText}>{t('res.estates.current')}</Text>
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
          <ActionButton
            label={t('res.more.joinAnother')}
            variant="outline"
            icon={<Icon name="add-circle-outline" color={colors.brand.primary} size={20} />}
            onPress={() => {
              onClose();
              onJoinAnother();
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.semantic.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing[5],
    gap: spacing[3],
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    color: colors.semantic.text,
  },
  hint: {
    fontSize: typography.size.sm,
    color: colors.semantic.textMuted,
  },
  close: {
    width: touchTarget.default,
    height: touchTarget.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    maxHeight: 320,
  },
  current: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  currentText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    color: colors.brand.primary,
  },
});

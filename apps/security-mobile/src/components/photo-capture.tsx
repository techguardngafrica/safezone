import { colors, spacing } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton, BodyText } from './gate-ui';

/** Full-screen camera that returns one JPEG (quality reduced to keep uploads small on gate networks). */
export function PhotoCapture({
  visible,
  onPhoto,
  onClose,
}: {
  visible: boolean;
  onPhoto: (uri: string) => void;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.6, exif: false });
      if (photo?.uri) onPhoto(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        {permission?.granted ? (
          <View style={styles.frame}>
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
          </View>
        ) : (
          <View style={[styles.frame, styles.ask]}>
            <BodyText>
              {permission?.canAskAgain === false
                ? t('sec.scan.permissionDenied')
                : t('sec.scan.permissionBody')}
            </BodyText>
            {permission?.canAskAgain !== false ? (
              <BigButton
                label={t('sec.scan.permissionAllow')}
                icon="camera-outline"
                onPress={() => void requestPermission()}
              />
            ) : null}
          </View>
        )}
        <View style={styles.actions}>
          <BigButton
            label={t('sec.camera.capture')}
            icon="camera"
            busy={busy}
            disabled={!permission?.granted}
            onPress={() => void capture()}
          />
          <BigButton label={t('sec.camera.close')} tone="outline" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.neutral[0] },
  frame: { flex: 1, backgroundColor: colors.semantic.text, overflow: 'hidden' },
  ask: { backgroundColor: colors.neutral[0], padding: spacing[4], gap: spacing[3] },
  actions: { padding: spacing[4], gap: spacing[3] },
});

import { spacing } from '@safezone/design-tokens';
import { t } from '@safezone/i18n';
import { EmptyState, Skeleton } from '@safezone/mobile-ui';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BigButton, BodyText, gateStyles, GateTitle } from '../components/gate-ui';
import { useGate } from '../lib/gate';
import { session } from '../lib/session';

/** Other estates this person can switch to, as large buttons. */
function EstateSwitcher() {
  const { memberships, estateId, switchEstate } = useGate();
  const others = memberships.filter((membership) => membership.estate.id !== estateId);
  if (others.length === 0) return null;
  return (
    <>
      <BodyText muted>{t('sec.switchEstate')}</BodyText>
      {others.map((membership) => (
        <BigButton
          key={membership.estate.id}
          label={membership.estate.name}
          tone="outline"
          icon="business-outline"
          onPress={() => switchEstate(membership.estate.id)}
        />
      ))}
    </>
  );
}

/** One-time choice of the gate this phone serves (kept until changed in Gate settings). */
export function GatePicker() {
  const { estateName, gates, gatesLoading, chooseGate } = useGate();
  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={gateStyles.content}>
        <GateTitle>{t('sec.setup.title')}</GateTitle>
        <BodyText>{t('sec.setup.body')}</BodyText>
        <BodyText muted>
          {t('sec.setup.estate')}: {estateName}
        </BodyText>
        {gatesLoading ? (
          <>
            <Skeleton height={64} />
            <Skeleton height={64} />
          </>
        ) : gates.length === 0 ? (
          <EmptyState title={t('sec.setup.empty')} body={t('sec.setup.offline')} />
        ) : (
          gates.map((gate) => (
            <BigButton
              key={gate.id}
              label={gate.name}
              icon="enter-outline"
              onPress={() => chooseGate(gate.id)}
            />
          ))
        )}
        <EstateSwitcher />
        <BigButton
          label={t('auth.signOut')}
          tone="outline"
          onPress={() => void session.signOut()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Signed in, but without gate permissions here (or without any estate). */
export function NotAGuard({ noEstate }: { noEstate?: boolean }) {
  return (
    <SafeAreaView style={gateStyles.screen}>
      <ScrollView contentContainerStyle={[gateStyles.content, { paddingTop: spacing[7] }]}>
        {noEstate ? <NoEstate /> : <NoPermission />}
        <BigButton
          label={t('auth.signOut')}
          tone="outline"
          onPress={() => void session.signOut()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function NoEstate() {
  return (
    <>
      <GateTitle>{t('sec.noEstate.title')}</GateTitle>
      <BodyText>{t('sec.noEstate.body')}</BodyText>
    </>
  );
}

function NoPermission() {
  const { estateName } = useGate();
  return (
    <>
      <GateTitle>{t('sec.notGuard.title')}</GateTitle>
      <BodyText>{t('sec.notGuard.body', { estate: estateName })}</BodyText>
      <EstateSwitcher />
    </>
  );
}

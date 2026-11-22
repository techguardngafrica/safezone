import { Redirect } from 'expo-router';
import { lastWalletItem } from '../../src/features/wallet';

/** safezone://wallet/return: back from checkout. The detail screen verifies the payment. */
export default function WalletReturn() {
  const last = lastWalletItem();
  if (!last) return <Redirect href="/wallet" />;
  return (
    <Redirect
      href={last.kind === 'transfer' ? `/wallet/transfer/${last.id}` : `/wallet/topup/${last.id}`}
    />
  );
}

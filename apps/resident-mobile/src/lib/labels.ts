import { type MessageKey, t } from '@safezone/i18n';

function translated(key: string, fallback: string): string {
  const text = t(key as MessageKey);
  return text === key ? fallback : text;
}

/** "card" → "Card"; unknown provider channels become plain words. */
export function paymentMethodText(channel: string): string {
  const plain = channel.replace(/_/g, ' ');
  return translated(
    `res.receipts.method.${channel}`,
    plain.charAt(0).toUpperCase() + plain.slice(1),
  );
}

/** Built-in role key → its translated name. */
export function roleText(role: string): string {
  return translated(`role.${role}`, role.replace(/_/g, ' '));
}

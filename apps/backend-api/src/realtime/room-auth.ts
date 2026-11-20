const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const ESTATE_SOS = new RegExp(`^estate:(${UUID}):sos$`, 'i');
const ESTATE_SECURITY = new RegExp(`^estate:(${UUID}):security$`, 'i');
const ESTATE_GATE = new RegExp(`^estate:(${UUID}):gate:(${UUID})$`, 'i');
const ESTATE_DASHBOARD = new RegExp(`^estate:(${UUID}):dashboard$`, 'i');
const ESTATE_CHANNEL = new RegExp(`^estate:(${UUID}):channel:(${UUID})$`, 'i');

export type ParsedRoom =
  | { kind: 'sos'; estateId: string }
  | { kind: 'security'; estateId: string }
  | { kind: 'gate'; estateId: string; gateId: string }
  | { kind: 'dashboard'; estateId: string }
  | { kind: 'channel'; estateId: string; channelId: string };

/** Parses a client-requested Socket.IO room name into a typed target, or null if invalid. */
export function parseRoom(room: string): ParsedRoom | null {
  const sos = ESTATE_SOS.exec(room);
  if (sos?.[1]) return { kind: 'sos', estateId: sos[1] };

  const security = ESTATE_SECURITY.exec(room);
  if (security?.[1]) return { kind: 'security', estateId: security[1] };

  const gate = ESTATE_GATE.exec(room);
  if (gate?.[1] && gate[2]) return { kind: 'gate', estateId: gate[1], gateId: gate[2] };

  const dashboard = ESTATE_DASHBOARD.exec(room);
  if (dashboard?.[1]) return { kind: 'dashboard', estateId: dashboard[1] };

  const channel = ESTATE_CHANNEL.exec(room);
  if (channel?.[1] && channel[2]) {
    return { kind: 'channel', estateId: channel[1], channelId: channel[2] };
  }

  return null;
}

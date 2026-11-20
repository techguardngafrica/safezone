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

/** Parses a client-requested Socket.IO room name into a typed target (ids lowercased), or null. */
export function parseRoom(room: string): ParsedRoom | null {
  const sos = ESTATE_SOS.exec(room);
  if (sos?.[1]) return { kind: 'sos', estateId: sos[1].toLowerCase() };

  const security = ESTATE_SECURITY.exec(room);
  if (security?.[1]) return { kind: 'security', estateId: security[1].toLowerCase() };

  const gate = ESTATE_GATE.exec(room);
  if (gate?.[1] && gate[2]) {
    return { kind: 'gate', estateId: gate[1].toLowerCase(), gateId: gate[2].toLowerCase() };
  }

  const dashboard = ESTATE_DASHBOARD.exec(room);
  if (dashboard?.[1]) return { kind: 'dashboard', estateId: dashboard[1].toLowerCase() };

  const channel = ESTATE_CHANNEL.exec(room);
  if (channel?.[1] && channel[2]) {
    return {
      kind: 'channel',
      estateId: channel[1].toLowerCase(),
      channelId: channel[2].toLowerCase(),
    };
  }

  return null;
}

/**
 * The one spelling of a room (lowercase ids). Publishers build rooms from database ids, which are
 * lowercase, so a client must join this form to receive anything.
 */
export function canonicalRoom(room: ParsedRoom): string {
  const estate = `estate:${room.estateId}`;
  switch (room.kind) {
    case 'gate':
      return `${estate}:gate:${room.gateId}`;
    case 'channel':
      return `${estate}:channel:${room.channelId}`;
    default:
      return `${estate}:${room.kind}`;
  }
}

/**
 * Who may join an estate room (backend-api.md §12), from the permissions the user holds through staff
 * roles in that estate. Residents get no estate-wide rooms; channel rooms are checked by membership.
 */
export function staffMayJoin(
  kind: Exclude<ParsedRoom['kind'], 'channel'>,
  staffPermissions: ReadonlySet<string>,
): boolean {
  switch (kind) {
    case 'sos':
      return staffPermissions.has('sos.respond');
    case 'security':
    case 'gate':
      return staffPermissions.has('visitor.log.read') || staffPermissions.has('gate.verify');
    case 'dashboard':
      return (
        staffPermissions.has('sos.respond') ||
        staffPermissions.has('visitor.log.read') ||
        staffPermissions.has('report.read')
      );
  }
}

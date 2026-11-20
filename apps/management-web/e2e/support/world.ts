import type { ApiSession } from './api';
import type { SeededUser } from './seed';

/** Data set-up through the real API, shared by the flows. */

export async function createUnit(api: ApiSession, estateId: string, code: string): Promise<string> {
  const unit = await api.post<{ id: string }>(`/v1/estates/${estateId}/spaces`, {
    type: 'unit',
    code,
    unitType: 'house',
    bedrooms: 3,
  });
  return unit.id;
}

/** Moves `resident` into the unit as the household head; returns the household id. */
export async function moveIn(
  api: ApiSession,
  estateId: string,
  spaceId: string,
  resident: SeededUser,
  type: 'tenant' | 'owner_occupier' = 'tenant',
): Promise<string> {
  const household = await api.post<{ id: string }>(`/v1/estates/${estateId}/occupancies`, {
    spaceId,
    type,
    head: { fullName: resident.fullName, phone: resident.phone },
  });
  return household.id;
}

export async function createGate(api: ApiSession, estateId: string, name = 'Main Gate') {
  return (await api.post<{ id: string }>(`/v1/estates/${estateId}/gates`, { name, type: 'both' }))
    .id;
}

/** ISO time `minutes` from now. */
export const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** YYYY-MM-DD in Africa/Lagos, `days` from today. */
export function lagosDate(days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

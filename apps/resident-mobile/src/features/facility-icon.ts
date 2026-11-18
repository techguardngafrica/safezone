import type { IconName } from '../components/icon';
import type { Facility } from './facilities';

export const FACILITY_ICON: Record<Facility['type'], IconName> = {
  event_hall: 'business-outline',
  pool: 'water-outline',
  gym: 'barbell-outline',
  court: 'tennisball-outline',
  guest_house: 'bed-outline',
  parking: 'car-outline',
  other: 'grid-outline',
};

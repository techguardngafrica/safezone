import { Redirect } from 'expo-router';
import { useResident } from '../src/lib/resident';

/** Residents with an estate go to the tabs; everyone else joins an estate first. */
export default function Index() {
  const { estateId } = useResident();
  return <Redirect href={estateId ? '/home' : '/join'} />;
}

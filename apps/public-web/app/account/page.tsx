import type { Metadata } from 'next';
import { Account } from './account';

export const metadata: Metadata = {
  title: 'Your account',
  description: 'Sign in to register your estate or follow your application.',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <Account />;
}

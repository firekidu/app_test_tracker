import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import TrackerApp from '@/components/TrackerApp';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const u = await getUser();
  if (!u) redirect('/login');
  if (u.mustChangePassword) redirect('/account/password');
  return <TrackerApp />;
}

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import ActivityLog from '@/components/ActivityLog';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  const u = await getUser();
  if (!u) redirect('/login');
  if (u.mustChangePassword) redirect('/account/password');
  return <ActivityLog />;
}

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import AdminApp from '@/components/AdminApp';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const u = await getUser();
  if (!u) redirect('/login');
  if (u.mustChangePassword) redirect('/account/password');
  if (u.role !== 'admin') redirect('/');
  return <AdminApp me={{ username: u.username, displayName: u.displayName }} />;
}

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const u = await getUser();
  if (u) redirect(u.mustChangePassword ? '/account/password' : '/');
  return <LoginForm />;
}

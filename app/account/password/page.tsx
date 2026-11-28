import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import { config } from '@/lib/config';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';
import PasswordForm from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function PasswordPage() {
  const u = await getUser();
  if (!u) redirect('/login');
  return <PasswordForm forced={u.mustChangePassword} minLength={Math.max(MIN_PASSWORD_LENGTH, config().PASSWORD_MIN_LENGTH)} name={u.displayName} />;
}

import type { User } from '@supabase/supabase-js';

export function isAdminUser(user: Pick<User, 'email' | 'app_metadata' | 'identities'> | null | undefined, adminEmails: string[]): boolean {
  if (!user || !isGoogleUser(user)) return false;
  const google = user.identities?.find(i => i.provider === 'google');
  const data = (google?.identity_data || {}) as Record<string, unknown>;
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (!email || data.email_verified === false) return false;
  return adminEmails.includes(email);
}

export function isGoogleUser(user: Pick<User, 'app_metadata' | 'identities'>): boolean {
  const providers: string[] = (user.app_metadata?.providers as string[]) || [user.app_metadata?.provider as string];
  return providers.includes('google') || Boolean(user.identities?.some(i => i.provider === 'google'));
}

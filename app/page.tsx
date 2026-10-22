import { currentUser } from '@/lib/supabase/server';
import { isGoogleUser } from '@/lib/server/auth';
import { App } from '@/components/App';
import { SignIn } from '@/components/SignIn';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  let signedIn = false;
  try {
    const user = await currentUser();
    signedIn = Boolean(user && isGoogleUser(user));
  } catch {}
  const q = await searchParams;
  return signedIn ? <App /> : <SignIn loginError={Boolean(q.login_error)} />;
}

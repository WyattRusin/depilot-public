'use client';
import { useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { APP_LINKS } from '@/lib/app-config';
import { Google } from './icons';
import { Wordmark } from './Logo';
import { DemoItem } from './Demo';

export function SignIn({ loginError }: { loginError?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loginError ? 'Google sign-in didn’t finish. Try again.' : '');

  const signIn = async () => {
    setBusy(true);
    setError('');
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: 'select_account' } },
    });
    if (error) { setError(error.message); setBusy(false); }
  };

  return (
    <div className="signin">
      <header><Wordmark /></header>
      <main className="signin-main">
        <div>
          <h1>Your Depop listings, written and priced from a few photos.</h1>
          <div className="signin-go">
            <button type="button" className="btn btn-pri" onClick={signIn} disabled={busy}>
              {busy ? <span className="spin" /> : <Google />}
              {busy ? 'Opening Google' : 'Continue with Google'}
            </button>
            {error && <p className="signin-err" role="alert">{error}</p>}
          </div>
        </div>
        <DemoItem className="signin-card" />
      </main>
      <footer className="signin-foot">
        <span>Free · 50 items a month</span>
        <nav>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          {APP_LINKS.contactEmail && <a href={`mailto:${APP_LINKS.contactEmail}`}>Contact</a>}
        </nav>
      </footer>
    </div>
  );
}

import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, serverEnv } from '@/lib/env';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}

export function supabaseAdmin() {
  const { supabaseSecret } = serverEnv();
  if (!supabaseSecret) throw new Error('SUPABASE_SECRET_KEY is not set');
  return createClient(SUPABASE_URL, supabaseSecret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

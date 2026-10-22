import 'server-only';
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { currentUser } from '../supabase/server';
import { serverEnv } from '../env';
import { pipelineConfigFromEnv } from '../pricing/pipeline';
import { supabaseRepo } from './repo';
import { ApiError, type Deps } from './service';
import { isGoogleUser, isAdminUser } from './auth';
export { isGoogleUser, isAdminUser };

export function buildDeps(user?: User | null): Deps {
  const env = serverEnv();
  return {
    repo: supabaseRepo(), pipeline: pipelineConfigFromEnv(env),
    limits: { monthly: env.monthlyLimit }, budgetCents: env.monthlyBudgetCents,
    admin: isAdminUser(user, env.adminEmails),
  };
}

export function withUser<C>(handler: (ctx: { user: User; deps: Deps; req: Request; params: C }) => Promise<unknown>) {
  return async (req: Request, context: { params: Promise<C> }) => {
    try {
      const user = await currentUser();
      if (!user) return NextResponse.json({ error: 'Please sign in' }, { status: 401 });
      if (!isGoogleUser(user)) return NextResponse.json({ error: 'Please sign in with Google' }, { status: 403 });
      const params = context?.params ? await context.params : ({} as C);
      const body = await handler({ user, deps: buildDeps(user), req, params });
      return NextResponse.json(body);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
      }
      console.error('[api]', (err as Error)?.message);
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

const MAX_BODY = 64 * 1024;

export async function readJson(req: Request) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY) throw new ApiError(413, 'Request too large');
  let text: string;
  try { text = await req.text(); } catch { throw new ApiError(400, 'Invalid request body'); }
  if (text.length > MAX_BODY) throw new ApiError(413, 'Request too large');
  try { return text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, 'Invalid request body'); }
}

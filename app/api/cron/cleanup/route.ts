import { NextResponse } from 'next/server';
import { buildDeps } from '@/lib/server/route';
import { cleanupPhotos } from '@/lib/server/service';
import { serverEnv } from '@/lib/env';

export const maxDuration = 120;

export async function GET(req: Request) {
  const secret = serverEnv().cronSecret;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await cleanupPhotos(buildDeps()));
  } catch (err) {
    console.error('[cleanup]', (err as Error).message);
    return NextResponse.json({ error: 'cleanup failed' }, { status: 500 });
  }
}

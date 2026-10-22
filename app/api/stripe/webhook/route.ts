import { NextResponse } from 'next/server';
import { handleWebhook, packsEnabled } from '@/lib/server/billing';
import { supabaseRepo } from '@/lib/server/repo';

export async function POST(req: Request) {
  if (!packsEnabled()) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const signature = req.headers.get('stripe-signature') || '';
  try {
    const result = await handleWebhook(await req.text(), signature, supabaseRepo());
    return NextResponse.json(result);
  } catch (err) {
    console.error('[stripe webhook]', (err as Error).message);
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
}

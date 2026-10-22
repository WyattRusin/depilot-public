import 'server-only';
import Stripe from 'stripe';
import { serverEnv } from '../env.ts';
import type { Repo } from './types.ts';

export const PACKS = [
  { id: 'p50', listings: 50, cents: 500 },
  { id: 'p100', listings: 100, cents: 1000 },
  { id: 'p200', listings: 200, cents: 2000 },
] as const;

export function packsEnabled() {
  const e = serverEnv();
  return Boolean(e.packsEnabled && e.stripeSecret && e.stripeWebhookSecret);
}

function stripe() {
  return new Stripe(serverEnv().stripeSecret);
}

export async function createCheckout(user: { id: string; email?: string | null }, packId: string) {
  const e = serverEnv();
  const pack = PACKS.find(p => p.id === packId);
  if (!pack) throw new Error('Unknown pack');
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: pack.cents,
        product_data: { name: `Depilot: ${pack.listings} listings`, description: 'Used after your free listings. Never expire.' },
      },
    }],
    customer_email: user.email || undefined,
    client_reference_id: user.id,
    metadata: { user_id: user.id, credits: String(pack.listings), pack: pack.id },
    success_url: `${e.siteUrl}/?topup=success`,
    cancel_url: `${e.siteUrl}/?topup=cancelled`,
  });
  return session.url;
}

export async function handleWebhook(rawBody: string, signature: string, repo: Repo) {
  const event = stripe().webhooks.constructEvent(rawBody, signature, serverEnv().stripeWebhookSecret);
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return { handled: false };
  }
  const s = event.data.object as Stripe.Checkout.Session;
  if (s.payment_status !== 'paid') return { handled: false };
  const userId = s.metadata?.user_id || s.client_reference_id;
  const credits = Number(s.metadata?.credits || 0);
  if (!userId || !credits) return { handled: false };
  const credited = await repo.addCredits(userId, s.id, credits, s.amount_total || 0);
  return { handled: true, credited };
}

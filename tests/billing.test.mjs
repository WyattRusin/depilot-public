import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.PAID_PACKS_ENABLED = 'true';
const { handleWebhook, packsEnabled, PACKS } = await import('../lib/server/billing.ts');

function signed(event) {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' });
  return { payload, header };
}
const session = (over = {}) => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {
  id: 'cs_123', payment_status: 'paid', amount_total: 100, client_reference_id: 'user-1', metadata: { user_id: 'user-1', credits: '20' }, ...over } } });

test('a paid checkout adds credits exactly once', async () => {
  const credited = [];
  const repo = { async addCredits(u, s, c, a) { if (credited.some(x => x.s === s)) return false; credited.push({ u, s, c, a }); return true; } };
  assert.equal(packsEnabled(), true);
  const { payload, header } = signed(session());
  assert.deepEqual(await handleWebhook(payload, header, repo), { handled: true, credited: true });
  assert.deepEqual(await handleWebhook(payload, header, repo), { handled: true, credited: false });
  assert.deepEqual(credited, [{ u: 'user-1', s: 'cs_123', c: 20, a: 100 }]);
});

test('a forged webhook is rejected', async () => {
  const repo = { async addCredits() { throw new Error('should not be called'); } };
  const { payload } = signed(session());
  await assert.rejects(handleWebhook(payload, 't=1,v1=forged', repo));
  const tampered = payload.replace('"20"', '"9999"');
  const { header } = signed(session());
  await assert.rejects(handleWebhook(tampered, header, repo));
});

test('unpaid sessions do not add credits', async () => {
  const repo = { async addCredits() { throw new Error('should not be called'); } };
  const { payload, header } = signed(session({ payment_status: 'unpaid' }));
  assert.deepEqual(await handleWebhook(payload, header, repo), { handled: false });
});

test('packs are 10 cents a listing', () => {
  assert.deepEqual(PACKS.map(p => [p.listings, p.cents]), [[50, 500], [100, 1000], [200, 2000]]);
  for (const p of PACKS) assert.equal(p.cents / p.listings, 10);
});

test('packs stay off unless PAID_PACKS_ENABLED is exactly "true"', () => {
  for (const v of ['', 'false', '1', 'TRUE ']) {
    process.env.PAID_PACKS_ENABLED = v;
    assert.equal(packsEnabled(), false, JSON.stringify(v));
  }
  process.env.PAID_PACKS_ENABLED = 'true';
  delete process.env.STRIPE_SECRET_KEY;
  assert.equal(packsEnabled(), false, 'needs the Stripe key too');
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
});

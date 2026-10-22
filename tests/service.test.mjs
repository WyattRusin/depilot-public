import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as svc from '../lib/server/service.ts';
import { DEPOP_CATEGORIES } from '../lib/depop/data.ts';

const TEE = DEPOP_CATEGORIES.find(c => c.startsWith('Men >> Tops >> T-shirts'));
const JEANS = DEPOP_CATEGORIES.find(c => c.startsWith('Men >> Bottoms >> Jeans'));
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const uuid = (n) => `11111111-2222-4333-8444-${String(n).padStart(12, '0')}`;

function memoryRepo() {
  const profiles = new Map(), listings = new Map(), usage = [], payments = new Set();
  const removed = [];
  const now = () => new Date().toISOString();
  let ticks = 0;
  const tick = () => new Date(Date.now() + ++ticks).toISOString();
  const repo = {
    removed, listings, usage,
    async getProfile(id) { return profiles.get(id) || null; },
    async updateProfile(id, patch) {
      const p = { id, email: null, full_name: null, avatar_url: null, location: 'United States', currency: 'USD',
        domestic_shipping: null, intl_shipping: null, bonus_credits: 0, ...(profiles.get(id) || {}), ...patch };
      profiles.set(id, p); return p;
    },
    spend: [],
    cleanupMarked: [],
    async usageCounts(u) {
      const mine = usage.filter(x => x.user === u && !x.paid);
      return { used_today: mine.length, used_month: mine.length + (repo.olderThisMonth?.[u] || 0) };
    },
    async consumeListing(u, daily, monthly, listing) {
      const p = profiles.get(u) || (await repo.updateProfile(u, {}));
      const { used_today, used_month } = await repo.usageCounts(u);
      if (used_today < daily && used_month < monthly) {
        usage.push({ user: u, paid: false, listing });
        return { ok: true, reason: '', used_today: used_today + 1, used_month: used_month + 1, bonus_credits: p.bonus_credits, paid: false };
      }
      if (p.bonus_credits > 0) {
        p.bonus_credits--; usage.push({ user: u, paid: true, listing });
        return { ok: true, reason: '', used_today, used_month, bonus_credits: p.bonus_credits, paid: true };
      }
      return { ok: false, reason: used_month >= monthly ? 'monthly' : 'daily', used_today, used_month, bonus_credits: 0, paid: false };
    },
    async refundAnalysis(u, listing) {
      const i = usage.findLastIndex(x => x.user === u && x.listing === listing);
      if (i >= 0) { const [x] = usage.splice(i, 1); if (x.paid) profiles.get(u).bonus_credits++; }
    },
    async monthSpendCents() { return repo.spend.reduce((a, x) => a + x.cents, 0); },
    async logSpend(e) { repo.spend.push(e); },
    events: [],
    async logEvent(u, kind) { repo.events.push({ user_id: u, kind, created_at: now() }); },
    async hasEvent(u, kind) { return repo.events.some(e => e.user_id === u && e.kind === kind); },
    async adminSnapshot(since) {
      return {
        profiles: [...profiles.values()].map(p => ({ id: p.id, email: p.email, created_at: p.created_at || now() })),
        listings: [...listings.values()].filter(l => l.created_at >= since).map(l => ({
          id: l.id, user_id: l.user_id, status: l.status, created_at: l.created_at, error: l.error, price: l.price,
          title: l.ai?.title ?? null, confidence: l.pricing?.confidenceLabel ?? null,
          cost: l.pricing?.debug?.totalCents ?? null, sourceErrors: l.pricing?.errors ?? null,
          failure: l.pricing?.debug?.analysis?.failed ?? null,
        })),
        spend: repo.spend.map(s => ({ ...s, created_at: now() })),
        interest: repo.events.filter(e => e.kind === 'interest'),
      };
    },
    async listForCleanup(exportedBefore, createdBefore) {
      return [...listings.values()].filter(r => !r.photos_deleted_at &&
        ((r.exported_at && r.exported_at < exportedBefore) || r.created_at < createdBefore)).map(r => structuredClone(r));
    },
    async markPhotosDeleted(ids) { for (const id of ids) { const r = listings.get(id); if (r) r.photos_deleted_at = now(); } repo.cleanupMarked.push(...ids); },
    async addCredits(u, s, c) { if (payments.has(s)) return false; payments.add(s); profiles.get(u).bonus_credits += c; return true; },
    async insertListing(r) { const row = { created_at: now(), updated_at: now(), ai: null, fields: null, description: null, price: null, pricing: null, exported_at: null, error: null, photos_deleted_at: null, rewrites: 0, ...r }; listings.set(r.id, row); return row; },
    async getListing(u, id) { const r = listings.get(id); return r && r.user_id === u ? structuredClone(r) : null; },
    async listListings(u) { return [...listings.values()].filter(r => r.user_id === u).map(r => structuredClone(r)); },
    async updateListing(u, id, patch) { const r = listings.get(id); if (!r || r.user_id !== u) throw new Error('nope'); Object.assign(r, patch, { updated_at: tick() }); return structuredClone(r); },
    async updateListingIf(u, id, patch, expect) {
      const r = listings.get(id); if (!r || r.user_id !== u || r.updated_at !== expect) return null;
      Object.assign(r, patch, { updated_at: tick() }); return structuredClone(r);
    },
    async deleteListing(u, id) { const r = listings.get(id); if (r && r.user_id === u) listings.delete(id); },
    async markExported(u, ids) { for (const id of ids) { const r = listings.get(id); if (r && r.user_id === u) r.exported_at = now(); } },
    async downloadPhoto(p) { return { base64: Buffer.from(p).toString('base64'), mimeType: 'image/jpeg' }; },
    async removePhotos(paths) { removed.push(...paths); },
    moves: [], failMove: null,
    slots: new Map(),
    async takeSlot(u, key, limit) { const k = `${u}:${key}`; const n = (repo.slots.get(k) || 0) + 1; repo.slots.set(k, n); return n <= limit; },
    async releaseSlot(u, key) { repo.slots.delete(`${u}:${key}`); },
    async pruneRateLimits() {},
    orphans: [],
    async orphanPhotos() { return repo.orphans; },
    async movePhoto(from, to) {
      if (repo.failMove && repo.failMove(from, to)) throw new Error('storage said no');
      repo.moves.push([from, to]);
    },
    publicUrl(p) { return `https://proj.supabase.co/storage/v1/object/public/photos/${p}`; },
  };
  return repo;
}

const AI = {
  title: 'Vintage 90s Levi\'s 501 Jeans Blue 32x30', opener: '90s levis 501s', details: ['button fly'], fit: 'true to size',
  conditionNote: 'light fade', tags: ['#levis', '#501', '#vintage', '#denim', '#90s'], evidence: ['red tab'], flaws: [], notVisible: [],
  dating: { era: '90s (90s)', confidence: 'tag', basis: ['care tag'] }, age: '90s (90s)', datingNote: '90s', marketNote: 'steady',
  condition: 'Used - Good (used_good)', brand: "Levi's", brandRaw: "Levi's", size: '32x30', color1: 'Blue (blue)', style1: 'Casual (casual)',
  searchQuery: "Levi's 501 vintage 90s", suggestedPrice: 45, itemType: 'jeans',
};

function deps(over = {}) {
  const repo = memoryRepo();
  const calls = { analyze: 0, price: 0, rewrite: 0 };
  return {
    repo, calls, limits: { monthly: 3 }, budgetCents: 7500,
    pipeline: { geminiKey: 'AIzaSECRETKEY123456789', visionModels: [], fastModels: [], webModel: '', ebay: { clientId: '', clientSecret: '' }, openWebNinjaKey: '' },
    analyze: async (cfg, images, currency) => {
      calls.analyze++;
      cfg.meter?.add('vision', 2);
      assert.equal(images.length > 0, true);
      return { ai: structuredClone(AI), category: JEANS, brand: "Levi's (levi-s)", imageComps: [{ source: 'ebay_image', title: 'x', price: 50, currency: 'USD', status: 'listed' }], model: 'm', timings: {}, errors: [] };
    },
    rewrite: async (cfg, ai, facts) => {
      calls.rewrite++;
      cfg.meter?.add('rewrite', 0.2);
      ai.opener = `rewritten for ${facts.brand}`;
    },
    price: async (cfg, a, currency) => {
      calls.price++;
      cfg.meter?.add('judge', 1);
      assert.equal(a.imageComps.length, 1, 'image comps carried from step A to step B');
      return { price: 55, low: 45, high: 65, currency, confidence: 80, confidenceLabel: 'High', basis: 'sold', summary: 's', soldCount: 6, listedCount: 2, comps: [], rejectedCount: 3, aiPrice: 45, steps: [], sources: {} };
    },
    ...over,
  };
}

const paths = (user, id, n = 2) => Array.from({ length: n }, (_, i) => `${user}/${id}/${i}.jpg`);

test('upload -> description -> price, one use spent', async () => {
  const d = deps();
  const r = await svc.createListing(d, A, { id: uuid(1), photoPaths: paths(A, uuid(1)) });
  assert.equal(r.listing.status, 'pricing');
  assert.match(r.listing.description, /^Vintage 90s Levi's 501/);
  assert.equal(r.listing.fields.brand, "Levi's (levi-s)");
  assert.equal(r.listing.fields.size, '32"');
  assert.equal(r.listing.fields.photoUrls[0], `https://proj.supabase.co/storage/v1/object/public/photos/${A}/${uuid(1)}/0.jpg`);
  assert.equal(r.listing.pricing.imageComps, undefined, 'internal comps never sent to the browser');
  assert.deepEqual([r.usage.month, r.usage.left], [1, 2]);
  assert.equal(r.usage.today, undefined, 'no daily limit');
  assert.equal(r.listing.thumbs[0], `https://proj.supabase.co/storage/v1/object/public/photos/${A}/${uuid(1)}/0_t.jpg`);
  assert.equal(r.listing.pricing.timings, undefined, 'internal timings never sent to the browser');
  assert.equal(r.listing.pricing.steps, undefined);
  assert.equal(d.repo.spend.length, 1, 'cost of the upload is logged');
  assert.equal(d.repo.spend[0].cents, 2);

  const p = await svc.priceListing(d, A, uuid(1));
  assert.equal(p.listing.status, 'ready');
  assert.equal(p.listing.price, 55);
  assert.equal(p.listing.fields.price, 55);
  assert.equal(p.listing.validation.valid, true, JSON.stringify(p.listing.validation));
});

test('a retried upload is not charged twice', async () => {
  const d = deps();
  const body = { id: uuid(2), photoPaths: paths(A, uuid(2)) };
  await svc.createListing(d, A, body);
  const again = await svc.createListing(d, A, body);
  assert.equal(again.usage.month, 1);
  assert.equal(d.calls.analyze, 1);
});

test('photo paths must be in the user\'s own folder for this listing', async () => {
  const d = deps();
  await assert.rejects(svc.createListing(d, A, { id: uuid(3), photoPaths: paths(B, uuid(3)) }), { status: 400 });
  await assert.rejects(svc.createListing(d, A, { id: uuid(3), photoPaths: [`${A}/${uuid(3)}/../x.jpg`] }), { status: 400 });
  await assert.rejects(svc.createListing(d, A, { id: 'nope', photoPaths: [] }), { status: 400 });
  await assert.rejects(svc.createListing(d, A, { id: uuid(3), photoPaths: paths(A, uuid(3), 9) }), { status: 400 });
});

test('monthly limit, then paid credits (when packs are on), then blocked', async () => {
  const d = deps();
  for (let i = 10; i < 13; i++) await svc.createListing(d, A, { id: uuid(i), photoPaths: paths(A, uuid(i)) });
  const blocked = await svc.createListing(d, A, { id: uuid(13), photoPaths: paths(A, uuid(13)) }).catch(e => e);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.extra.code, 'monthly');
  assert.match(blocked.message, /this month's 3 free listings/);
  assert.equal(d.repo.listings.has(uuid(13)), false, 'blocked listing removed');
  assert.ok(d.repo.removed.includes(`${A}/${uuid(13)}/0.jpg`), 'its photos removed');

  await d.repo.addCredits(A, 'cs_test', 2, 100);
  const paid = await svc.createListing(d, A, { id: uuid(14), photoPaths: paths(A, uuid(14)) });
  assert.equal(paid.usage.bonusCredits, 1);
  assert.equal(paid.usage.left, 1);
});

test('AI failure refunds the use and never leaks the API key', async () => {
  const d = deps({ analyze: async () => { throw new Error('API key AIzaSECRETKEY123456789 invalid, request timed out'); } });
  const err = await svc.createListing(d, A, { id: uuid(20), photoPaths: paths(A, uuid(20)) }).catch(e => e);
  assert.equal(err.status, 502);
  assert.ok(!JSON.stringify(err.extra).includes('AIzaSECRET'));
  assert.ok(!err.message.includes('AIzaSECRET'));
  assert.equal(err.extra.listing.status, 'error');
  assert.equal(err.extra.usage.month, 0, 'refunded');
  assert.ok(!/AIza|timed out|API key/.test(err.message), 'only a plain message reaches the user');
});

test('pricing failure falls back to the AI estimate instead of erroring', async () => {
  const d = deps({ price: async () => { throw new Error('everything down'); } });
  await svc.createListing(d, A, { id: uuid(21), photoPaths: paths(A, uuid(21)) });
  const p = await svc.priceListing(d, A, uuid(21));
  assert.equal(p.listing.status, 'ready');
  assert.equal(p.listing.price, 45);
  assert.equal(p.listing.pricing.basis, 'estimate');
});

test('a price the seller typed is kept when the price is re-checked; one re-check only', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(30), photoPaths: paths(A, uuid(30)) });
  await svc.priceListing(d, A, uuid(30));
  await svc.editListing(d, A, uuid(30), { price: 70 });
  const again = await svc.priceListing(d, A, uuid(30));
  assert.equal(again.listing.price, 70);
  assert.equal(again.listing.pricing.price, 55, 'suggestion still shown');
  assert.equal(again.listing.pricing.recheckLeft, 0);
  await assert.rejects(svc.priceListing(d, A, uuid(30)), { status: 429 });
});

test('edits are validated against Depop\'s lists', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(40), photoPaths: paths(A, uuid(40)) });
  await assert.rejects(svc.editListing(d, A, uuid(40), { brand: 'Totally Fake Brand Xyz' }), { status: 400 });
  await assert.rejects(svc.editListing(d, A, uuid(40), { condition: 'Mint' }), { status: 400 });
  await assert.rejects(svc.editListing(d, A, uuid(40), { price: -5 }), { status: 400 });
  const r = await svc.editListing(d, A, uuid(40), { brand: 'carhartt wip', category: TEE, size: 'xl' });
  assert.equal(r.listing.fields.brand, 'Carhartt WIP (carhartt-wip)');
  assert.equal(r.listing.fields.category, TEE);
  assert.equal(r.listing.fields.size, 'XL');
  const c = await svc.editListing(d, A, uuid(40), { brand: '' });
  assert.equal(c.listing.fields.brand, '');
  const o = await svc.editListing(d, A, uuid(40), { brand: 'Other (unbranded)' });
  assert.equal(o.listing.fields.brand, '');
});

test('an item with no brand exports as Depop\'s "Other (unbranded)" and pricing never searches "Other"', async () => {
  let pricedWith = null, rewroteWith = null;
  const d = deps({
    price: async (cfg, item, currency) => { pricedWith = item.brand; return { price: 55, low: 45, high: 65, currency, confidence: 80, confidenceLabel: 'High', basis: 'sold', summary: 's', soldCount: 6, listedCount: 2, comps: [], rejectedCount: 3, aiPrice: 45, steps: [], sources: {} }; },
    rewrite: async (cfg, ai, facts) => { rewroteWith = facts.brand; },
  });
  await svc.createListing(d, A, { id: uuid(45), photoPaths: paths(A, uuid(45)) });
  await svc.editListing(d, A, uuid(45), { brand: 'Other (unbranded)' });
  await svc.priceListing(d, A, uuid(45));
  assert.equal(pricedWith, '');
  await svc.rewriteListing(d, A, uuid(45));
  assert.equal(rewroteWith, '');
  const ex = await svc.exportCsv(d, A, [uuid(45)]);
  assert.deepEqual(ex.included, [uuid(45)]);
  const cells = ex.files[0].csv.split('\r\n')[3].split(',');
  assert.ok(cells.includes('Other (unbranded)'));
});

test('users can never see or touch each other\'s listings', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(50), photoPaths: paths(A, uuid(50)) });
  await assert.rejects(svc.priceListing(d, B, uuid(50)), { status: 404 });
  await assert.rejects(svc.editListing(d, B, uuid(50), { price: 1 }), { status: 404 });
  await svc.removeListing(d, B, uuid(50));
  assert.ok(d.repo.listings.has(uuid(50)), 'B cannot delete A\'s listing');
  assert.equal((await svc.listListings(d, B)).listings.length, 0);
  const ex = await svc.exportCsv(d, B, [uuid(50)]);
  assert.equal(ex.files.length, 0);
});

test('export uses current settings, skips unfinished items, marks exported', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(60), photoPaths: paths(A, uuid(60)) });
  await svc.priceListing(d, A, uuid(60));
  await svc.createListing(d, A, { id: uuid(61), photoPaths: paths(A, uuid(61)) });
  await svc.saveSettings(d, A, { location: 'United Kingdom', currency: 'GBP', domesticShipping: '4.5' });
  const ex = await svc.exportCsv(d, A, [uuid(60), uuid(61)]);
  assert.equal(ex.files.length, 1);
  assert.deepEqual(ex.included, [uuid(60)]);
  assert.equal(ex.rejected[0].id, uuid(61));
  assert.ok(ex.rejected[0].errors.some(e => /price/i.test(e)));
  const row = ex.files[0].csv.split('\r\n')[3];
  assert.ok(row.includes(',United Kingdom,'));
  assert.ok(row.includes(',4.5,'));
  assert.ok(d.repo.listings.get(uuid(60)).exported_at);
});

test('settings are validated', async () => {
  const d = deps();
  await assert.rejects(svc.saveSettings(d, A, { location: 'Narnia' }), { status: 400 });
  await assert.rejects(svc.saveSettings(d, A, { currency: 'BTC' }), { status: 400 });
  await assert.rejects(svc.saveSettings(d, A, { domesticShipping: 'free' }), { status: 400 });
  const me = await svc.saveSettings(d, A, { domesticShipping: '' , currency: 'EUR' });
  assert.equal(me.settings.domesticShipping, null);
  assert.equal(me.settings.currency, 'EUR');
  assert.equal(me.usage.monthlyLimit, 3);
});

test('no daily limit: listings made earlier this month count, today alone does not', async () => {
  const d = deps();
  d.repo.olderThisMonth = { [A]: 2 };
  const ok = await svc.createListing(d, A, { id: uuid(70), photoPaths: paths(A, uuid(70)) });
  assert.equal(ok.usage.month, 3);
  assert.equal(ok.usage.left, 0);
  const err = await svc.createListing(d, A, { id: uuid(71), photoPaths: paths(A, uuid(71)) }).catch(e => e);
  assert.equal(err.status, 429);
  assert.equal(err.extra.code, 'monthly');
});

test('the monthly budget pauses new uploads but not editing or exporting', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(80), photoPaths: paths(A, uuid(80)) });
  await svc.priceListing(d, A, uuid(80));
  d.repo.spend.push({ user_id: null, kind: 'other', cents: 7500 });
  const me = await svc.getMe(d, { id: A });
  assert.equal(me.usage.paused, true);
  const err = await svc.createListing(d, A, { id: uuid(81), photoPaths: paths(A, uuid(81)) }).catch(e => e);
  assert.equal(err.status, 503);
  assert.equal(err.extra.code, 'paused');
  assert.equal(d.calls.analyze, 1, 'no AI call once paused');
  await assert.rejects(svc.priceListing(d, A, uuid(80)), { status: 503 }, 're-checks pause too');
  await assert.rejects(svc.rewriteListing(d, A, uuid(80)), { status: 503 });
  const e = await svc.editListing(d, A, uuid(80), { price: 60 });
  assert.equal(e.listing.price, 60);
  const ex = await svc.exportCsv(d, A, [uuid(80)]);
  assert.equal(ex.files.length, 1);
});

test('update description uses the edited details, at most 3 times', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(90), photoPaths: paths(A, uuid(90)) });
  await svc.editListing(d, A, uuid(90), { brand: 'carhartt wip' });
  const r = await svc.rewriteListing(d, A, uuid(90));
  assert.match(r.listing.description, /rewritten for Carhartt WIP/);
  assert.equal(r.listing.fields.description, r.listing.description);
  assert.equal(r.listing.rewritesLeft, 2);
  await svc.rewriteListing(d, A, uuid(90));
  await svc.rewriteListing(d, A, uuid(90));
  await assert.rejects(svc.rewriteListing(d, A, uuid(90)), { status: 429 });
  assert.equal(d.calls.rewrite, 3);
  await assert.rejects(svc.rewriteListing(d, B, uuid(90)), { status: 404 });
});

test('a brand suggestion is shown, and cleared once the seller picks a brand', async () => {
  const d = deps({ price: async (cfg, a, currency) => ({
    price: 30, low: 25, high: 35, currency, confidence: 70, confidenceLabel: 'Medium', basis: 'sold', summary: 's',
    soldCount: 4, listedCount: 0, comps: [], rejectedCount: 0, aiPrice: 30, steps: ['internal'], sources: {},
    brandSuggestion: { name: 'Carhartt WIP', depopBrand: 'Carhartt WIP (carhartt-wip)', count: 4, of: 5 },
  }) });
  await svc.createListing(d, A, { id: uuid(95), photoPaths: paths(A, uuid(95)) });
  const p = await svc.priceListing(d, A, uuid(95));
  assert.equal(p.listing.pricing.brandSuggestion.depopBrand, 'Carhartt WIP (carhartt-wip)');
  const e = await svc.editListing(d, A, uuid(95), { brand: 'Carhartt WIP (carhartt-wip)' });
  assert.equal(e.listing.pricing.brandSuggestion, null);
  assert.equal(e.listing.fields.brand, 'Carhartt WIP (carhartt-wip)');
});

test('photo cleanup: 30 days after export, 90 after upload; removed items can\'t be exported', async () => {
  const d = deps();
  for (const n of [100, 101, 102]) {
    await svc.createListing(d, A, { id: uuid(n), photoPaths: paths(A, uuid(n)) });
    await svc.priceListing(d, A, uuid(n));
  }
  const DAY = 86_400_000;
  const t = Date.now();
  d.repo.listings.get(uuid(100)).exported_at = new Date(t - 31 * DAY).toISOString();
  d.repo.listings.get(uuid(101)).created_at = new Date(t - 91 * DAY).toISOString();
  d.repo.listings.get(uuid(102)).exported_at = new Date(t - 5 * DAY).toISOString();

  const r = await svc.cleanupPhotos(d, t);
  assert.equal(r.listings, 2);
  assert.deepEqual(d.repo.cleanupMarked.sort(), [uuid(100), uuid(101)].sort());
  assert.ok(d.repo.removed.includes(`${A}/${uuid(100)}/0.jpg`));
  assert.ok(d.repo.removed.includes(`${A}/${uuid(100)}/0_t.jpg`), 'thumbnails go too');
  assert.ok(!d.repo.removed.some(x => x.includes(uuid(102))));

  const { listings } = await svc.listListings(d, A);
  const gone = listings.find(l => l.id === uuid(100));
  assert.equal(gone.photosRemoved, true);
  assert.deepEqual(gone.photos, []);
  const ex = await svc.exportCsv(d, A, [uuid(100), uuid(102)]);
  assert.deepEqual(ex.included, [uuid(102)]);
  assert.match(ex.rejected[0].errors[0], /30 days/);

  const again = await svc.cleanupPhotos(d, t);
  assert.equal(again.listings, 0, 'never cleaned twice');
});

test('bootstrap returns the account and listings in one go', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(110), photoPaths: paths(A, uuid(110)) });
  const b = await svc.bootstrap(d, { id: A, email: 'a@example.com' });
  assert.equal(b.me.id, A);
  assert.equal(b.me.usage.monthlyLimit, 3);
  assert.equal(b.me.usage.dailyLimit, undefined);
  assert.equal(b.listings.length, 1);
});

test('admins: no monthly limit, no run limits, a Debug view, and web prices switched on', async () => {
  let cfgSeen;
  const d = deps({ admin: true, price: async (cfg, a, currency) => {
    cfgSeen = cfg;
    cfg.meter?.add('judge', 1);
    return { price: 40, low: 35, high: 45, currency, confidence: 60, confidenceLabel: 'Medium', basis: 'sold', summary: 's',
      soldCount: 3, listedCount: 0, comps: [], rejectedCount: 1, aiPrice: 45, steps: ['step one'], sources: { ebay_sold: 3 },
      judged: [{ title: 'Same tee', price: 40, currency, source: 'ebay_sold', status: 'sold', match: 'same' },
               { title: 'Other tee', price: 99, currency, source: 'ebay_sold', status: 'sold', match: 'different' }],
      queries: { exact: 'q', broad: '', web: true } };
  } });
  for (let i = 200; i < 205; i++) await svc.createListing(d, A, { id: uuid(i), photoPaths: paths(A, uuid(i)) });
  const me = await svc.getMe(d, { id: A });
  assert.equal(me.usage.admin, true);
  assert.equal(me.usage.left, 999);
  assert.equal(d.repo.usage.length, 0, 'admin uploads are not counted');

  for (let i = 0; i < 4; i++) await svc.priceListing(d, A, uuid(200));
  for (let i = 0; i < 4; i++) await svc.rewriteListing(d, A, uuid(200));
  assert.equal(cfgSeen.webPrices, true, 'admin gets the Google Search price source');

  const { listing } = await svc.editListing(d, A, uuid(200), {});
  const dbg = listing.debug;
  assert.ok(dbg, 'admin sees debug');
  assert.equal(dbg.priceRuns.length, 4);
  assert.equal(dbg.priceRuns[3].judged.length, 2, 'rejected comps kept for debugging');
  assert.equal(dbg.rewrites.length, 4);
  assert.ok(Math.abs(dbg.totalCents - (2 + 4 * 1 + 4 * 0.2)) < 1e-9, `total ${dbg.totalCents}`);
  assert.equal(dbg.analysis.model, 'm');
  assert.equal(listing.pricing.judged, undefined, 'judged list stays out of the normal pricing data');

  d.repo.spend.push({ user_id: null, kind: 'other', cents: 99999 });
  await svc.createListing(d, A, { id: uuid(206), photoPaths: paths(A, uuid(206)) });
});

test('normal users never receive debug data, even for the same listing', async () => {
  const admin = deps({ admin: true });
  await svc.createListing(admin, A, { id: uuid(210), photoPaths: paths(A, uuid(210)) });
  const normal = { ...admin, admin: false };
  const { listing } = await svc.editListing(normal, A, uuid(210), {});
  assert.equal(listing.debug, undefined);
  assert.ok(!JSON.stringify(listing).includes('totalCents'));
  assert.equal(listing.pricing.recheckLeft, 2);
  assert.equal(listing.rewritesLeft, 3);
  const me = await svc.getMe(normal, { id: A });
  assert.equal(me.usage.admin, false);
});

test('"I\'d use more" is recorded once per user and shows on the admin page', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(220), photoPaths: paths(A, uuid(220)) });
  const r1 = await svc.registerInterest(d, A);
  await svc.registerInterest(d, A);
  assert.equal(r1.usage.askedForMore, true);
  assert.equal(d.repo.events.length, 1, 'only once');
  assert.equal(d.repo.spend.filter(s => s.kind === 'interest').length, 0, 'never counted as spend');

  await assert.rejects(svc.adminStats(d), { status: 404 }, 'non-admins cannot load stats');
  const stats = await svc.adminStats({ ...d, admin: true });
  assert.equal(stats.interest.length, 1);
  assert.equal(stats.listings.thisMonth, 1);
  assert.equal(stats.topUsers[0].listings, 1);
  assert.equal(stats.topUsers[0].wantsMore, true);
  assert.ok(stats.spentCents > 0);
});

test('a failed upload keeps the technical reason for admins only', async () => {
  const d = deps({ admin: true, analyze: async () => { throw new Error('Gemini x (500): backend exploded AIzaSECRETKEY123456789'); } });
  const err = await svc.createListing(d, A, { id: uuid(230), photoPaths: paths(A, uuid(230)) }).catch(e => e);
  assert.match(err.extra.listing.debug.analysis.failed, /backend exploded/);
  assert.ok(!err.extra.listing.debug.analysis.failed.includes('AIzaSECRET'), 'key redacted');
  assert.doesNotMatch(err.message, /exploded/, 'user message stays plain');
});

test('measurements: shown on the listing, in the description, and editable without losing edits', async () => {
  const d = deps({ analyze: async () => ({
    ai: { ...structuredClone(AI), measurements: [{ name: 'waist', value: '16', unit: 'in' }] },
    category: JEANS, brand: "Levi's (levi-s)", imageComps: [], model: 'm', timings: {}, errors: [],
  }) });
  const { listing } = await svc.createListing(d, A, { id: uuid(300), photoPaths: paths(A, uuid(300)) });
  assert.deepEqual(listing.measurements, [{ name: 'waist', value: '16', unit: 'in' }]);
  assert.match(listing.description, /measurements: waist 16"/);

  await svc.editListing(d, A, uuid(300), { description: listing.description.replace('90s levis 501s', 'my own words') });
  const e = await svc.editListing(d, A, uuid(300), { measurements: [{ name: 'waist', value: '15.5', unit: 'in' }, { name: 'inseam', value: '30', unit: 'in' }] });
  assert.match(e.listing.description, /measurements: waist 15\.5" · inseam 30"/);
  assert.match(e.listing.description, /my own words/, 'seller edits kept');
  assert.equal(e.listing.fields.description, e.listing.description);
  assert.equal(e.listing.measurements.length, 2);

  const r = await svc.rewriteListing(d, A, uuid(300));
  assert.match(r.listing.description, /measurements: waist 15\.5" · inseam 30"/, 'update description keeps the edited measurements');
});

test('appearance: light by default, saved per account, validated', async () => {
  const d = deps();
  const me = await svc.getMe(d, { id: A });
  assert.equal(me.settings.theme, 'light');
  const dark = await svc.saveSettings(d, A, { theme: 'dark' });
  assert.equal(dark.settings.theme, 'dark');
  assert.equal((await svc.getMe(d, { id: A })).settings.theme, 'dark');
  await assert.rejects(svc.saveSettings(d, A, { theme: 'neon' }), { status: 400 });
});

test('title: editable, kept as the first line of the description, and follows description edits', async () => {
  const d = deps();
  await svc.createListing(d, A, { id: uuid(70), photoPaths: paths(A, uuid(70)) });
  let r = await svc.editListing(d, A, uuid(70), { title: '  Levi\'s 501 jeans,   mid wash ' });
  assert.equal(r.listing.title, "Levi's 501 jeans, mid wash");
  assert.match(r.listing.description, /^Levi's 501 jeans, mid wash\n/);
  r = await svc.editListing(d, A, uuid(70), { description: r.listing.description.replace(/^[^\n]+/, 'Levis 501 straight leg') });
  assert.equal(r.listing.title, 'Levis 501 straight leg', 'renaming the first line renames the item');
  await assert.rejects(svc.editListing(d, A, uuid(70), { title: '   ' }), { status: 400 });
});

test('photos: add to an empty slot, retake in place, remove; never another user\'s path', async () => {
  const d = deps();
  const id = uuid(71);
  await svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`] });
  let r = await svc.editPhotos(d, A, id, { add: `${A}/${id}/1-tag.jpg` });
  assert.equal(r.listing.photos.length, 2);
  assert.equal(r.listing.fields.photoUrls.length, 2, 'CSV photo links follow');
  r = await svc.editPhotos(d, A, id, { add: `${A}/${id}/1-tag-b.jpg`, remove: `${A}/${id}/1-tag.jpg` });
  assert.match(r.listing.photos[1], /1-tag-b\.jpg$/, 'retake keeps the slot position');
  assert.ok(d.repo.removed.includes(`${A}/${id}/1-tag.jpg`), 'old photo deleted from storage');
  r = await svc.editPhotos(d, A, id, { remove: `${A}/${id}/1-tag-b.jpg` });
  assert.equal(r.listing.photos.length, 1);
  await assert.rejects(svc.editPhotos(d, A, id, { remove: `${A}/${id}/0-front.jpg` }), { status: 400 }, 'last photo stays');
  await assert.rejects(svc.editPhotos(d, A, id, { add: `${B}/${id}/2.jpg` }), { status: 400 });
  await assert.rejects(svc.editPhotos(d, B, id, { add: `${B}/${id}/2.jpg` }), { status: 404 });
});

test('try again: a failed read is re-run on the same photos; a stuck one is not charged twice', async () => {
  let fail = true;
  const d = deps({ analyze: async (cfg) => { if (fail) throw new Error('timed out'); cfg.meter?.add('vision', 1); return { ai: structuredClone(AI), category: JEANS, brand: "Levi's (levi-s)", imageComps: [{ source: 'ebay_image', title: 'x', price: 50, currency: 'USD', status: 'listed' }], model: 'm', timings: {}, errors: [] }; } });
  await assert.rejects(svc.createListing(d, A, { id: uuid(72), photoPaths: paths(A, uuid(72)) }), { status: 502 });
  assert.equal((await svc.usage(d, A)).month, 0, 'failure refunded');
  fail = false;
  const r = await svc.retryListing(d, A, uuid(72));
  assert.equal(r.listing.status, 'pricing');
  assert.equal(r.usage.month, 1, 'charged once for the successful read');

  await d.repo.insertListing({ id: uuid(73), user_id: A, photo_paths: paths(A, uuid(73)), status: 'analyzing' });
  await d.repo.consumeListing(A, 3, 3, uuid(73));
  d.repo.listings.get(uuid(73)).created_at = new Date(Date.now() - 600_000).toISOString();
  const s = await svc.retryListing(d, A, uuid(73));
  assert.equal(s.listing.status, 'pricing');
  assert.equal(s.usage.month, 2, 'stuck item: still one listing, not two');

  await d.repo.insertListing({ id: uuid(74), user_id: A, photo_paths: paths(A, uuid(74)), status: 'analyzing' });
  const t = await svc.retryListing(d, A, uuid(74));
  assert.equal(t.listing.status, 'analyzing');
});

const AI_PHOTOS = (roles) => ({ ...structuredClone(AI), photos: roles.map((role, i) => ({ photo: i + 1, role, fullItem: role === 'front' || role === 'back' })) });
const shuffled = (id) => [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-back.jpg`, `${A}/${id}/2-tag.jpg`];
const seen = (images) => images.map(i => Buffer.from(i.base64, 'base64').toString().split('/').pop());

test('arrange: library photos are sorted before the read, renamed, and labelled for the AI', async () => {
  let got;
  const d = deps({
    arrange: async (cfg, thumbs) => {
      cfg.meter?.add('arrange', 0.05);
      assert.deepEqual(seen(thumbs), ['0-front_t.jpg', '1-back_t.jpg', '2-tag_t.jpg'], 'the quick sort uses the small copies');
      return [{ photo: 1, role: 'tag', fullItem: false, quality: 3 }, { photo: 2, role: 'front', fullItem: true, quality: 3 }, { photo: 3, role: 'back', fullItem: true, quality: 2 }];
    },
    analyze: async (cfg, images, currency, labels) => {
      got = { images: seen(images), labels };
      return { ai: structuredClone(AI), category: JEANS, brand: "Levi's (levi-s)", imageComps: [{ source: 'ebay_image', title: 'x', price: 50, currency: 'USD', status: 'listed' }], model: 'm', timings: {}, errors: [] };
    },
  });
  const id = uuid(80);
  const r = await svc.createListing(d, A, { id, photoPaths: shuffled(id), arrange: true });
  assert.deepEqual(got.images, ['1-back.jpg', '2-tag.jpg', '0-front.jpg'], 'the read sees front, back, tag');
  assert.deepEqual(got.labels, ['Photo 1 (front):', 'Photo 2 (back):', 'Photo 3 (brand tag):']);
  const names = r.listing.photos.map(u => u.split('/').pop());
  assert.match(names[0], /^0-front-[a-z0-9]+\.jpg$/);
  assert.match(names[1], /^1-back-[a-z0-9]+\.jpg$/);
  assert.match(names[2], /^2-tag-[a-z0-9]+\.jpg$/);
  assert.deepEqual(r.listing.fields.photoUrls, r.listing.photos, 'the Depop file follows the new order');
  assert.equal(d.repo.moves.length, 6, 'each photo and its small copy renamed');
  assert.equal(d.repo.moves[0][0], `${A}/${id}/1-back.jpg`, 'the old "back" slot held the front');
  assert.ok(Math.abs(d.repo.spend[0].cents - 0.05) < 1e-9, 'the quick sort is costed with the upload');
});

test('arrange: without arrange, photos keep their order and labels; no sorting call', async () => {
  let called = false, labels;
  const d = deps({
    arrange: async () => { called = true; return null; },
    analyze: async (cfg, images, currency, l) => { labels = l; return { ai: structuredClone(AI), category: JEANS, brand: "Levi's (levi-s)", imageComps: [{ source: 'ebay_image', title: 'x', price: 50, currency: 'USD', status: 'listed' }], model: 'm', timings: {}, errors: [] }; },
  });
  const id = uuid(81);
  const r = await svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-measure.jpg`] });
  assert.equal(called, false);
  assert.deepEqual(labels, ['Photo 1 (front):', 'Photo 2 (tape measure):']);
  assert.match(r.listing.photos[0], /0-front\.jpg$/);
  assert.equal(d.repo.moves.length, 0);
});

test('arrange: if the quick sort fails, the main read\'s photo catalogue sorts them instead', async () => {
  const d = deps({
    arrange: async () => { throw new Error('quota'); },
    analyze: async () => ({ ai: AI_PHOTOS(['measure', 'front', 'tag']), category: JEANS, brand: "Levi's (levi-s)", imageComps: [{ source: 'ebay_image', title: 'x', price: 50, currency: 'USD', status: 'listed' }], model: 'm', timings: {}, errors: [] }),
  });
  const id = uuid(82);
  const r = await svc.createListing(d, A, { id, photoPaths: shuffled(id), arrange: true });
  const names = r.listing.photos.map(u => u.split('/').pop());
  assert.match(names[0], /^0-front-/);
  assert.match(names[1], /^1-tag-/);
  assert.match(names[2], /^2-measure-/);
  assert.equal(r.listing.status, 'pricing', 'the upload still succeeds');
});

test('arrange: a failed rename puts back what moved and keeps the seller\'s order', async () => {
  const d = deps({
    arrange: async () => [{ photo: 1, role: 'tag', fullItem: false, quality: 3 }, { photo: 2, role: 'front', fullItem: true, quality: 3 }, { photo: 3, role: 'back', fullItem: true, quality: 3 }],
  });
  let n = 0;
  d.repo.failMove = (from) => !from.endsWith('_t.jpg') && ++n === 2;
  const id = uuid(83);
  const r = await svc.createListing(d, A, { id, photoPaths: shuffled(id), arrange: true });
  assert.deepEqual(r.listing.photos.map(u => u.split('/').pop()), ['0-front.jpg', '1-back.jpg', '2-tag.jpg']);
  const forward = d.repo.moves.filter(([from]) => /\/\d-(front|back|tag)(_t)?\.jpg$/.test(from));
  assert.ok(forward.length >= 1, 'some photos had moved before the failure');
  for (const [from, to] of forward) {
    assert.ok(d.repo.moves.some(([a, b]) => a === to && b === from), `${from} was moved back`);
  }
});

test('arrange: the admin debug view records how the order was decided', async () => {
  const d = deps({ admin: true, arrange: async () => [{ photo: 1, role: 'back', fullItem: true, quality: 2 }, { photo: 2, role: 'front', fullItem: true, quality: 3 }] });
  const id = uuid(84);
  const r = await svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-back.jpg`], arrange: true });
  assert.deepEqual(r.listing.debug.analysis.arranged.roles, ['front', 'back']);
  assert.equal(r.listing.debug.analysis.arranged.by, 'quick');
  assert.equal(r.listing.debug.analysis.arranged.moved, true);
});

test('make cover: any photo can be moved to the front', async () => {
  const d = deps();
  const id = uuid(85);
  await svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-back.jpg`, `${A}/${id}/2-tag.jpg`] });
  const r = await svc.editPhotos(d, A, id, { cover: `${A}/${id}/1-back.jpg` });
  assert.deepEqual(r.listing.photos.map(u => u.split('/').pop()), ['1-back.jpg', '0-front.jpg', '2-tag.jpg']);
  assert.deepEqual(r.listing.fields.photoUrls, r.listing.photos);
  await assert.rejects(svc.editPhotos(d, A, id, { cover: `${A}/${id}/9-front.jpg` }), { status: 400 });
});

test('arrange: "Try again" after a failed read still sorts the photos', async () => {
  let fail = true, sorted = 0;
  const d = deps({
    arrange: async () => { sorted++; return [{ photo: 1, role: 'tag', fullItem: false, quality: 3 }, { photo: 2, role: 'front', fullItem: true, quality: 3 }]; },
    analyze: async () => { if (fail) throw new Error('timed out'); return { ai: structuredClone(AI), category: JEANS, brand: "Levi's (levi-s)", imageComps: [{ source: 'ebay_image', title: 'x', price: 50, currency: 'USD', status: 'listed' }], model: 'm', timings: {}, errors: [] }; },
  });
  const id = uuid(87);
  await assert.rejects(svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-back.jpg`], arrange: true }), { status: 502 });
  fail = false;
  const r = await svc.retryListing(d, A, id);
  assert.equal(sorted, 2, 'sorted again on the retry');
  assert.match(r.listing.photos[0], /0-front-[a-z0-9]+\.jpg$/);
});

test('arrange: if saving the new order fails, the photos are put back', async () => {
  const d = deps({ arrange: async () => [{ photo: 1, role: 'tag', fullItem: false, quality: 3 }, { photo: 2, role: 'front', fullItem: true, quality: 3 }] });
  const update = d.repo.updateListing;
  let n = 0;
  d.repo.updateListing = async (u, id, patch) => { if (patch.photo_paths && Object.keys(patch).length === 1 && ++n === 1) throw new Error('db blip'); return update(u, id, patch); };
  const id = uuid(88);
  const r = await svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-back.jpg`], arrange: true });
  assert.deepEqual(r.listing.photos.map(u => u.split('/').pop()), ['0-front.jpg', '1-back.jpg'], 'database and storage agree');
  for (const [from, to] of d.repo.moves.filter(([f]) => /\/\d-(front|back)(_t)?\.jpg$/.test(f))) {
    assert.ok(d.repo.moves.some(([a, b]) => a === to && b === from), `${from} put back`);
  }
  assert.equal(r.listing.status, 'pricing', 'the upload itself still succeeds');
});

test('pricing writes on top of edits made while it ran (cover, details)', async () => {
  const d = deps();
  const id = uuid(89);
  await svc.createListing(d, A, { id, photoPaths: [`${A}/${id}/0-front.jpg`, `${A}/${id}/1-back.jpg`] });
  const price = d.price;
  d.price = async (...args) => {
    await svc.editPhotos(d, A, id, { cover: `${A}/${id}/1-back.jpg` });
    await svc.editListing(d, A, id, { size: '34x32' });
    return price(...args);
  };
  const r = await svc.priceListing(d, A, id);
  assert.match(r.listing.fields.photoUrls[0], /1-back\.jpg$/, 'the CSV keeps the new cover');
  assert.match(r.listing.photos[0], /1-back\.jpg$/);
  assert.equal(r.listing.fields.price, 55);
});

test('delete several: own items only, photos removed, items still being read are skipped', async () => {
  const d = deps();
  for (const n of [90, 91, 92]) await svc.createListing(d, A, { id: uuid(n), photoPaths: paths(A, uuid(n)) });
  await d.repo.insertListing({ id: uuid(93), user_id: A, photo_paths: paths(A, uuid(93)), status: 'analyzing' });
  await svc.createListing(d, B, { id: uuid(94), photoPaths: paths(B, uuid(94)) });
  const r = await svc.removeListings(d, A, { ids: [uuid(90), uuid(91), uuid(93), uuid(94), 'nope'] });
  assert.deepEqual(r.deleted.sort(), [uuid(90), uuid(91), uuid(94)].sort(), "another user's id reads as already gone, and is untouched");
  assert.deepEqual(r.skipped, [uuid(93)]);
  assert.equal(d.repo.listings.has(uuid(90)), false);
  assert.equal(d.repo.listings.has(uuid(92)), true);
  assert.equal(d.repo.listings.has(uuid(94)), true, "B's item survives");
  assert.ok(d.repo.removed.includes(`${A}/${uuid(90)}/0.jpg`) && d.repo.removed.includes(`${A}/${uuid(90)}/0_t.jpg`));
  await assert.rejects(svc.removeListings(d, A, { ids: [] }), { status: 400 });
});

test('overlapping saves never undo each other: an edit made while pricing runs survives', async () => {
  const d = deps();
  const id = uuid(120);
  await svc.createListing(d, A, { id, photoPaths: paths(A, id) });
  const price = d.price;
  d.price = async (...args) => { await svc.editListing(d, A, id, { size: '34x32', brand: "Levi's" }); return price(...args); };
  const r = await svc.priceListing(d, A, id);
  assert.equal(r.listing.fields.price, 55, 'the new price is saved');
  assert.equal(r.listing.status, 'ready');
  assert.equal(r.listing.fields.brand, "Levi's (levi-s)", 'and so is the brand the seller set meanwhile');
});

test('overlapping saves: a price set while the description is rewritten reaches the CSV', async () => {
  const d = deps();
  const id = uuid(121);
  await svc.createListing(d, A, { id, photoPaths: paths(A, id) });
  await svc.priceListing(d, A, id);
  const rewrite = d.rewrite;
  d.rewrite = async (...args) => { await svc.editListing(d, A, id, { price: 99 }); return rewrite(...args); };
  const r = await svc.rewriteListing(d, A, id);
  assert.equal(r.listing.price, 99);
  assert.equal(r.listing.fields.price, 99, 'the export uses the seller\'s price, not the stale one');
  assert.match(r.listing.description, /rewritten/);
});

test('a paid action can only run once at a time per item', async () => {
  const d = deps();
  const id = uuid(122);
  await svc.createListing(d, A, { id, photoPaths: paths(A, id) });
  let release;
  const price = d.price;
  d.price = async (...args) => { await new Promise(r => { release = r; }); return price(...args); };
  const first = svc.priceListing(d, A, id);
  await new Promise(r => setTimeout(r, 5));
  await assert.rejects(svc.priceListing(d, A, id), { status: 429 }, 'second click while the first runs');
  release();
  await first;
  assert.equal(d.calls.price, 1, 'paid for once');
});

test('"Try again" with the budget paused or no listings left keeps the item', async () => {
  let fail = true;
  const d = deps({ analyze: async () => { if (fail) throw new Error('timed out'); return { ai: structuredClone(AI), category: JEANS, brand: "Levi's (levi-s)", imageComps: [], model: 'm', timings: {}, errors: [] }; } });
  const id = uuid(123);
  await assert.rejects(svc.createListing(d, A, { id, photoPaths: paths(A, id) }), { status: 502 });
  fail = false;
  d.budgetCents = 0;
  await assert.rejects(svc.retryListing(d, A, id), { status: 503 });
  assert.ok(d.repo.listings.has(id), 'still there');
  d.budgetCents = 7500;
  d.limits.monthly = 0;
  await assert.rejects(svc.retryListing(d, A, id), { status: 429 });
  assert.ok(d.repo.listings.has(id), 'still there');
  assert.equal(d.repo.removed.length, 0, 'photos untouched');
});

test('an item still being read can\'t be deleted (its read would bring it back)', async () => {
  const d = deps();
  await d.repo.insertListing({ id: uuid(124), user_id: A, photo_paths: paths(A, uuid(124)), status: 'analyzing' });
  await assert.rejects(svc.removeListing(d, A, uuid(124)), { status: 409 });
});

test('input limits: huge brand, size or emoji-cut text are refused or trimmed safely', async () => {
  const d = deps();
  const id = uuid(125);
  await svc.createListing(d, A, { id, photoPaths: paths(A, id) });
  await assert.rejects(svc.editListing(d, A, id, { brand: 'zqx '.repeat(20000) }), { status: 400 });
  await assert.rejects(svc.editListing(d, A, id, { size: 'x'.repeat(40) }), { status: 400 });
  const r = await svc.editListing(d, A, id, { description: 'a'.repeat(1999) + '😀😀' });
  assert.ok(!/[\uD800-\uDBFF]$/.test(r.listing.description), 'no half emoji at the cut');
  const b = await svc.editListing(d, A, id, { brand: 'Academy Brand (academy-brand)' });
  assert.equal(b.listing.fields.brand, 'Academy Brand (academy-brand)', 'an exact list entry is kept as is');
});

test('clearing the price hands it back to the price check', async () => {
  const d = deps();
  const id = uuid(126);
  await svc.createListing(d, A, { id, photoPaths: paths(A, id) });
  await svc.editListing(d, A, id, { price: 40 });
  const r = await svc.editListing(d, A, id, { price: null });
  const p = await svc.priceListing(d, A, id);
  assert.equal(p.listing.price, 55, 'the re-check fills it again');
  assert.equal(r.listing.price, null);
});

test('nightly cleanup also removes uploads that never became an item', async () => {
  const d = deps();
  d.repo.orphans = [`${A}/${uuid(127)}/0-front.jpg`, `${A}/${uuid(127)}/0-front_t.jpg`];
  const r = await svc.cleanupPhotos(d);
  assert.equal(r.orphans, 2);
  assert.ok(d.repo.removed.includes(`${A}/${uuid(127)}/0-front_t.jpg`));
});

const env = process.env;
const results = [];
const ok = (name, detail) => results.push(['PASS', name, detail]);
const bad = (name, detail) => results.push(['FAIL', name, detail]);
const warn = (name, detail) => results.push(['WARN', name, detail]);

async function check(name, fn) {
  try { await fn(); } catch (e) { bad(name, e.message); }
}

await check('Supabase', async () => {
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !pub) return bad('Supabase', 'Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY');
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const t = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, { headers: h });
  if (t.status === 404 || t.status === 400) return bad('Supabase', 'Tables missing. Run supabase/schema.sql in the SQL Editor.');
  if (!t.ok) return bad('Supabase', `Database: HTTP ${t.status} ${await t.text()}`);
  const b = await fetch(`${url}/storage/v1/bucket/photos`, { headers: h });
  if (!b.ok) return bad('Supabase', 'Storage bucket "photos" missing. Re-run supabase/schema.sql.');
  const bucket = await b.json();
  if (!bucket.public) return bad('Supabase', 'Bucket "photos" must be public (Depop downloads photos by link).');
  const fn = await fetch(`${url}/rest/v1/rpc/month_spend_cents`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: '{}' });
  if (!fn.ok) return bad('Supabase', 'Limit and budget functions missing. Run supabase/migrations/002_depilot.sql in the SQL Editor.');
  ok('Supabase', `tables, photo bucket and limit functions found (estimated spend this month: $${((await fn.json()) / 100).toFixed(2)})`);
  if (!env.CRON_SECRET) console.log('  note: CRON_SECRET is not set here. Set it in Vercel so the nightly photo cleanup can run.');
});

await check('Gemini', async () => {
  if (!env.GEMINI_API_KEY) return bad('Gemini', 'Set GEMINI_API_KEY');
  const model = env.GEMINI_VISION_MODEL || 'gemini-3.8-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ready' }] }] }),
  });
  const d = await r.json();
  if (!r.ok) return bad('Gemini', `${model}: ${d.error?.message || r.status}`);
  ok('Gemini', `${model} answered "${(d.candidates?.[0]?.content?.parts || []).map(p => p.text).join('').trim().slice(0, 20)}"`);
});

await check('eBay', async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) return warn('eBay', 'Not set. Pricing still works, with fewer comps.');
  const basic = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString('base64');
  const t = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
  });
  const tok = await t.json();
  if (!t.ok) return bad('eBay', `Login failed: ${tok.error_description || tok.error}. Use the PRODUCTION keyset, not Sandbox.`);
  const s = await fetch('https://api.ebay.com/buy/browse/v1/item_summary/search?q=carhartt%20jacket&limit=3', {
    headers: { Authorization: `Bearer ${tok.access_token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  });
  const d = await s.json();
  if (!s.ok) return bad('eBay', `Search failed: ${d.errors?.[0]?.message || s.status}`);
  ok('eBay', `live search works (${d.total ?? d.itemSummaries?.length ?? 0} results for "carhartt jacket")`);
});

await check('OpenWeb Ninja (eBay sold prices)', async () => {
  if (!env.OPENWEBNINJA_API_KEY) return warn('OpenWeb Ninja (eBay sold prices)', 'Not set. Prices will rest on listings, not sales — less accurate.');
  const r = await fetch('https://api.openwebninja.com/real-time-ebay-data/search?' + new URLSearchParams({ query: 'carhartt detroit jacket', show_only: 'sold_items', domain: 'com', page: '1' }), {
    headers: { 'x-api-key': env.OPENWEBNINJA_API_KEY },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return bad('OpenWeb Ninja (eBay sold prices)', `HTTP ${r.status}: ${d.message || d.error?.message || JSON.stringify(d).slice(0, 120)}`);
  const products = d?.data?.products ?? d?.data ?? [];
  const withPrice = (Array.isArray(products) ? products : []).filter(p => p?.price);
  if (!withPrice.length) return bad('OpenWeb Ninja (eBay sold prices)', 'Connected, but no sold items came back. Sold data may be unavailable — tell Claude.');
  const sample = withPrice[0];
  const looksSold = withPrice.some(p => /sold/i.test(String(p.caption || p.sold_date || '')));
  (looksSold ? ok : warn)('OpenWeb Ninja (eBay sold prices)', `${withPrice.length} results, e.g. ${sample.price} ${sample.currency || ''} "${String(sample.title).slice(0, 50)}" ${sample.caption || ''}${looksSold ? '' : ' — no "Sold <date>" captions seen; check these are sold listings'}`);
  if (!looksSold) console.log('\nFirst result, for checking the shape:\n', JSON.stringify(withPrice[0], null, 2).slice(0, 800));
});

await check('Stripe', async () => {
  if (!env.STRIPE_SECRET_KEY) return warn('Stripe', 'Not set. The "get more" button shows "coming soon". Fine for launch.');
  const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) return bad('Stripe', `Key rejected (HTTP ${r.status})`);
  if (!env.STRIPE_WEBHOOK_SECRET) return bad('Stripe', 'STRIPE_WEBHOOK_SECRET missing, so payments would never add credits');
  ok('Stripe', `${env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'LIVE' : 'test'} mode key works`);
});

if (!env.NEXT_PUBLIC_SITE_URL || /localhost/.test(env.NEXT_PUBLIC_SITE_URL)) warn('Site URL', 'NEXT_PUBLIC_SITE_URL is localhost. Set it to your real domain on Vercel.');

console.log('');
for (const [s, n, d] of results) console.log(`${s === 'PASS' ? '✓' : s === 'WARN' ? '!' : '✗'} ${n.padEnd(34)} ${d}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(failed ? `\n${failed} problem(s) to fix.` : '\nAll set.');
process.exit(failed ? 1 : 0);

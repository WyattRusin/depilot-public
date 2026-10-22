import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeItem, priceItem } from '../lib/pricing/pipeline.ts';

const CFG = {
  geminiKey: 'AIzaFAKEKEY1234567890', visionModels: ['gemini-3.8-flash', 'gemini-3.5-flash'],
  fastModels: ['gemini-3.5-flash-lite'], webModel: 'gemini-3.8-flash',
  ebay: { clientId: 'ebay-id', clientSecret: 'ebay-secret' }, openWebNinjaKey: 'own-key',
};

const VISION = {
  evidence: ['neck tag reads SCREEN STARS BEST', 'single stitch hems', 'back print lists 1994 tour dates'],
  tagText: 'SCREEN STARS BEST', tagLegibility: 'clear',
  measurements: [{ readFrom: 'photo 2', name: 'Pit to Pit', value: '22', unit: 'in' }, { readFrom: 'photo 2', name: 'length', value: 'n/a', unit: 'in' }],
  notVisible: ['care label'], flaws: ['small hole near collar'],
  dating: { era: '90s (90s)', confidence: 'tag', basis: ['Screen Stars Best tag', 'single stitch'] },
  marketNote: 'band tee collectors', itemType: 'band t-shirt',
  searchQuery: 'Metallica 1994 tour shirt', broadQuery: 'Metallica tour shirt',
  title: 'Vintage 90s Metallica 1994 Tour Tee Black XL', opener: '1994 metallica tour tee',
  details: ['single stitch', 'tour dates on back'], fit: 'boxy xl', conditionNote: 'small hole near collar',
  tags: ['#metallica', '#bandtee', '#90s', '#grunge', '#vintage'],
  condition: 'Used - Good (used_good)', categoryGroup: 'Men >> Tops', brand: 'Screen Stars', size: 'XL',
  color1: 'Black (black)', style1: 'Grunge (grunge)', source1: 'Vintage (vintage)', suggestedPrice: 70,
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gem = (obj, extra = {}) => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, ...extra }], usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 900 } });

function installFetch({ soldFails = false, judgeFails = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body.startsWith('{') ? init.body : '{}') : {};
    calls.push({ url, init, body });

    if (url.includes('generativelanguage.googleapis.com')) {
      assert.equal(init.headers['x-goog-api-key'], CFG.geminiKey, 'Gemini key must travel in a header');
      assert.ok(!url.includes('key='), 'Gemini key must never be in the URL');
      const parts = body.contents[0].parts;
      const text = parts[0].text || '';
      if (body.systemInstruction) {
        assert.ok(body.contents[0].parts.some(p => p.inlineData), 'photos attached');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        return gem(VISION);
      }
      if (body.tools) {
        assert.deepEqual(body.tools, [{ google_search: {} }]);
        return gem({ results: [
          { site: 'Depop', title: 'Metallica 1994 tour tee XL', price: 95, currency: 'USD', status: 'sold', url: 'https://www.depop.com/products/a' },
          { site: 'Grailed', title: 'Vintage Metallica 1994 Tour T-shirt', price: 110, currency: 'USD', status: 'listed' },
          { site: 'Poshmark', title: 'Metallica 1994 tee', price: 20, currency: 'USD', status: 'sold' },
          { site: 'fakesite.com', title: 'Metallica 1994', price: 999, currency: 'USD', status: 'sold' },
          { site: 'Depop', title: 'Metallica 1994 tee', price: 80, currency: 'GBP', status: 'sold' },
        ] }, { groundingMetadata: { webSearchQueries: ['metallica 1994 tour shirt sold'], groundingChunks: [{ web: { uri: 'https://vertex/redirect/1', title: 'depop.com' } }, { web: { uri: 'https://vertex/redirect/2', title: 'grailed.com' } }] } });
      }
      if (text.includes('Pick the single most specific')) {
        const leaves = body.generationConfig.responseSchema.properties.category.enum;
        return gem({ category: leaves.find(l => l.includes('T-shirts')) });
      }
      if (text.includes('THE ITEM')) {
        if (judgeFails) return json({ error: { message: 'overloaded' } }, 503);
        const lines = parts.map(p => p.text || '').filter(l => /^\d+\./.test(l));
        calls.judgeImages = parts.filter(p => p.inlineData).length;
        return gem({ verdicts: lines.map(l => {
          const i = Number(l.split('.')[0]);
          const match = /1994/.test(l) && /metallica/i.test(l) ? 'same' : /metallica/i.test(l) ? 'similar' : 'different';
          return { i, match, brand: '' };
        }) });
      }
      throw new Error('unexpected Gemini call: ' + text.slice(0, 80));
    }
    if (url.includes('/identity/v1/oauth2/token')) return json({ access_token: 'tok', expires_in: 7200 });
    if (url.includes('search_by_image')) return json({ itemSummaries: [
      { title: 'Metallica 1994 Tour Shirt Vintage XL', price: { value: '120.00', currency: 'USD' }, itemWebUrl: 'https://ebay.com/itm/img1' },
      { title: 'Iron Maiden 1990 tee', price: { value: '90.00', currency: 'USD' }, itemWebUrl: 'https://ebay.com/itm/img2' },
    ] });
    if (url.includes('/item_summary/search?')) return json({ itemSummaries: [
      { title: 'Metallica 1994 tour t-shirt black', price: { value: '105.00', currency: 'USD' }, itemWebUrl: 'https://ebay.com/itm/a1' },
      { title: 'Metallica Master of Puppets reprint tee', price: { value: '25.00', currency: 'USD' }, itemWebUrl: 'https://ebay.com/itm/a2' },
    ] });
    if (url.includes('openwebninja')) {
      assert.equal(init.headers['x-api-key'], 'own-key');
      assert.match(url, /show_only=sold_items/);
      if (soldFails) return json({ message: 'server error' }, 500);
      return json({ status: 'OK', data: { products: [
        { title: 'Vintage Metallica 1994 Tour Shirt XL', price: 88, currency: 'USD', caption: 'Sold Sep 30, 2026' },
        { title: 'Metallica 1994 tour tee single stitch', price: 92, currency: 'USD', caption: 'Sold Sep 12, 2026' },
        { title: 'Metallica 1994 Summer Shit Tour shirt', price: 85, currency: 'USD', caption: 'Sold Aug 30, 2026' },
        { title: 'Metallica 1994 tour t shirt L', price: 99, currency: 'USD', caption: 'Sold Aug 2, 2026' },
        { title: 'Metallica 1994 tour shirt', price: 79, currency: 'USD', caption: 'Sold Jul 22, 2026' },
        { title: 'LOT of 3 Metallica shirts', price: 60, currency: 'USD' },
        { title: 'Metallica 2023 M72 tour tee', price: 30, currency: 'USD' },
        { title: 'Metallica 1994 Tour shirt', price: 89, currency: 'USD' },
        { title: 'Metallica 1994 tour', price: 95, currency: 'USD' },
      ] } });
    }
    throw new Error('unexpected fetch ' + url);
  };
  return calls;
}

const IMG = [{ base64: 'aGVsbG8=', mimeType: 'image/jpeg' }];

test('full flow: photos -> listing -> real price from sold comps', async () => {
  const calls = installFetch();
  const a = await analyzeItem(CFG, IMG, 'USD');
  assert.equal(a.brand, 'Screen Stars (screen-stars)');
  assert.match(a.category, /^Men >> Tops >> T-shirts/);
  assert.equal(a.ai.age, '90s (90s)');
  assert.equal(a.imageComps.length, 2);
  assert.equal(a.errors.length, 0);
  assert.deepEqual(a.ai.measurements, [{ name: 'pit to pit', value: '22', unit: 'in' }], 'unreadable values dropped');

  const vision = calls.find(c => c.body.systemInstruction);
  assert.ok(vision.body.contents[0].parts.some(p => /unconfirmed/i.test(p.text || '') && /Metallica 1994 Tour Shirt/.test(p.text)),
    'look-alike listing titles are passed to the vision model as unconfirmed hints');

  const p = await priceItem({ ...CFG, webPrices: true }, { ai: a.ai, brand: a.brand, imageComps: a.imageComps }, 'USD');
  assert.deepEqual(p.errors, []);
  assert.equal(p.basis, 'sold');
  assert.ok(p.price >= 80 && p.price <= 100, `price ${p.price}`);
  assert.ok(p.soldCount >= 6, `sold ${p.soldCount}`);
  assert.ok(!p.comps.some(c => /LOT of/i.test(c.title)), 'bundles excluded');
  assert.ok(!p.comps.some(c => /Iron Maiden|2023/.test(c.title)), 'non-matches excluded');
  const web = p.comps.filter(c => c.source === 'web');
  assert.ok(web.every(c => ['Depop', 'Grailed'].includes(c.site)), 'only grounded sites kept');
  assert.equal(p.sources.web, 2);
  console.log(`    -> ${p.summary} Price $${p.price} (${p.low}-${p.high}), confidence ${p.confidence} ${p.confidenceLabel}`);
  console.log(`    -> steps: ${p.steps.join(' | ')}`);
  assert.equal(calls.filter(c => c.url.includes('openwebninja')).length, 1, 'enough sold matches, so no second (broad) sold search');
  console.log(`    -> ${calls.length} outside calls`);
});

test('each photo reaches the AI numbered and labelled, right before the image', async () => {
  const calls = installFetch();
  const two = [IMG[0], { base64: 'd29ybGQ=', mimeType: 'image/jpeg' }];
  await analyzeItem(CFG, two, 'USD', ['Photo 1 (front):', 'Photo 2 (brand tag):']);
  const parts = calls.find(c => c.body.systemInstruction).body.contents[0].parts;
  const i = parts.findIndex(p => p.text === 'Photo 2 (brand tag):');
  assert.equal(parts[0].text, '2 photos of one item.');
  assert.equal(parts[1].text, 'Photo 1 (front):');
  assert.ok(parts[2].inlineData && parts[i + 1].inlineData?.data === 'd29ybGQ=', 'label sits right before its photo');
  await analyzeItem(CFG, IMG, 'USD');
  const plain = calls.filter(c => c.body.systemInstruction).at(-1).body.contents[0].parts;
  assert.equal(plain[1].text, 'Photo 1:', 'no label given: still numbered');
});

test('if eBay sold data is down, it still prices from the other sources', async () => {
  installFetch({ soldFails: true });
  const a = await analyzeItem(CFG, IMG, 'USD');
  const p = await priceItem(CFG, { ai: a.ai, brand: a.brand, imageComps: a.imageComps }, 'USD');
  assert.ok(p.errors.some(e => e.startsWith('ebay_sold')));
  assert.ok(p.price > 0);
  assert.notEqual(p.basis, 'none');
  console.log(`    -> without sold data: $${p.price}, ${p.confidenceLabel} (${p.basis})`);
});

test('if the AI judge fails, nothing unverified is trusted: AI estimate, Low', async () => {
  installFetch({ judgeFails: true });
  const a = await analyzeItem(CFG, IMG, 'USD');
  const p = await priceItem(CFG, { ai: a.ai, brand: a.brand, imageComps: a.imageComps }, 'USD');
  assert.equal(p.basis, 'estimate');
  assert.equal(p.price, 70);
  assert.equal(p.confidenceLabel, 'Low');
});

test('with no eBay or OpenWeb Ninja keys it still works on Gemini alone', async () => {
  const calls = installFetch();
  const cfg = { ...CFG, ebay: { clientId: '', clientSecret: '' }, openWebNinjaKey: '' };
  const a = await analyzeItem(cfg, IMG, 'USD');
  const p = await priceItem(cfg, { ai: a.ai, brand: a.brand, imageComps: a.imageComps }, 'USD');
  assert.ok(!calls.some(c => c.url.includes('ebay.com') || c.url.includes('openwebninja')));
  assert.ok(p.price > 0);
});

test('API keys are scrubbed from any error text', async () => {
  const { redact } = await import('../lib/pricing/http.ts');
  const msg = redact('API key AIzaFAKEKEY1234567890 not valid; Bearer abc.def.ghijkl; ?key=secret123', ['own-key-long-secret']);
  assert.ok(!msg.includes('AIzaFAKEKEY'));
  assert.ok(!msg.includes('abc.def'));
  assert.ok(!msg.includes('secret123'));
});

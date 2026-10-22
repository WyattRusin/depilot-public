import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recencyWeight } from '../lib/pricing/estimate.ts';
import { enforceEraRule, suggestBrand, judgeComps } from '../lib/pricing/judge.ts';
import { CostMeter } from '../lib/pricing/cost.ts';
import { generate, setBusyWait } from '../lib/pricing/gemini.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 9);
const ago = d => new Date(NOW - d * DAY).toDateString();

test('recent sales count more than old ones', () => {
  assert.equal(recencyWeight(undefined, NOW), 1);
  assert.equal(recencyWeight('not a date', NOW), 1);
  assert.equal(recencyWeight(`Sold ${ago(10)}`, NOW), 1);
  assert.equal(recencyWeight(ago(45), NOW), 0.85);
  assert.equal(recencyWeight(ago(80), NOW), 0.7);
  assert.equal(recencyWeight(ago(200), NOW), 0.55);
});

test('a modern item is never priced off "vintage" listings, and an original never off reprints', () => {
  const c = t => ({ title: t, price: 1, currency: 'USD', source: 'ebay_sold', status: 'sold' });
  assert.equal(enforceEraRule(c('Vintage 90s Backstock tee'), 'same', false), 'similar');
  assert.equal(enforceEraRule(c('Single stitch band tee'), 'same', false), 'similar');
  assert.equal(enforceEraRule(c('Backstock tee black L'), 'same', false), 'same');
  assert.equal(enforceEraRule(c('Band tee reprint'), 'same', true), 'different');
  assert.equal(enforceEraRule(c('Band tee 1994 original'), 'same', true), 'same');
  assert.equal(enforceEraRule(c('anything'), 'similar', false), 'similar', 'only "same" is ever changed');
});

test('a brand is suggested only when most matching listings agree', () => {
  const comp = (brand, match = 'same') => ({ title: 't', price: 1, currency: 'USD', source: 'ebay_sold', status: 'sold', match, brandNamed: brand });
  const s = suggestBrand([comp('Backstock Co'), comp('backstock co.'), comp('Backstock Co'), comp('Gildan'), comp('Brockum', 'similar')], '');
  assert.equal(s?.count, 3);
  assert.equal(s?.of, 4);
  assert.equal(suggestBrand([comp('A'), comp('A')], ''), null, 'two listings are not enough');
  assert.equal(suggestBrand([comp('A'), comp('A'), comp('B'), comp('B'), comp('C')], ''), null, 'no clear majority');
  assert.equal(suggestBrand([comp('Nike'), comp('Nike'), comp('Nike')], 'Nike (nike)'), null, 'already the brand');
});

test('cost meter adds up Gemini tokens (thinking billed as output) and flat fees', () => {
  const m = new CostMeter();
  m.gemini('vision', 'gemini-3.5-flash-lite', { input: 1_000_000, output: 0 });
  assert.ok(Math.abs(m.cents - 30) < 1e-9);
  m.gemini('judge', 'gemini-3.5-flash-lite', { input: 0, output: 500_000, thoughts: 500_000 });
  assert.ok(Math.abs(m.cents - 280) < 1e-9);
  m.add('sold', 0.5);
  m.add('bad', NaN);
  m.add('neg', -4);
  assert.ok(Math.abs(m.cents - 280.5) < 1e-9);
  assert.deepEqual(Object.keys(m.parts), ['vision', 'judge', 'sold']);
});

test('a busy model is retried once before falling back', async () => {
  setBusyWait(1);
  const seen = [];
  let n = 0;
  globalThis.fetch = async (url) => {
    seen.push(String(url).match(/models\/([^:]+)/)[1]);
    if (n++ === 0) return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }));
  };
  const meter = new CostMeter();
  const out = await generate({ apiKey: 'k', models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'], parts: [{ text: 'hi' }], meter, meterLabel: 'x' });
  assert.deepEqual(seen, ['gemini-3.8-flash', 'gemini-3.8-flash'], 'same model again, not the backup');
  assert.deepEqual(out.json, { ok: true });
  assert.ok(meter.cents > 0, 'usage is metered');
});

test('the judge sees the item photo and each listing photo next to its title', async () => {
  let body;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ verdicts: [
      { i: 0, match: 'same', brand: 'Backstock Co' }, { i: 1, match: 'same', brand: '' },
    ] }) }] } }] }));
  };
  const img = { mimeType: 'image/jpeg', data: 'AAAA' };
  const comps = [
    { title: 'Backstock Co skull tee', price: 30, currency: 'USD', source: 'ebay_sold', status: 'sold', image: 'https://i.ebayimg.com/a.jpg' },
    { title: 'Vintage single stitch skull tee', price: 90, currency: 'USD', source: 'ebay_sold', status: 'sold' },
  ];
  const item = { title: 'Skull tee', brand: '', itemType: 't-shirt', era: 'Modern', datedFrom: 'style', provenVintage: false, condition: 'Used', keyDetails: [] };
  const out = await judgeComps(item, comps, { apiKey: 'k', models: ['m'], itemImage: img, loadThumb: async () => img });
  const parts = body.contents[0].parts;
  const order = parts.map(p => (p.inlineData ? 'IMG' : p.text.startsWith('0.') ? 'L0' : p.text.startsWith('1.') ? 'L1' : p.text === 'Item photo:' ? 'ITEM' : 'TXT'));
  assert.deepEqual(order, ['TXT', 'ITEM', 'IMG', 'L0', 'IMG', 'L1']);
  assert.equal(body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
  assert.equal(out[0].match, 'same');
  assert.equal(out[0].brandNamed, 'Backstock Co');
  assert.equal(out[1].match, 'similar', '"vintage" listing capped for a modern item');
});

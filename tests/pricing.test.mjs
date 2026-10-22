import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePrice, weightedQuantile, roundToPricePoint, ASKING_TO_SALE } from '../lib/pricing/estimate.ts';
import { prefilter } from '../lib/pricing/judge.ts';
import { normalizeSold } from '../lib/pricing/sold.ts';
import { siteOf } from '../lib/pricing/web.ts';
import { extractJson } from '../lib/pricing/gemini.ts';

const sold = (price, match = 'same', extra = {}) => ({ source: 'ebay_sold', status: 'sold', title: 't', price, currency: 'USD', match, ...extra });
const listed = (price, match = 'same', source = 'ebay_active') => ({ source, status: 'listed', title: 't', price, currency: 'USD', match });
const GOOD = 'Used - Excellent (used_excellent)';

test('sold matches set the price (weighted median, rounded to a price point)', () => {
  const p = estimatePrice([sold(40), sold(45), sold(50), sold(55), sold(60)], { condition: GOOD, aiPrice: 20, currency: 'USD' });
  assert.equal(p.basis, 'sold');
  assert.equal(p.price, 50);
  assert.equal(p.soldCount, 5);
  assert.ok(p.confidence >= 55, `confidence ${p.confidence}`);
});

test('the AI estimate is ignored when the market has enough evidence', () => {
  const p = estimatePrice([sold(100), sold(110), sold(105)], { condition: GOOD, aiPrice: 30, currency: 'USD' });
  assert.equal(p.price, 110);
});

test('non-matches never move the price', () => {
  const base = [sold(40), sold(42), sold(44)];
  const noisy = [...base, sold(400, 'different'), sold(5, 'different'), listed(900, 'different')];
  assert.equal(estimatePrice(noisy, { condition: GOOD, currency: 'USD' }).price,
               estimatePrice(base, { condition: GOOD, currency: 'USD' }).price);
});

test('one crazy matched price is removed as an outlier', () => {
  const p = estimatePrice([sold(30), sold(32), sold(35), sold(33), sold(31), sold(500)], { condition: GOOD, currency: 'USD' });
  assert.equal(p.price, 30);
  assert.ok(!p.comps.some(c => c.price === 500));
});

test('asking prices are discounted to estimate a sale price', () => {
  const p = estimatePrice([listed(100), listed(100), listed(100), listed(100)], { condition: GOOD, currency: 'USD' });
  assert.equal(p.basis, 'market');
  assert.equal(p.price, roundToPricePoint(100 * ASKING_TO_SALE));
});

test('sold prices outweigh asking prices', () => {
  const p = estimatePrice([sold(50), sold(50), listed(120), listed(120)], { condition: GOOD, currency: 'USD' });
  assert.ok(p.price <= 60, `price ${p.price} should sit near the sold 50`);
});

test('condition adjusts the market price', () => {
  const comps = [sold(100), sold(100), sold(100)];
  assert.equal(estimatePrice(comps, { condition: 'Used - Fair (used_fair)', currency: 'USD' }).price, 75);
  assert.equal(estimatePrice(comps, { condition: 'Brand new (brand_new)', currency: 'USD' }).price, 120);
});

test('too little evidence falls back to the AI estimate, labelled Low', () => {
  const p = estimatePrice([sold(80)], { condition: GOOD, aiPrice: 63, currency: 'USD' });
  assert.equal(p.basis, 'estimate');
  assert.equal(p.price, 65);
  assert.equal(p.confidenceLabel, 'Low');
  const none = estimatePrice([], { condition: GOOD, aiPrice: null, currency: 'USD' });
  assert.equal(none.basis, 'none');
  assert.equal(none.price, null);
});

test('scattered prices give lower confidence than tight ones', () => {
  const tight = estimatePrice([40, 41, 42, 43, 44, 45].map(v => sold(v)), { condition: GOOD, currency: 'USD' });
  const wide = estimatePrice([20, 45, 70, 95, 120, 150].map(v => sold(v)), { condition: GOOD, currency: 'USD' });
  assert.ok(tight.confidence > wide.confidence + 15, `${tight.confidence} vs ${wide.confidence}`);
});

test('range brackets the price', () => {
  const p = estimatePrice([30, 40, 50, 60, 70].map(v => sold(v)), { condition: GOOD, currency: 'USD' });
  assert.ok(p.low <= p.price && p.price <= p.high, `${p.low} ${p.price} ${p.high}`);
});

test('weighted median behaves like a median with equal weights', () => {
  assert.equal(weightedQuantile([1, 2, 3].map(value => ({ value, weight: 1 })), 0.5), 2);
  assert.equal(weightedQuantile([1, 2, 3, 4].map(value => ({ value, weight: 1 })), 0.5), 2.5);
  assert.equal(weightedQuantile([{ value: 10, weight: 5 }, { value: 100, weight: 1 }], 0.5), 10);
});

test('prefilter drops bundles, other currencies and duplicates; sold first', () => {
  const out = prefilter([
    listed(10), sold(20, undefined, { title: 'Lot of 5 band tees' }),
    { ...sold(30), currency: 'GBP' }, sold(40, undefined, { url: 'https://ebay.com/itm/1?x=1' }),
    sold(41, undefined, { url: 'https://ebay.com/itm/1?y=2' }),
  ], 'USD');
  assert.deepEqual(out.map(c => c.price), [40, 10]);
});

test('sold results are read from the provider\'s shapes', () => {
  const c = normalizeSold([
    { title: 'Metallica tee', price: 539.99, currency: 'USD', caption: 'Sold Jul 28, 2026', product_url: 'https://ebay.com/itm/1' },
    { title: 'Other', price: '$1,234.50' },
    { title: 'Bad', price: 'free' },
  ], 'USD');
  assert.equal(c.length, 2);
  assert.equal(c[0].soldDate, 'Sold Jul 28, 2026');
  assert.equal(c[1].price, 1234.5);
});

test('web results only accepted from known resale sites', () => {
  assert.equal(siteOf('https://www.depop.com/products/abc'), 'Depop');
  assert.equal(siteOf('https://uk.depop.com/x'), 'Depop');
  assert.equal(siteOf('grailed.com'), 'Grailed');
  assert.equal(siteOf('Depop'), 'Depop');
  assert.equal(siteOf('https://randomblog.com/post'), null);
});

test('JSON is recovered from fenced or chatty model output', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Here you go: {"a":2} hope that helps'), { a: 2 });
  assert.equal(extractJson('no json'), null);
});

import { parseMoney } from '../lib/pricing/sold.ts';
test('sold prices in US and European formats', () => {
  assert.equal(parseMoney('$1,234.56'), 1234.56);
  assert.equal(parseMoney('1.234,50 €'), 1234.5);
  assert.equal(parseMoney('EUR 12,99'), 12.99);
  assert.equal(parseMoney('1,234'), 1234);
  assert.ok(Number.isNaN(parseMoney('free')));
});

import assert from 'node:assert';
import { matchBrand, matchRealBrand, normalizeBrand, searchBrands, DEPOP_BRANDS } from '../lib/depop/brands.ts';
import { OTHER_BRAND, isNoBrand } from '../lib/depop/data.ts';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (err) { console.log(`  FAIL ${name}\n       ${err.message}`); fail++; }
}

console.log('\nbrand matching');

test('exact list entries round-trip unchanged', () => {
  for (const b of ['Nike (nike)', 'Carhartt WIP (carhartt-wip)', 'Anvil (anvil)']) {
    assert.strictEqual(matchBrand(b), b);
  }
});

test('plain names resolve to the full Depop entry', () => {
  assert.strictEqual(matchBrand('Nike'), 'Nike (nike)');
  assert.strictEqual(matchBrand('Anvil'), 'Anvil (anvil)');
});

test('matching is case-insensitive, which Depop\'s own casing requires', () => {
  const expected = 'liquid blue (liquid-blue)';
  assert.strictEqual(matchBrand('Liquid Blue'), expected);
  assert.strictEqual(matchBrand('LIQUID BLUE'), expected);
  assert.strictEqual(matchBrand('liquid blue'), expected);
});

test('corporate suffixes are ignored', () => {
  assert.strictEqual(matchBrand('Nike Inc'), 'Nike (nike)');
  assert.strictEqual(matchBrand('Nike Clothing'), 'Nike (nike)');
});

test('apostrophes and accents normalise', () => {
  assert.strictEqual(matchBrand("Levi's"), "Levi's (levi-s)");
  assert.strictEqual(matchBrand('Levis'), "Levi's (levi-s)");
  assert.strictEqual(matchBrand('Stussy'), matchBrand('Stüssy'));
});

test('a leading "the" matches either way', () => {
  assert.strictEqual(matchBrand('north face'), 'The North Face (the-north-face)');
  assert.strictEqual(matchBrand('The North Face'), 'The North Face (the-north-face)');
});

test('longest sub-brand wins over the parent', () => {
  assert.strictEqual(matchBrand('CARHARTT WIP'), 'Carhartt WIP (carhartt-wip)');
  assert.strictEqual(matchBrand('carhartt'), 'Carhartt (carhartt)');
});

test('a band name is not a brand and returns blank', () => {
  assert.strictEqual(matchBrand('Nirvana'), '');
  assert.strictEqual(matchBrand('Metallica Band Tee'), '');
});

test('unknown text returns blank rather than raw passthrough', () => {
  assert.strictEqual(matchBrand('zzzz not a real brand'), '');
  assert.strictEqual(matchBrand(''), '');
  assert.strictEqual(matchBrand(null), '');
  assert.strictEqual(matchBrand(undefined), '');
});

test('every returned value is a real entry from Depop\'s list', () => {
  const all = new Set(DEPOP_BRANDS);
  for (const guess of ['Nike', 'nike sb', 'Levi\'s', 'Anvil', 'Screen Stars', 'Fruit of the Loom', 'Momotaro', 'Polo Ralph Lauren']) {
    const m = matchBrand(guess);
    assert.ok(!m || all.has(m), `${guess} produced "${m}" which is not in the list`);
  }
});

test('normalizeBrand is stable and collapses punctuation', () => {
  assert.strictEqual(normalizeBrand('  The North-Face!  '), 'north face');
  assert.strictEqual(normalizeBrand('A & B'), 'a and b');
});

test('typeahead prefers prefix matches', () => {
  const res = searchBrands('carhartt', 5);
  assert.ok(res.length > 0);
  assert.ok(res.some(r => /^Carhartt/i.test(r)));
});

test('typeahead ignores queries that are too short', () => {
  assert.deepStrictEqual(searchBrands('c'), []);
  assert.deepStrictEqual(searchBrands(''), []);
});

test('"Other (unbranded)" is an exact entry on Depop\'s template brand list', () => {
  assert.strictEqual(OTHER_BRAND, 'Other (unbranded)');
  assert.ok(DEPOP_BRANDS.includes(OTHER_BRAND));
  assert.strictEqual(matchBrand(OTHER_BRAND), OTHER_BRAND);
});

test('"Other" / "No Brand" mean no brand inside the app', () => {
  assert.ok(isNoBrand('') && isNoBrand(OTHER_BRAND) && isNoBrand('No Brand (no-brand)'));
  assert.ok(!isNoBrand('Nike (nike)') && !isNoBrand('& Other Stories (other-stories)'));
  assert.strictEqual(matchRealBrand(OTHER_BRAND), '');
  assert.strictEqual(matchRealBrand('unbranded'), '');
  assert.strictEqual(matchRealBrand('Nike'), 'Nike (nike)');
  assert.strictEqual(matchRealBrand('& Other Stories'), '& Other Stories (other-stories)');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);

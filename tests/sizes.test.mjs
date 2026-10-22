import assert from 'node:assert';
import { normalizeSize, isValidSize, allowedSizes, hasSizeField } from '../lib/depop/sizes.ts';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); pass++; }
  catch (err) { console.log(`  FAIL ${name}\n       ${err.message}`); fail++; }
}

const TEE     = 'Men >> Tops >> T-shirts (menswear, tops, tshirts)';
const WTEE    = 'Women >> Tops >> T-shirts (womenswear, tops, tshirts)';
const MJEANS  = 'Men >> Bottoms >> Jeans (menswear, bottoms, jeans)';
const WJEANS  = 'Women >> Bottoms >> Jeans (womenswear, bottoms, jeans)';
const MSHOE   = 'Men >> Footwear >> Sneakers (menswear, footwear, trainers)';
const WSHOE   = 'Women >> Footwear >> Sneakers (womenswear, footwear, trainers)';
const KTEE    = 'Kids >> Tops >> T-shirts (kidswear, tops, tshirts)';
const BRAS    = 'Women >> Underwear >> Bras (womenswear, underwear, bras)';
const ART     = 'Everything else >> Art >> Paintings (everything-else, art, paintings)';

console.log('\nsize normalisation');

test('lowercase letter sizes become Depop\'s uppercase values', () => {
  assert.strictEqual(normalizeSize('m', TEE), 'M');
  assert.strictEqual(normalizeSize('xl', TEE), 'XL');
  assert.strictEqual(normalizeSize('s', TEE), 'S');
});

test('spelled-out and abbreviated letter sizes resolve', () => {
  assert.strictEqual(normalizeSize('medium', TEE), 'M');
  assert.strictEqual(normalizeSize('large', TEE), 'L');
  assert.strictEqual(normalizeSize('size L', TEE), 'L');
  assert.strictEqual(normalizeSize('2XL', TEE), 'XXL');
  assert.strictEqual(normalizeSize('xxl', TEE), 'XXL');
  assert.strictEqual(normalizeSize('3XL', TEE), '3XL');
});

test('one size in all its spellings', () => {
  for (const v of ['one size', 'One Size', 'OS', 'osfa', 'free size']) {
    assert.strictEqual(normalizeSize(v, TEE), 'One size', `failed on ${v}`);
  }
});

test('waist x inseam keeps the waist on men\'s bottoms', () => {
  assert.strictEqual(normalizeSize('32x30', MJEANS), '32"');
  assert.strictEqual(normalizeSize('32/30', MJEANS), '32"');
  assert.strictEqual(normalizeSize('W34 L32', MJEANS), '34"');
  assert.strictEqual(normalizeSize('34', MJEANS), '34"');
  assert.strictEqual(normalizeSize('W36', MJEANS), '36"');
});

test('women\'s bottoms prefer the numeric scale when it exists', () => {
  assert.strictEqual(normalizeSize('28', WJEANS), '28');
  assert.strictEqual(normalizeSize('26x30', WJEANS), '26"');
});

test('shoe sizes gain the US prefix only on footwear', () => {
  assert.strictEqual(normalizeSize('10', MSHOE), 'US 10');
  assert.strictEqual(normalizeSize('10.5', MSHOE), 'US 10.5');
  assert.strictEqual(normalizeSize('US 11', MSHOE), 'US 11');
  assert.strictEqual(normalizeSize('size 9', MSHOE), 'US 9');
  assert.strictEqual(normalizeSize('8.5', WSHOE), 'US 8.5');
});

test('a bare number on a top is not silently turned into a shoe size', () => {
  assert.strictEqual(normalizeSize('10', TEE), '');
});

test('kids ages map onto year and month buckets', () => {
  assert.strictEqual(normalizeSize('3T', KTEE), '3 years');
  assert.strictEqual(normalizeSize('4', KTEE), '4 years');
  assert.strictEqual(normalizeSize('10 years', KTEE), '10 years');
  assert.strictEqual(normalizeSize('6m', KTEE), '6-9 months');
  assert.strictEqual(normalizeSize('9 months', KTEE), '9-12 months');
});

test('bra sizes pass through with correct casing', () => {
  assert.strictEqual(normalizeSize('34b', BRAS), '34B');
  assert.strictEqual(normalizeSize('36DD', BRAS), '36DD');
});

test('categories without a size scale always return blank', () => {
  assert.strictEqual(hasSizeField(ART), false);
  assert.strictEqual(normalizeSize('M', ART), '');
  assert.strictEqual(normalizeSize('anything', ART), '');
});

test('unreadable tags return blank rather than a guess', () => {
  for (const v of ['see tag', 'unknown', 'n/a', 'none', '', null, undefined, 'garbage text']) {
    assert.strictEqual(normalizeSize(v, TEE), '', `failed on ${v}`);
  }
});

test('every produced value is in the category\'s own allowed list', () => {
  const cases = [[TEE, 'm'], [WTEE, 'l'], [MJEANS, '32x30'], [WJEANS, '28'],
                 [MSHOE, '10'], [WSHOE, '7.5'], [KTEE, '3T'], [BRAS, '34b']];
  for (const [cat, raw] of cases) {
    const out = normalizeSize(raw, cat);
    assert.ok(out && allowedSizes(cat).includes(out), `${raw} on ${cat} gave "${out}"`);
  }
});

test('isValidSize rejects a value from the wrong scale', () => {
  assert.strictEqual(isValidSize('M', TEE), true);
  assert.strictEqual(isValidSize('m', TEE), false);
  assert.strictEqual(isValidSize('US 10', TEE), false);
  assert.strictEqual(isValidSize('', TEE), true);
  assert.strictEqual(isValidSize('anything', ART), true);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);

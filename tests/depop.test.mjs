import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildListingText, normalizeTags, DESCRIPTION_LIMIT } from '../lib/depop/listing-text.ts';
import { fieldsFromModel } from '../lib/depop/fields.ts';
import { buildCsv, validateListing, csvEscape, CSV_HEADERS, MAX_ROWS_PER_FILE } from '../lib/depop/csv.ts';
import { matchBrand } from '../lib/depop/brands.ts';
import { DEPOP_CATEGORY_LEAVES, DEPOP_CATEGORIES } from '../lib/depop/data.ts';

const TEE = DEPOP_CATEGORIES.find(c => c.startsWith('Men >> Tops >> T-shirts'));

const AI = {
  dating: { era: '90s (90s)', confidence: 'tag', basis: ['tag reads SCREEN STARS BEST', 'single stitch hems'] },
  title: 'Vintage 90s Metallica Tour Tee Black XL',
  opener: '1994 metallica tour tee on a screen stars body',
  details: ['single stitch sleeves and hem', 'tour dates on the back', 'faded black'],
  fit: 'boxy xl, fits like a modern l',
  conditionNote: 'small hole near the collar',
  styling: '',
  tags: ['#metallica', '#bandtee', 'Vintage!', '#metallica', '#90s', '#grunge', '#extra'],
  condition: 'Used - Good (used_good)', categoryGroup: 'Men >> Tops',
  brand: 'Screen Stars', size: 'xl',
  color1: 'Black (black)', color2: 'Black (black)',
  source1: 'Vintage (vintage)', style1: 'Grunge (grunge)', style2: 'Grunge (grunge)', style3: 'not a style',
  suggestedPrice: 85,
};

test('description: title first, body, then exactly 5 clean hashtags', () => {
  const d = buildListingText(AI);
  const lines = d.split('\n');
  assert.equal(lines[0], AI.title);
  assert.match(d, /single stitch sleeves and hem\./);
  assert.match(d, /condition: small hole near the collar/);
  assert.deepEqual(normalizeTags(AI.tags), ['#metallica', '#bandtee', '#vintage', '#90s', '#grunge']);
  assert.ok(d.endsWith('#metallica #bandtee #vintage #90s #grunge'));
});

test('description never exceeds Depop\'s 1,000 characters and keeps hashtags', () => {
  const long = { ...AI, details: Array(4).fill('x'.repeat(300)), styling: 'y'.repeat(300) };
  const d = buildListingText(long);
  assert.ok(d.length <= DESCRIPTION_LIMIT, `got ${d.length}`);
  assert.ok(d.includes('#grunge'));
  assert.ok(d.startsWith(AI.title));
});

test('em dashes are removed from buyer copy', () => {
  const d = buildListingText({ ...AI, opener: 'big tee — boxy fit' });
  assert.ok(!/[—–]/.test(d));
});

test('fields: invalid enums dropped, duplicates removed, size mapped to the category scale', () => {
  const f = fieldsFromModel(AI, {
    category: TEE, brand: matchBrand(AI.brand), location: 'United States',
    photoUrls: Array(10).fill('https://x.supabase.co/a.jpg'), domesticShipping: null, intlShipping: null,
    sku: 'abc123', price: 80,
  });
  assert.equal(f.brand, 'Screen Stars (screen-stars)');
  assert.equal(f.size, 'XL');
  assert.equal(f.color2, '', 'same colour twice should collapse');
  assert.deepEqual([f.style1, f.style2, f.style3], ['Grunge (grunge)', '', '']);
  assert.equal(f.age, '90s (90s)');
  assert.equal(f.photoUrls.length, 8);
  assert.equal(validateListing(f, { isKnownBrand: b => matchBrand(b) === b }).valid, true);
});

test('age is NOT set when the era came from the graphic only', () => {
  const f = fieldsFromModel({ ...AI, dating: { era: '70s (70s)', confidence: 'style', basis: ['1977 tour design'] } }, {
    category: TEE, brand: '', location: 'United States', photoUrls: ['https://a/b.jpg'],
    domesticShipping: null, intlShipping: null, sku: '', price: 20,
  });
  assert.equal(f.age, '');
});

function validFields(over = {}) {
  return {
    description: 'Nike Tee\n\nclean.\n\n#nike', category: TEE, price: 25, brand: 'Nike (nike)',
    condition: 'Used - Good (used_good)', size: 'M', color1: '', color2: '', source1: '', source2: '',
    age: '', style1: '', style2: '', style3: '', location: 'United States',
    photoUrls: ['https://p.supabase.co/1.jpg'], domesticShipping: null, intlShipping: null, sku: 'a1', ...over,
  };
}

test('validation catches what would make Depop reject the file', () => {
  const v = validateListing(validFields({ price: 0, category: 'Tops', size: 'US 10', photoUrls: [], location: '' }));
  assert.equal(v.valid, false);
  for (const f of ['price', 'category', 'photos', 'location']) assert.ok(v.fields.includes(f), f);
  const b = validateListing(validFields({ brand: 'Made Up Brand' }), { isKnownBrand: x => matchBrand(x) === x });
  assert.ok(b.fields.includes('brand'));
  const sz = validateListing(validFields({ size: 'US 10' }));
  assert.ok(sz.fields.includes('size'));
});

test('CSV matches Depop template v6 layout and escapes safely', () => {
  const tricky = validFields({ description: 'line one, "quoted"\r\nline two' });
  const { files, rejected } = buildCsv([
    { id: '1', title: 'ok', fields: tricky },
    { id: '2', title: 'bad', fields: validFields({ price: null }) },
  ], { datestamp: '2026-10-08' });
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].id, '2');
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, 'depop_bulk_listing_2026-10-08.csv');
  const csv = files[0].csv;
  assert.ok(csv.startsWith('Template version: 6,'));
  assert.equal(csv.split('\r\n')[1], CSV_HEADERS.join(','));
  assert.equal(CSV_HEADERS.length, 26);
  assert.ok(csv.includes('"line one, ""quoted""\r\nline two"'));
  assert.equal(csvEscape('plain'), 'plain');
});

test('a listing with no brand goes to Depop as their "Other (unbranded)" brand', () => {
  const rowOf = f => buildCsv([{ id: '1', title: 't', fields: f }], { datestamp: 'd' }).files[0].csv.split('\r\n')[3];
  for (const brand of ['', 'Other (unbranded)']) {
    const f = validFields({ brand });
    const v = validateListing(f, { isKnownBrand: b => matchBrand(b) === b });
    assert.equal(v.valid, true);
    assert.ok(!v.warnings.some(w => /brand/i.test(w)), 'no "no brand" warning');
    assert.ok(rowOf(f).includes(',25,Other (unbranded),Used - Good (used_good),'));
  }
  assert.ok(rowOf(validFields()).includes(',25,Nike (nike),Used - Good (used_good),'), 'a real brand is untouched');
});

test('more than 100 listings split into numbered files', () => {
  const items = Array.from({ length: MAX_ROWS_PER_FILE + 5 }, (_, i) => ({ id: String(i), title: 't', fields: validFields() }));
  const { files } = buildCsv(items, { datestamp: 'd' });
  assert.deepEqual(files.map(f => [f.filename, f.count]), [
    ['depop_bulk_listing_d_part1of2.csv', 100], ['depop_bulk_listing_d_part2of2.csv', 5],
  ]);
});

test('every category group has leaves and every leaf belongs to one group', () => {
  const all = Object.values(DEPOP_CATEGORY_LEAVES).flat();
  assert.equal(all.length, 319);
  assert.equal(new Set(all).size, 319);
});

test('CSV cells can never run as spreadsheet formulas', () => {
  assert.equal(csvEscape('=HYPERLINK("http://x","y")'), '" =HYPERLINK(""http://x"",""y"")"');
  assert.equal(csvEscape('+1 cool'), ' +1 cool');
  assert.equal(csvEscape('@everyone'), ' @everyone');
  assert.equal(csvEscape('-5'), '-5', 'plain numbers untouched');
  assert.equal(csvEscape('Levi\'s 501'), 'Levi\'s 501');
});

test('a number like "jersey #23" is not counted as a hashtag', () => {
  const tags = '#a #b #c #d #e';
  const v = validateListing({ ...fieldsFromModel(AI, { category: TEE, brand: '', location: 'United States', photoUrls: ['https://x/1.jpg'], domesticShipping: null, intlShipping: null, sku: 'x', price: 20 }), description: `Tee\n\njersey #23\n\n${tags}` });
  assert.ok(!v.errors.some(e => /hashtags/.test(e)), v.errors.join('; '));
});

import {
  DEPOP_CONDITIONS, DEPOP_COLORS, DEPOP_SOURCES, DEPOP_AGES, DEPOP_STYLES,
  DEPOP_LOCATIONS, DEPOP_CATEGORIES, TEMPLATE_VERSION, OTHER_BRAND, isNoBrand,
} from './data.ts';
import { isValidSize, hasSizeField, allowedSizes } from './sizes.ts';
import { DESCRIPTION_LIMIT, MAX_HASHTAGS } from './listing-text.ts';
import type { DepopFields } from './fields.ts';

export const CSV_HEADERS = ['Description', 'Category', 'Price', 'Brand', 'Condition', 'Size', 'Color 1', 'Color 2', 'Source 1', 'Source 2', 'Age', 'Style 1', 'Style 2', 'Style 3', 'Location', 'Picture Hero url', 'Picture 2 url', 'Picture 3 url', 'Picture 4 url', 'Picture 5 url', 'Picture 6 url', 'Picture 7 url', 'Picture 8 url', 'Domestic Shipping price', 'International Shipping price', 'SKU'];
const CSV_VERSION_ROW = [`Template version: ${TEMPLATE_VERSION}`, ...Array(CSV_HEADERS.length - 1).fill('')];
const CSV_PLACEHOLDER_ROW = ['Must be no more than 1,000 characters. Max. 5 hashtags.', 'Select a category from the dropdown menu. You can type to search as well.', "Enter a price without a currency symbol. We'll use the currency you usually list in.", 'Select a brand from the dropdown menu', 'Select a condition from the dropdown menu', 'Select a size from the dropdown menu', 'Select a color from the dropdown menu', 'Select a color from the dropdown menu', 'Select a source from the dropdown menu', 'Select a source from the dropdown menu', 'Select an age from the dropdown menu', 'Select a style from the dropdown menu', 'Select a style from the dropdown menu', 'Select a style from the dropdown menu', "Select the location you're shipping from", 'Enter the url for the picture that will appear first', 'Enter the url for the picture that will appear second', 'Enter the url for the picture that will appear third', 'Enter the url for the picture that will appear fourth', 'Enter the url for the picture that will appear fifth', 'Enter the url for the picture that will appear sixth', 'Enter the url for the picture that will appear seventh', 'Enter the url for the picture that will appear eighth', 'Enter a shipping price without a currency symbol', 'Enter a shipping price without a currency symbol', 'Enter the SKU'];

export const MAX_ROWS_PER_FILE = 100;
export const MAX_PHOTOS = 8;

const SETS = {
  category: new Set(DEPOP_CATEGORIES), condition: new Set(DEPOP_CONDITIONS),
  color: new Set(DEPOP_COLORS), source: new Set(DEPOP_SOURCES), age: new Set(DEPOP_AGES),
  style: new Set(DEPOP_STYLES), location: new Set(DEPOP_LOCATIONS),
};

export type FieldName = keyof DepopFields | 'photos';
export interface Validation { valid: boolean; errors: string[]; warnings: string[]; fields: FieldName[] }

function trunc(s: unknown, n = 40) {
  const str = String(s);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export function validateListing(l: DepopFields, opts: { isKnownBrand?: (b: string) => boolean } = {}): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields = new Set<FieldName>();
  const fail = (f: FieldName, m: string) => { errors.push(m); fields.add(f); };
  const warn = (f: FieldName, m: string) => { warnings.push(m); fields.add(f); };

  const desc = l.description || '';
  if (!desc.trim()) fail('description', 'Description is empty');
  if (desc.length > DESCRIPTION_LIMIT) fail('description', `Description is ${desc.length} characters; Depop's limit is ${DESCRIPTION_LIMIT}`);
  const hashtags = desc.match(/(^|\s)#[a-z][\w-]*/gi) || [];
  if (hashtags.length > MAX_HASHTAGS) fail('description', `${hashtags.length} hashtags; Depop allows at most ${MAX_HASHTAGS}`);

  const price = Number(l.price);
  if (l.price == null || !isFinite(price) || price <= 0) fail('price', 'Price must be a positive number');
  else if (price > 10000) warn('price', `Price of ${price} is unusually high — worth double checking`);

  if (!l.category) fail('category', 'Pick a category');
  else if (!SETS.category.has(l.category)) fail('category', `Category "${trunc(l.category)}" is not a valid Depop category`);

  if (!l.condition) fail('condition', 'Pick a condition');
  else if (!SETS.condition.has(l.condition)) fail('condition', `Condition "${trunc(l.condition)}" is not a valid Depop condition`);

  if (!l.location) fail('location', 'Set your shipping location in Settings');
  else if (!SETS.location.has(l.location)) fail('location', `Location "${trunc(l.location)}" is not one of Depop's locations`);

  if (l.brand && !isNoBrand(l.brand) && opts.isKnownBrand && !opts.isKnownBrand(l.brand)) fail('brand', `Brand "${trunc(l.brand)}" is not on Depop's list — pick one or clear it`);

  if (l.size && !isValidSize(l.size, l.category)) {
    const options = allowedSizes(l.category).slice(0, 6).join(', ');
    fail('size', `Size "${trunc(l.size)}" isn't valid for this category${options ? ` (e.g. ${options})` : ''}`);
  } else if (!l.size && hasSizeField(l.category)) {
    warn('size', 'No size set — buyers filter by size, so this listing will be missed');
  }

  const photos = (l.photoUrls || []).filter(Boolean);
  if (!photos.length) fail('photos', 'At least one photo is required');
  for (const u of photos.slice(0, MAX_PHOTOS)) {
    if (!/^https?:\/\//i.test(u)) { fail('photos', `Photo link is not valid: ${trunc(u)}`); break; }
  }

  const opt = (f: FieldName, name: string, v: string, set: Set<string>) => {
    if (v && !set.has(v)) fail(f, `${name} "${trunc(v)}" is not a valid Depop option`);
  };
  opt('color1', 'Color 1', l.color1, SETS.color); opt('color2', 'Color 2', l.color2, SETS.color);
  opt('source1', 'Source 1', l.source1, SETS.source); opt('source2', 'Source 2', l.source2, SETS.source);
  opt('age', 'Age', l.age, SETS.age);
  opt('style1', 'Style 1', l.style1, SETS.style); opt('style2', 'Style 2', l.style2, SETS.style); opt('style3', 'Style 3', l.style3, SETS.style);

  for (const [f, name] of [['domesticShipping', 'Domestic shipping'], ['intlShipping', 'International shipping']] as const) {
    const v = l[f];
    if (v === null || v === undefined || (v as unknown) === '') continue;
    if (!isFinite(Number(v)) || Number(v) < 0) fail(f, `${name} must be a number, or blank`);
  }

  return { valid: errors.length === 0, errors, warnings, fields: [...fields] };
}

export function csvEscape(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = ' ' + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const num = (v: number | null | undefined) => (v == null || (v as unknown) === '' ? '' : String(v));

export function listingToRow(l: DepopFields): string[] {
  const photos = (l.photoUrls || []).filter(Boolean).slice(0, MAX_PHOTOS);
  while (photos.length < MAX_PHOTOS) photos.push('');
  return [
    l.description || '', l.category || '', num(l.price), isNoBrand(l.brand) ? OTHER_BRAND : l.brand, l.condition || '', l.size || '',
    l.color1 || '', l.color2 || '', l.source1 || '', l.source2 || '', l.age || '',
    l.style1 || '', l.style2 || '', l.style3 || '', l.location || '',
    ...photos, num(l.domesticShipping), num(l.intlShipping), l.sku || '',
  ];
}

export function renderCsv(listings: DepopFields[]): string {
  const lines = [CSV_VERSION_ROW, CSV_HEADERS, CSV_PLACEHOLDER_ROW, ...listings.map(listingToRow)]
    .map(row => row.map(csvEscape).join(','));
  return lines.join('\r\n');
}

export interface CsvItem { id: string; title: string; fields: DepopFields }

export function buildCsv(items: CsvItem[], opts: { isKnownBrand?: (b: string) => boolean; datestamp?: string } = {}) {
  const datestamp = opts.datestamp || new Date().toISOString().slice(0, 10);
  const included: CsvItem[] = [];
  const rejected: { id: string; title: string; errors: string[]; fields: FieldName[] }[] = [];
  const warnings: { id: string; title: string; warnings: string[] }[] = [];

  for (const item of items) {
    const v = validateListing(item.fields, opts);
    if (v.warnings.length) warnings.push({ id: item.id, title: item.title, warnings: v.warnings });
    if (v.valid) included.push(item);
    else rejected.push({ id: item.id, title: item.title, errors: v.errors, fields: v.fields });
  }

  const files: { filename: string; csv: string; count: number }[] = [];
  for (let i = 0; i < included.length; i += MAX_ROWS_PER_FILE) {
    const chunk = included.slice(i, i + MAX_ROWS_PER_FILE);
    files.push({ filename: '', csv: renderCsv(chunk.map(c => c.fields)), count: chunk.length });
  }
  files.forEach((f, i) => {
    f.filename = files.length === 1
      ? `depop_bulk_listing_${datestamp}.csv`
      : `depop_bulk_listing_${datestamp}_part${i + 1}of${files.length}.csv`;
  });

  return { files, included: included.map(i => i.id), rejected, warnings };
}

import brands from './data/brands.json' with { type: 'json' };
import { isNoBrand } from './data.ts';

export const DEPOP_BRANDS: string[] = brands;

const NOISE_WORDS = /\b(inc|llc|ltd|co|corp|corporation|company|brand|brands|clothing|apparel|official|store|shop)\b/g;

export function normalizeBrand(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(NOISE_WORDS, ' ')
    .replace(/^\s*the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function displayLabel(v: unknown): string {
  return String(v ?? '').replace(/\s*\([^)]*\)\s*$/, '');
}

let exact: Set<string> | null = null;
let index: Map<string, string> | null = null;
let slugIndex: Map<string, string> | null = null;

function buildIndex() {
  if (index && slugIndex) return { index, slugIndex };
  index = new Map();
  slugIndex = new Map();
  for (const entry of DEPOP_BRANDS) {
    const key = normalizeBrand(displayLabel(entry));
    if (key && !index.has(key)) index.set(key, entry);
    const slug = (entry.match(/\(([^)]*)\)\s*$/) || [])[1];
    if (slug && !slugIndex.has(slug)) slugIndex.set(slug, entry);
  }
  return { index, slugIndex };
}

export function matchRealBrand(guess: unknown): string {
  const m = matchBrand(guess);
  return isNoBrand(m) ? '' : m;
}

export function matchBrand(guess: unknown): string {
  const raw = String(guess ?? '').trim();
  if (!raw) return '';
  const { index, slugIndex } = buildIndex();

  exact ||= new Set(DEPOP_BRANDS);
  if (exact.has(raw)) return raw;
  if (slugIndex.has(raw)) return slugIndex.get(raw)!;
  const n = normalizeBrand(displayLabel(raw).slice(0, 120));
  if (!n) return '';

  if (index.has(n)) return index.get(n)!;

  const words = n.split(' ').slice(0, 8);
  for (let len = Math.min(words.length, n.split(' ').length - 1); len >= 1; len--) {
    const prefix = words.slice(0, len).join(' ');
    if (index.has(prefix)) return index.get(prefix)!;
  }

  let found: string | null = null;
  for (const [key, val] of index) {
    if (key.startsWith(n + ' ')) {
      if (found) return '';
      found = val;
    }
  }
  return found || '';
}

export function searchBrands(q: string, limit = 12): string[] {
  const n = normalizeBrand(q);
  if (n.length < 2) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const entry of DEPOP_BRANDS) {
    const key = normalizeBrand(displayLabel(entry));
    if (key.startsWith(n)) {
      starts.push(entry);
      if (starts.length >= limit) break;
    } else if (contains.length < limit && key.includes(n)) {
      contains.push(entry);
    }
  }
  return [...starts, ...contains].slice(0, limit);
}

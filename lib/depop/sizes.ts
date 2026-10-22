import { DEPOP_SIZE_GROUPS, DEPOP_CATEGORY_SIZE_GROUP } from './data.ts';

export function allowedSizes(category: string | null | undefined): string[] {
  const g = category ? DEPOP_CATEGORY_SIZE_GROUP[category] : null;
  return g ? DEPOP_SIZE_GROUPS[g] || [] : [];
}

export function hasSizeField(category: string | null | undefined): boolean {
  return allowedSizes(category).length > 0;
}

function key(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/["”]/g, '"').replace(/\s+/g, ' ').trim();
}

const LETTER_ALIASES: Record<string, string> = {
  xxxs: '3XS', '3xs': '3XS',
  xxs: 'XXS', '2xs': 'XXS',
  xs: 'XS', 'extra small': 'XS',
  s: 'S', sm: 'S', small: 'S',
  m: 'M', md: 'M', med: 'M', medium: 'M',
  l: 'L', lg: 'L', large: 'L',
  xl: 'XL', 'extra large': 'XL', 'x large': 'XL',
  xxl: 'XXL', '2xl': 'XXL', 'xx large': 'XXL',
  xxxl: '3XL', '3xl': '3XL',
  xxxxl: '4XL', '4xl': '4XL',
  '5xl': '5XL', xxxxxl: '5XL',
  '6xl': '6XL', xxxxxxl: '6XL',
};

const ONE_SIZE = /^(one ?size|os|osfa|onesize|free ?size|fits all|unisize)$/;

function* candidates(raw: string, allowed: string[]): Generator<string> {
  const k = key(raw);
  if (!k) return;
  const allowedKeys = new Set(allowed.map(key));
  const has = (c: string) => allowedKeys.has(key(c));

  yield raw;
  if (ONE_SIZE.test(k)) { yield 'One size'; return; }

  const stripped = k.replace(/^size\s*/, '');
  const letter = LETTER_ALIASES[stripped.replace(/[-\s]/g, '')] || LETTER_ALIASES[stripped];
  if (letter) { yield letter; return; }

  const wl = k.match(/^w?\s*(\d{2})\s*(?:[x×\/]|\s)\s*l?\s*(\d{2})"?$/);
  if (wl) { yield `${wl[1]}"`; yield wl[1]; return; }

  const waistOnly = k.match(/^w\s*(\d{2})"?$/);
  if (waistOnly) { yield `${waistOnly[1]}"`; yield waistOnly[1]; return; }
  const inches = k.match(/^(\d{2})\s*(?:"|in|inch|inches)$/);
  if (inches) { yield `${inches[1]}"`; yield inches[1]; return; }

  const shoe = k.match(/^(?:us|size)?\s*(\d{1,2}(?:\.5)?)$/);
  if (shoe && has(`US ${shoe[1]}`)) { yield `US ${shoe[1]}`; return; }

  const years = k.match(/^(\d{1,2})\s*(?:t|y|yr|yrs|years?)$/);
  if (years && has(`${years[1]} years`)) { yield `${years[1]} years`; return; }
  const months = k.match(/^(\d{1,2})\s*(?:m|mo|mos|months?)$/);
  if (months) {
    const n = Number(months[1]);
    for (const opt of allowed) {
      const r = key(opt).match(/^(\d{1,2})-(\d{1,2}) months$/);
      if (r && n === Number(r[1])) { yield opt; return; }
    }
    for (const opt of allowed) {
      const r = key(opt).match(/^(\d{1,2})-(\d{1,2}) months$/);
      if (r && n >= Number(r[1]) && n <= Number(r[2])) { yield opt; return; }
    }
  }

  const bare = k.match(/^(\d{1,2})$/);
  if (bare && !has(bare[1])) {
    if (has(`${bare[1]}"`)) { yield `${bare[1]}"`; return; }
    if (has(`${bare[1]} years`)) { yield `${bare[1]} years`; return; }
  }

  const num = k.match(/^(\d{1,2}(?:\.5)?)$/);
  if (num) {
    for (const opt of allowed) {
      if (key(opt).startsWith(num[1] + '-') || key(opt) === num[1]) { yield opt; return; }
    }
  }
}

export function normalizeSize(raw: unknown, category: string | null | undefined): string {
  const allowed = allowedSizes(category);
  if (!allowed.length || !raw) return '';
  const text = String(raw).trim();
  if (/^(see tag|unknown|n\/?a|none|unsized|no tag)$/i.test(text)) return '';
  const lookup = new Map(allowed.map(v => [key(v), v]));
  for (const c of candidates(text, allowed)) {
    const hit = lookup.get(key(c));
    if (hit) return hit;
  }
  return '';
}

export function isValidSize(value: unknown, category: string | null | undefined): boolean {
  if (!value) return true;
  const allowed = allowedSizes(category);
  if (!allowed.length) return true;
  return allowed.includes(String(value));
}

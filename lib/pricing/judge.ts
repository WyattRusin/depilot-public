import { generate, type Part } from './gemini.ts';
import type { CostMeter } from './cost.ts';
import type { Comp, Match } from './types.ts';
import { normalizeBrand, matchRealBrand } from '../depop/brands.ts';

const JUNK = /\b(lot|bundle|bulk|wholesale|x\s?\d+|\d+\s?x|set of|pick (one|your)|mystery|box of|job lot|patch only|tag only|replacement)\b/i;
const MAX_TO_JUDGE = 40;
const MAX_PHOTOS = 16;

export const VINTAGE_WORDS = /\b(vintage|vtg|single[- ]?stitch(ed)?|original|og|[5-9]0'?s)\b/i;
export const REPRINT_WORDS = /\b(reprint|re-print|repro|reproduction|bootleg|inspired|retro style|modern|nwt|new with tags)\b/i;

export function prefilter(comps: Comp[], currency: string): Comp[] {
  const seen = new Set<string>();
  const order: Record<Comp['source'], number> = { ebay_sold: 0, ebay_image: 1, web: 2, ebay_active: 3 };
  return comps
    .filter(c => c.currency?.toUpperCase() === currency && c.price > 0 && !JUNK.test(c.title))
    .sort((a, b) => order[a.source] - order[b.source])
    .filter(c => {
      const k = (c.url ? c.url.split('?')[0] : `${c.title.toLowerCase()}|${c.price}`);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_TO_JUDGE);
}

export interface ItemProfile {
  title: string; brand: string; model?: string; itemType: string; era: string;
  datedFrom: string; provenVintage: boolean; condition: string; keyDetails: string[];
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdicts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          i: { type: 'INTEGER' },
          match: { type: 'STRING', enum: ['same', 'similar', 'different'] },
          brand: { type: 'STRING' },
        },
        required: ['i', 'match', 'brand'],
      },
    },
  },
  required: ['verdicts'],
};

const MAX_THUMB = 400_000;

export async function fetchThumb(url: string): Promise<{ mimeType: string; data: string } | null> {
  if (!/^https:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !/^image\/(jpeg|png|webp)/.test(type) || !res.body) return null;
    if (Number(res.headers.get('content-length') || 0) > MAX_THUMB) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_THUMB) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return { mimeType: type.split(';')[0], data: Buffer.concat(chunks).toString('base64') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function judgeComps(
  item: ItemProfile,
  comps: Comp[],
  opts: {
    apiKey: string; models: string[]; meter?: CostMeter;
    deadline?: number;
    itemImage?: { mimeType: string; data: string } | null;
    loadThumb?: (url: string) => Promise<{ mimeType: string; data: string } | null>;
  },
): Promise<Comp[]> {
  if (!comps.length) return [];

  const load = opts.loadThumb || fetchThumb;
  const withPhoto = comps.map((c, i) => ({ c, i })).filter(x => x.c.image).slice(0, MAX_PHOTOS);
  const thumbs = new Map<number, { mimeType: string; data: string }>();
  await Promise.all(withPhoto.map(async ({ c, i }) => { const t = await load(c.image!); if (t) thumbs.set(i, t); }));
  const usePhotos = Boolean(opts.itemImage) && thumbs.size > 0;

  const header = `You are pricing a secondhand item for resale. Decide which listings below are the same item, so their prices can be used.

THE ITEM
- ${item.title}
- Brand on tag: ${item.brand || 'not confirmed'}${item.model ? `, model: ${item.model}` : ''}
- Type: ${item.itemType}
- Era: ${item.provenVintage ? `${item.era}, proven from the garment` : `not proven vintage (${item.era}, ${item.datedFrom}). Treat it as a modern piece`}
- Condition: ${item.condition}
- Key details: ${item.keyDetails.slice(0, 6).join('; ') || 'none'}
${usePhotos ? '\nThe item\'s photo comes first. Listings with a photo are shown with it.' : ''}

For each listing answer "match":
- "same": the same product. Same design, graphic, model, collaboration or colourway, and the same kind of piece (original vs reprint). Size and condition may differ. When you can see both photos, the graphic must actually match
- "similar": same brand or design family, item type and tier, but not identical, so its price is context only (another colourway of the same jacket model, another tour shirt of the same band)
- "different": anything else: different design or brand line, different item type, kids vs adult, bundles, parts, counterfeits or "inspired" items
${item.provenVintage
    ? '- This item is a proven original: a listing that says reprint, repro, bootleg or modern is "different"'
    : '- This item is NOT proven vintage: a listing that calls itself vintage, original, single stitch or names a decade is at most "similar", because originals sell for far more than reprints'}

Also give "brand": the maker the listing names (not the band, team or design), exactly as written, or "" if none.
Be strict: when unsure between same and similar, choose similar; when unsure between similar and different, choose different.
Return a verdict for every listing number.

LISTINGS`;

  const parts: Part[] = [{ text: header }];
  if (usePhotos) parts.push({ text: 'Item photo:' }, { inlineData: opts.itemImage! });
  comps.forEach((c, i) => {
    parts.push({ text: `${i}. [${c.status}${c.source === 'ebay_image' ? ', looks similar in photo search' : ''}] ${c.title}${c.condition ? ` (${c.condition})` : ''}` });
    const t = usePhotos ? thumbs.get(i) : undefined;
    if (t) parts.push({ inlineData: t });
  });

  const out = await generate({
    apiKey: opts.apiKey, models: opts.models, parts,
    schema: SCHEMA, thinkingLevel: 'low', temperature: 0,
    timeoutMs: Math.max(5000, Math.min(25000, (opts.deadline ?? Infinity) - Date.now() - 2000)), deadline: opts.deadline,
    mediaResolution: 'low', meter: opts.meter, meterLabel: 'judge',
  });

  const verdicts = new Map<number, { match: Match; brand: string }>();
  for (const v of out.json?.verdicts || []) {
    if (Number.isInteger(v?.i) && ['same', 'similar', 'different'].includes(v?.match)) {
      verdicts.set(v.i, { match: v.match, brand: typeof v.brand === 'string' ? v.brand.trim() : '' });
    }
  }
  return comps.map((c, i) => {
    const v = verdicts.get(i);
    return { ...c, match: enforceEraRule(c, v?.match || 'different', item.provenVintage), brandNamed: v?.brand || '' };
  });
}

export function enforceEraRule(c: Comp, match: Match, provenVintage: boolean): Match {
  if (match !== 'same') return match;
  if (!provenVintage && VINTAGE_WORDS.test(c.title)) return 'similar';
  if (provenVintage && REPRINT_WORDS.test(c.title)) return 'different';
  return match;
}

export interface BrandSuggestion { name: string; depopBrand: string; count: number; of: number }

export function suggestBrand(judged: Comp[], itemBrand: string): BrandSuggestion | null {
  const same = judged.filter(c => c.match === 'same' && c.brandNamed);
  if (same.length < 3) return null;
  const tally = new Map<string, { name: string; count: number }>();
  for (const c of same) {
    const key = normalizeBrand(c.brandNamed);
    if (!key) continue;
    const t = tally.get(key) || { name: c.brandNamed!, count: 0 };
    t.count++;
    tally.set(key, t);
  }
  const top = [...tally.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (!top) return null;
  const [key, { name, count }] = top;
  if (count < 3 || count / same.length < 0.6) return null;
  if (itemBrand && normalizeBrand(itemBrand.replace(/\s*\([^)]*\)$/, '')) === key) return null;
  return { name, depopBrand: matchRealBrand(name), count, of: same.length };
}

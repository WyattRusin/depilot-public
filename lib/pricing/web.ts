import { generate } from './gemini.ts';
import { httpsUrl } from './http.ts';
import type { Comp } from './types.ts';
import { FLAT_CENTS, type CostMeter } from './cost.ts';

const SITES: Record<string, string> = {
  'depop.com': 'Depop', 'grailed.com': 'Grailed', 'poshmark.com': 'Poshmark', 'vinted.com': 'Vinted',
  'vinted.co.uk': 'Vinted', 'vinted.fr': 'Vinted', 'vinted.de': 'Vinted', 'mercari.com': 'Mercari',
  'ebay.com': 'eBay', 'ebay.co.uk': 'eBay', 'ebay.de': 'eBay', 'ebay.com.au': 'eBay', 'ebay.ca': 'eBay',
  'vestiairecollective.com': 'Vestiaire', 'therealreal.com': 'The RealReal', 'thredup.com': 'thredUP',
  'etsy.com': 'Etsy', 'stockx.com': 'StockX', 'goat.com': 'GOAT', 'farfetch.com': 'Farfetch',
};

export function siteOf(urlOrDomain: string | undefined): string | null {
  if (!urlOrDomain) return null;
  let host = urlOrDomain.toLowerCase().trim();
  try { if (/^https?:/.test(host)) host = new URL(host).hostname; } catch {}
  host = host.replace(/^www\./, '');
  for (const [domain, name] of Object.entries(SITES)) {
    if (host === domain || host.endsWith('.' + domain)) return name;
  }
  const byName = Object.values(SITES).find(n => n.toLowerCase() === host);
  return byName || null;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          site: { type: 'STRING' },
          title: { type: 'STRING' },
          price: { type: 'NUMBER' },
          currency: { type: 'STRING' },
          status: { type: 'STRING', enum: ['sold', 'listed'] },
          url: { type: 'STRING' },
        },
        required: ['site', 'title', 'price', 'currency', 'status'],
      },
    },
  },
  required: ['results'],
};

export async function searchWeb(
  item: { searchQuery: string; broadQuery?: string; itemType?: string; brand?: string; era?: string },
  opts: { apiKey: string; model: string; currency: string; country: string; meter?: CostMeter; deadline?: number },
): Promise<{ comps: Comp[]; queries: string[] }> {
  const prompt = `Find what this exact item sells for on resale marketplaces right now.

Item: ${item.searchQuery}${item.itemType ? ` (${item.itemType})` : ''}${item.brand ? `, brand on tag: ${item.brand}` : ''}${item.era ? `, era: ${item.era}` : ''}
Seller is in: ${opts.country}. Prices in ${opts.currency}.

Search Google for this item on Depop, Grailed, Poshmark, Vinted, Mercari and eBay. Prefer SOLD listings; include current listings too.

Return up to 12 individual listings you actually saw in the search results, each with its site, title, price, currency, whether it is sold or listed, and its URL if you saw it.
Rules:
- Only report prices you read in search results. Never estimate, average or invent a price.
- Individual items only: no bundles, lots, price ranges or "from" prices.
- Only listings for this item or a near-identical one (same brand and design). Skip anything else.
- If you find nothing reliable, return an empty list.
Respond as JSON: {"results":[{"site","title","price","currency","status","url"}]}`;

  const out = await generate({
    apiKey: opts.apiKey, models: [opts.model], parts: [{ text: prompt }],
    schema: SCHEMA, googleSearch: true, thinkingLevel: 'low', timeoutMs: 30000, deadline: opts.deadline,
    meter: opts.meter, meterLabel: 'web',
  });
  opts.meter?.add('web', FLAT_CENTS.googleSearch);

  const groundedSites = new Set(out.sources.map(s => siteOf(s.title) || siteOf(s.uri)).filter(Boolean));
  const raw = Array.isArray(out.json?.results) ? out.json.results : [];

  const comps: Comp[] = [];
  for (const r of raw) {
    const site = siteOf(r?.url) || siteOf(r?.site);
    const price = Number(r?.price);
    if (!site || !isFinite(price) || price <= 0 || !r?.title) continue;
    if (String(r?.currency || '').toUpperCase() !== opts.currency) continue;
    if (groundedSites.size && !groundedSites.has(site)) continue;
    comps.push({
      source: 'web', status: r.status === 'sold' ? 'sold' : 'listed', site,
      title: String(r.title).slice(0, 200), price, currency: opts.currency,
      url: httpsUrl(r.url) && siteOf(r.url) ? r.url : undefined,
    });
  }
  return { comps, queries: out.queries };
}

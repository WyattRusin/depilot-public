import { fetchJson, httpsUrl, UpstreamError } from './http.ts';
import type { Comp } from './types.ts';
import { FLAT_CENTS, type CostMeter } from './cost.ts';

const ENDPOINT = 'https://api.openwebninja.com/real-time-ebay-data/search';

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return num(o.value ?? o.extracted ?? o.amount ?? o.raw);
  }
  return parseMoney(String(v ?? ''));
}

export function parseMoney(s: string): number {
  const m = s.match(/\d[\d.,\s]*/);
  if (!m) return NaN;
  let t = m[0].replace(/\s/g, '').replace(/[.,]+$/, '');
  const comma = t.lastIndexOf(','), dot = t.lastIndexOf('.');
  if (comma > dot) t = t.length - comma - 1 <= 2 ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(/,/g, '');
  return parseFloat(t);
}

export function normalizeSold(products: any[] | undefined, currency: string): Comp[] {
  return (products || []).flatMap((p: any): Comp[] => {
    const price = num(p?.price ?? p?.sold_price ?? p?.product_price);
    const title = p?.title || p?.product_title;
    if (!isFinite(price) || price <= 0 || !title) return [];
    const caption = String(p?.caption || p?.sold_date || '');
    return [{
      source: 'ebay_sold', status: 'sold', site: 'eBay',
      title: String(title), price,
      currency: String(p?.currency || currency),
      url: httpsUrl(p?.product_url || p?.url || p?.link || p?.item_url),
      image: httpsUrl(p?.image || p?.thumbnail || p?.product_photo || p?.image_url || p?.photos?.[0]),
      condition: p?.condition || p?.product_condition,
      soldDate: /sold/i.test(caption) ? caption : undefined,
    }];
  });
}

export async function searchSold(query: string, apiKey: string, domain: string, currency: string, meter?: CostMeter): Promise<Comp[]> {
  if (!apiKey) throw new UpstreamError('OPENWEBNINJA_API_KEY not set', { retryable: false });
  meter?.add('sold', FLAT_CENTS.soldLookup);
  const params = new URLSearchParams({ query: query.slice(0, 120), show_only: 'sold_items', domain, page: '1' });
  const { res, data } = await fetchJson(`${ENDPOINT}?${params}`, { headers: { 'x-api-key': apiKey } }, 15000, 'eBay sold search');
  if (!res.ok) throw new UpstreamError(`eBay sold search: ${data?.error?.message || data?.message || res.status}`);
  const products = data?.data?.products ?? data?.data ?? data?.products ?? [];
  return normalizeSold(Array.isArray(products) ? products : [], currency);
}

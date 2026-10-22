import { fetchJson, httpsUrl, UpstreamError } from './http.ts';
import type { Comp } from './types.ts';

const BASE = 'https://api.ebay.com';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
let cached: { id: string; token: string; expiresAt: number } | null = null;

export interface EbayCreds { clientId: string; clientSecret: string }

async function appToken(creds: EbayCreds): Promise<string> {
  if (!creds.clientId || !creds.clientSecret) throw new UpstreamError('eBay keys not set', { retryable: false });
  if (cached && cached.id === creds.clientId && Date.now() < cached.expiresAt) return cached.token;
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const { res, data } = await fetchJson(`${BASE}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
  }, 10000, 'eBay auth');
  if (!res.ok) throw new UpstreamError(`eBay auth failed (${res.status}): ${data.error_description || data.error || 'unknown'}`, { retryable: false });
  cached = { id: creds.clientId, token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 7200) - 60) * 1000 };
  return cached.token;
}

function headers(token: string, marketplace: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-EBAY-C-MARKETPLACE-ID': marketplace };
}

function normalize(summaries: any[] | undefined, source: Comp['source']): Comp[] {
  return (summaries || []).flatMap((it: any): Comp[] => {
    const price = parseFloat(it?.price?.value ?? it?.currentBidPrice?.value ?? 'NaN');
    if (!isFinite(price) || price <= 0 || !it?.title) return [];
    return [{
      source, status: 'listed', site: 'eBay',
      title: String(it.title), price,
      currency: it.price?.currency || it.currentBidPrice?.currency || 'USD',
      url: httpsUrl(it.itemWebUrl), image: httpsUrl(it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl),
      condition: it.condition,
    }];
  });
}

export async function searchByImage(base64: string, creds: EbayCreds, marketplace: string, limit = 25): Promise<Comp[]> {
  const token = await appToken(creds);
  const { res, data } = await fetchJson(
    `${BASE}/buy/browse/v1/item_summary/search_by_image?limit=${limit}`,
    { method: 'POST', headers: headers(token, marketplace), body: JSON.stringify({ image: base64 }) },
    15000, 'eBay image search',
  );
  if (!res.ok) throw new UpstreamError(`eBay image search: ${data?.errors?.[0]?.message || res.status}`);
  return normalize(data.itemSummaries, 'ebay_image');
}

export async function searchActive(q: string, creds: EbayCreds, marketplace: string, opts: { isNew?: boolean; limit?: number } = {}): Promise<Comp[]> {
  const token = await appToken(creds);
  const params = new URLSearchParams({ q: q.slice(0, 100), limit: String(opts.limit || 25) });
  params.set('filter', opts.isNew ? 'conditions:{NEW}' : 'conditions:{USED}');
  const { res, data } = await fetchJson(
    `${BASE}/buy/browse/v1/item_summary/search?${params}`,
    { headers: headers(token, marketplace) },
    12000, 'eBay keyword search',
  );
  if (!res.ok) throw new UpstreamError(`eBay keyword search: ${data?.errors?.[0]?.message || res.status}`);
  return normalize(data.itemSummaries, 'ebay_active');
}

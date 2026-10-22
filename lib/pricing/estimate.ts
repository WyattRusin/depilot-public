import type { Comp, CompSource, Pricing } from './types.ts';

export const ASKING_TO_SALE = 0.82;

export const CONDITION_FACTOR: Record<string, number> = {
  'Brand new (brand_new)': 1.15,
  'Like new (used_like_new)': 1.05,
  'Used - Excellent (used_excellent)': 1.0,
  'Used - Good (used_good)': 0.92,
  'Used - Fair (used_fair)': 0.75,
};

const MATCH_WEIGHT = { same: 1, similar: 0.35, different: 0 };
const SOURCE_WEIGHT: Record<CompSource, number> = { ebay_sold: 1, ebay_image: 1, ebay_active: 1, web: 0.75 };
const STATUS_WEIGHT = { sold: 1, listed: 0.6 };

const MIN_WEIGHT = 1.6;

export function roundToPricePoint(v: number, mode: 'nearest' | 'down' | 'up' = 'nearest'): number | null {
  if (!Number.isFinite(v) || v <= 0) return null;
  v = Math.round(v * 100) / 100;
  const step = v < 25 ? 1 : v < 100 ? 5 : v < 300 ? 10 : 25;
  const fn = mode === 'down' ? Math.floor : mode === 'up' ? Math.ceil : Math.round;
  return Math.max(step === 1 ? 5 : step, fn(v / step) * step);
}

interface Point { value: number; weight: number; comp: Comp }

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export function weightedQuantile(points: { value: number; weight: number }[], q: number): number {
  const s = [...points].sort((a, b) => a.value - b.value);
  const total = s.reduce((a, p) => a + p.weight, 0);
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    const prev = acc;
    acc += s[i].weight;
    if (acc / total >= q) {
      if (Math.abs(acc / total - q) < 1e-9 && i + 1 < s.length && prev / total < q) return (s[i].value + s[i + 1].value) / 2;
      return s[i].value;
    }
  }
  return s[s.length - 1].value;
}

function removeOutliers(points: Point[]): Point[] {
  if (points.length < 4) return points;
  const sorted = points.map(p => p.value).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  return points.filter(p => p.value >= q1 - 1.5 * iqr && p.value <= q3 + 1.5 * iqr);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

export function recencyWeight(soldDate: string | undefined, now = Date.now()): number {
  if (!soldDate) return 1;
  const t = Date.parse(soldDate.replace(/^\s*sold\s*/i, ''));
  if (!Number.isFinite(t)) return 1;
  const days = (now - t) / 86_400_000;
  if (days <= 30) return 1;
  if (days <= 60) return 0.85;
  if (days <= 90) return 0.7;
  return 0.55;
}

export function estimatePrice(
  comps: Comp[],
  item: { condition?: string; aiPrice?: number | null; currency: string; symbol?: string },
): Pricing {
  const sym = item.symbol || '$';
  const aiPrice = item.aiPrice && item.aiPrice > 0 ? item.aiPrice : null;
  const sources = { ebay_sold: 0, ebay_image: 0, ebay_active: 0, web: 0 } as Record<CompSource, number>;
  for (const c of comps) sources[c.source]++;

  const matched = comps.filter(c => c.match === 'same' || c.match === 'similar');
  const rejectedCount = comps.length - matched.length;

  let points: Point[] = matched.map(c => ({
    comp: c,
    value: c.status === 'sold' ? c.price : c.price * ASKING_TO_SALE,
    weight: MATCH_WEIGHT[c.match!] * SOURCE_WEIGHT[c.source] * STATUS_WEIGHT[c.status] * recencyWeight(c.soldDate),
  }));
  points = removeOutliers(points);

  const totalWeight = points.reduce((a, p) => a + p.weight, 0);
  const soldPts = points.filter(p => p.comp.status === 'sold');
  const soldCount = soldPts.length;
  const listedCount = points.length - soldCount;
  const shown = [...points]
    .sort((a, b) => b.weight - a.weight || (a.comp.status === 'sold' ? -1 : 1))
    .map(p => p.comp)
    .slice(0, 12);

  const condFactor = CONDITION_FACTOR[item.condition || ''] ?? 0.95;

  if (totalWeight < MIN_WEIGHT || points.length < 2) {
    const price = aiPrice ? roundToPricePoint(aiPrice) : null;
    const found = matched.length
      ? `Only ${matched.length} close match${matched.length === 1 ? '' : 'es'} found`
      : comps.length ? `${comps.length} listings found, but none were the same item` : 'No matching listings found';
    return {
      price, low: price ? roundToPricePoint(price * 0.85, 'down') : null, high: price ? roundToPricePoint(price * 1.15, 'up') : null,
      currency: item.currency, confidence: price ? 20 : 0, confidenceLabel: 'Low',
      basis: price ? 'estimate' : 'none',
      summary: `${found}, so this is the AI's estimate from the brand, era and condition. Worth a quick check before listing.`,
      soldCount, listedCount, comps: shown, rejectedCount, aiPrice,
      steps: price ? [`AI estimate ${sym}${aiPrice}`, `rounded to ${sym}${price}`] : [],
      sources,
    };
  }

  const median = weightedQuantile(points, 0.5);
  const p25 = weightedQuantile(points, 0.25);
  const p75 = weightedQuantile(points, 0.75);
  const price = roundToPricePoint(median * condFactor);

  const quantity = clamp01((totalWeight - 1) / 6);
  const soldShare = clamp01(soldPts.reduce((a, p) => a + p.weight, 0) / totalWeight);
  const spread = median > 0 ? (p75 - p25) / median : 1;
  const agreement = clamp01(1 - spread / 0.9);
  const confidence = Math.round(Math.min(95, 100 * (0.4 * quantity + 0.25 * soldShare + 0.35 * agreement)));
  const confidenceLabel = confidence >= 65 ? 'High' : confidence >= 40 ? 'Medium' : 'Low';

  const sameCount = points.filter(p => p.comp.match === 'same').length;
  const parts = [];
  if (soldCount) parts.push(`${soldCount} sold`);
  if (listedCount) parts.push(`${listedCount} listed`);
  const condNote = condFactor < 1 && CONDITION_FACTOR[item.condition || ''] !== undefined ? ' Priced a little lower for the wear on yours.'
    : condFactor > 1 ? ' Priced a little higher because yours is in better condition.' : '';
  const summary = `Based on ${parts.join(' and ')} ${sameCount === points.length ? 'matches' : `comps (${sameCount} exact)`}. ` +
    `Comparable items ${soldCount ? 'sold' : 'go'} for about ${sym}${Math.round(p25)}–${sym}${Math.round(p75)}.${condNote}`;

  const steps = [
    `${points.length} comps after removing outliers (${rejectedCount} non-matches dropped)`,
    `asking prices × ${ASKING_TO_SALE} to estimate what they'd sell for`,
    `weighted median ${sym}${median.toFixed(2)} (sold & exact matches count most)`,
  ];
  if (condFactor !== 1) steps.push(`× ${condFactor} for condition`);
  steps.push(`rounded to ${sym}${price}`);

  return {
    price,
    low: roundToPricePoint(Math.min(p25 * condFactor, (price ?? 0) * 0.9), 'down'),
    high: roundToPricePoint(Math.max(p75 * condFactor, (price ?? 0) * 1.1), 'up'),
    currency: item.currency, confidence, confidenceLabel,
    basis: soldShare >= 0.5 ? 'sold' : 'market',
    summary, soldCount, listedCount, comps: shown, rejectedCount, aiPrice, steps, sources,
  };
}

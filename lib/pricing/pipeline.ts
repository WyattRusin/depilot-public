import { generate, type Part } from './gemini.ts';
import { searchByImage, searchActive } from './ebay.ts';
import { searchSold } from './sold.ts';
import { searchWeb } from './web.ts';
import { prefilter, judgeComps, suggestBrand, type ItemProfile } from './judge.ts';
import type { CostMeter } from './cost.ts';
import { estimatePrice } from './estimate.ts';
import { market } from './markets.ts';
import { settle, UpstreamError } from './http.ts';
import type { Comp, Pricing } from './types.ts';
import { LISTING_PROMPT } from '../depop/prompt.ts';
import { buildListingSchema } from '../depop/schema.ts';
import { normalizeTags } from '../depop/listing-text.ts';
import { normalizeDating, ageFromDating, datingSummary } from '../depop/dating.ts';
import { matchRealBrand } from '../depop/brands.ts';
import { applyTagGuards, scrubCopy } from '../depop/tag-guard.ts';
import { normalizeMeasurements } from '../depop/measurements.ts';
import { DEPOP_CATEGORY_LEAVES, label } from '../depop/data.ts';

export interface PipelineConfig {
  geminiKey: string;
  visionModels: string[];
  fastModels: string[];
  webModel: string;
  visionThinking?: 'minimal' | 'low' | 'medium' | 'high';
  ebay: { clientId: string; clientSecret: string };
  openWebNinjaKey: string;
  webPrices?: boolean;
  meter?: CostMeter;
}

export interface ImageInput { base64: string; mimeType: string }

export interface Analysis {
  ai: Record<string, any>;
  category: string;
  brand: string;
  imageComps: Comp[];
  model: string;
  timings: Record<string, number>;
  errors: string[];
  debug?: {
    before: Record<string, unknown>;
    guard: { corrections: string[]; wrongBrand: string; rewrite: boolean };
    hints: string[];
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms))]);
}

export function lookAlikeHints(comps: Comp[]): string {
  const titles = comps.slice(0, 10).map((c, i) => `${i + 1}. ${c.title}`);
  if (!titles.length) return '';
  return `Look-alike listings from an image search (unconfirmed hints, see LOOK-ALIKE LISTINGS):\n${titles.join('\n')}`;
}

async function pickLeafCategory(cfg: PipelineConfig, ai: Record<string, any>, deadline: number): Promise<string> {
  const leaves = DEPOP_CATEGORY_LEAVES[ai.categoryGroup] || [];
  if (leaves.length <= 1) return leaves[0] || '';
  const prompt = `An item titled "${ai.title}" (${ai.itemType || ''}; ${String(ai.opener || '').slice(0, 300)}) is in the Depop category group "${ai.categoryGroup}". Pick the single most specific matching category, copied exactly from the allowed list.`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (deadline - Date.now() < 10000) break;
    try {
      const out = await generate({
        apiKey: cfg.geminiKey, models: cfg.fastModels, parts: [{ text: prompt }],
        schema: { type: 'OBJECT', properties: { category: { type: 'STRING', enum: leaves } }, required: ['category'] },
        temperature: 0, timeoutMs: 15000, deadline, meter: cfg.meter, meterLabel: 'category',
      });
      if (leaves.includes(out.json?.category)) return out.json.category;
    } catch (err) {
      console.warn('[category] attempt failed:', (err as Error).message);
    }
  }
  return '';
}

async function rewriteCopy(cfg: PipelineConfig, ai: Record<string, any>, corrections: string[], deadline: number) {
  const draft = {
    title: ai.title, opener: ai.opener, details: ai.details, tags: ai.tags,
    searchQuery: ai.searchQuery, broadQuery: ai.broadQuery,
  };
  const prompt = `A resale listing was drafted from photos, then fact-checked. Apply these corrections:
${corrections.map(c => `- ${c}`).join('\n')}
Correct brand: ${ai.brand ? `"${ai.brand}"` : 'none (leave the brand out)'}. Tag reads: "${ai.tagText || ''}".

Rewrite the draft so nothing depends on the corrected facts: no wrong brand, and no decade, year, "vintage" or "single stitch" claims unless they are observed below or confirmed by the seller above. Keep the same voice (short lowercase fragments, Title Case title), the same item details, and exactly 5 hashtags.
Observed evidence: ${(ai.evidence || []).join('; ')}

Draft:
${JSON.stringify(draft, null, 1)}`;
  const S = { type: 'STRING' };
  const out = await generate({
    apiKey: cfg.geminiKey, models: [cfg.webModel, ...cfg.fastModels], parts: [{ text: prompt }],
    schema: {
      type: 'OBJECT',
      properties: { title: S, opener: S, details: { type: 'ARRAY', items: S }, tags: { type: 'ARRAY', items: S }, searchQuery: S, broadQuery: S },
      required: ['title', 'opener', 'details', 'tags', 'searchQuery', 'broadQuery'],
    },
    thinkingLevel: 'low', temperature: 0.4, timeoutMs: 20_000, deadline, meter: cfg.meter, meterLabel: 'rewrite',
  });
  const r = out.json || {};
  for (const k of ['title', 'opener', 'searchQuery', 'broadQuery']) if (typeof r[k] === 'string' && r[k].trim()) ai[k] = r[k].trim();
  if (Array.isArray(r.details) && r.details.length) ai.details = r.details.map(String);
  if (Array.isArray(r.tags) && r.tags.length) ai.tags = r.tags.map(String);
}

export async function rewriteFromDetails(
  cfg: PipelineConfig,
  ai: Record<string, any>,
  details: { brand: string; age: string; condition: string; size: string; colors: string[]; category: string },
) {
  const facts = [
    `Brand: ${details.brand || 'none (leave the brand out)'}`,
    `Era: ${details.age || 'not proven (no decade, no "vintage")'}`,
    `Condition: ${details.condition || 'unknown'}`,
    `Size: ${details.size || 'not stated'}`,
    `Colour: ${details.colors.filter(Boolean).join(', ') || 'unknown'}`,
    `Category: ${details.category || 'unknown'}`,
  ];
  ai.brand = details.brand;
  await rewriteCopy(cfg, ai, [`The seller confirmed these details. They override the draft wherever they differ:\n${facts.join('\n')}`], Date.now() + 40_000);
}

export async function analyzeItem(cfg: PipelineConfig, images: ImageInput[], currency: string, labels?: string[]): Promise<Analysis> {
  if (!images.length) throw new UpstreamError('No photos', { retryable: false });
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  const m = market(currency);
  const parts: Part[] = [
    { text: `${images.length} photo${images.length > 1 ? 's' : ''} of one item.` },
    ...images.flatMap((img, i) => [
      { text: labels?.[i] || `Photo ${i + 1}:` },
      { inlineData: { mimeType: img.mimeType, data: img.base64 } },
    ]),
  ];

  const t0 = Date.now();
  const deadline = t0 + 95_000;
  const hasEbay = Boolean(cfg.ebay.clientId && cfg.ebay.clientSecret);

  const imageComps = hasEbay
    ? await settle('ebay_image', withTimeout(searchByImage(images[0].base64, cfg.ebay, m.ebayMarketplace), 9000), timings, errors)
    : null;
  const hints = lookAlikeHints(imageComps || []);
  if (hints) parts.push({ text: hints });

  const vision = await generate({
    apiKey: cfg.geminiKey, models: cfg.visionModels, system: LISTING_PROMPT, parts, schema: buildListingSchema(),
    temperature: 1.0, thinkingLevel: cfg.visionThinking ?? 'low', timeoutMs: 60_000, deadline,
    meter: cfg.meter, meterLabel: 'vision',
  });
  timings.vision = vision.ms;

  const ai = vision.json as Record<string, any>;
  const before = {
    brand: ai.brand ?? '', tagText: ai.tagText ?? '', tagLegibility: ai.tagLegibility ?? '',
    era: ai.dating?.era ?? '', datedFrom: ai.dating?.confidence ?? '', title: ai.title ?? '',
  };
  const guard = applyTagGuards(ai);
  ai.checks = guard.corrections;
  if (guard.rewrite) {
    const tr = Date.now();
    await rewriteCopy(cfg, ai, guard.corrections, t0 + 105_000).catch(err => {
      console.warn('[guard] rewrite failed, scrubbing instead:', (err as Error).message);
      scrubCopy(ai, guard);
    });
    timings.rewrite = Date.now() - tr;
  }
  ai.tags = normalizeTags(ai.tags);
  for (const k of ['photos', 'evidence', 'notVisible', 'flaws', 'details']) ai[k] = Array.isArray(ai[k]) ? ai[k] : [];
  ai.measurementsRead = Array.isArray(ai.measurements) ? ai.measurements : [];
  ai.measurements = normalizeMeasurements(ai.measurements);
  ai.dating = normalizeDating(ai.dating);
  ai.age = ageFromDating(ai.dating);
  ai.datingNote = datingSummary(ai.dating);
  ai.brandRaw = ai.brand || '';

  const tc = Date.now();
  const category = await pickLeafCategory(cfg, ai, t0 + 110_000);
  timings.category = Date.now() - tc;
  timings.total = Date.now() - t0;

  return {
    ai, category, brand: matchRealBrand(ai.brand),
    imageComps: imageComps || [], model: vision.model, timings, errors,
    debug: {
      before,
      guard: { corrections: guard.corrections, wrongBrand: guard.wrongBrand, rewrite: guard.rewrite },
      hints: (imageComps || []).slice(0, 10).map(c => c.title),
    },
  };
}

export async function priceItem(
  cfg: PipelineConfig,
  a: { ai: Record<string, any>; brand: string; imageComps: Comp[]; condition?: string; itemImage?: ImageInput | null },
  currency: string,
): Promise<Pricing> {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const errors: string[] = [];
  const m = market(currency);
  const ai = a.ai;
  const query = String(ai.searchQuery || ai.title || '').trim();
  const broad = String(ai.broadQuery || '').trim();
  const condition = a.condition || ai.condition;
  const isNew = /brand new/i.test(condition || '');
  const hasEbay = Boolean(cfg.ebay.clientId && cfg.ebay.clientSecret);

  const soldSearch = async (): Promise<Comp[]> => {
    const first = await searchSold(query, cfg.openWebNinjaKey, m.ebayDomain, m.code, cfg.meter);
    if (first.length >= 3 || !broad || broad.toLowerCase() === query.toLowerCase()) return first;
    const more = await searchSold(broad, cfg.openWebNinjaKey, m.ebayDomain, m.code, cfg.meter).catch(() => []);
    return [...first, ...more];
  };

  const [sold, active, web] = await Promise.all([
    cfg.openWebNinjaKey && query ? settle('ebay_sold', soldSearch(), timings, errors) : null,
    hasEbay && query ? settle('ebay_active', searchActive(query, cfg.ebay, m.ebayMarketplace, { isNew }), timings, errors) : null,
    cfg.webPrices && query ? settle('web', searchWeb(
      { searchQuery: query, broadQuery: broad, itemType: ai.itemType, brand: label(a.brand) || ai.brandRaw, era: ai.age ? label(ai.age) : undefined },
      { apiKey: cfg.geminiKey, model: cfg.webModel, currency: m.code, country: m.country, meter: cfg.meter, deadline: t0 + 45_000 },
    ), timings, errors) : null,
  ]);

  const all = prefilter([...(sold || []), ...a.imageComps, ...(web?.comps || []), ...(active || [])], m.code);

  const profile: ItemProfile = {
    title: ai.title, brand: label(a.brand) || ai.brandRaw || '', model: ai.model, itemType: ai.itemType || '',
    era: ai.dating?.era || 'Unclear', datedFrom: ai.dating?.confidence === 'unclear' ? 'not dated' : `dated from ${ai.dating?.confidence}`,
    provenVintage: Boolean(ai.age) && !/^modern/i.test(ai.age),
    condition: label(condition), keyDetails: [...(ai.evidence || []), ...(ai.details || [])],
  };

  const tj = Date.now();
  let judged: Comp[];
  try {
    judged = await judgeComps(profile, all, {
      apiKey: cfg.geminiKey, models: cfg.fastModels, meter: cfg.meter, deadline: t0 + 100_000,
      itemImage: a.itemImage ? { mimeType: a.itemImage.mimeType, data: a.itemImage.base64 } : null,
    });
  } catch (err) {
    errors.push(`judge: ${(err as Error).message}`);
    judged = all.map(c => ({ ...c, match: 'different' as const }));
  }
  timings.judge = Date.now() - tj;

  const pricing = estimatePrice(judged, { condition, aiPrice: Number(ai.suggestedPrice) || null, currency: m.code, symbol: m.symbol });
  timings.total = Date.now() - t0;
  return {
    ...pricing, errors, timings, brandSuggestion: suggestBrand(judged, a.brand),
    judged, queries: { exact: query, broad, web: Boolean(cfg.webPrices) },
  };
}

export function pipelineConfigFromEnv(env: {
  visionThinking?: string;
  webPrices?: boolean;
  geminiKey: string; visionModel: string; fastModel: string; ebayClientId: string; ebayClientSecret: string; openWebNinjaKey: string;
}): PipelineConfig {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    geminiKey: env.geminiKey,
    visionModels: uniq([env.visionModel, 'gemini-3.5-flash-lite']),
    fastModels: uniq([env.fastModel, 'gemini-3.1-flash-lite']),
    webModel: env.visionModel,
    visionThinking: (['minimal', 'low', 'medium', 'high'].includes(env.visionThinking || '') ? env.visionThinking : 'low') as PipelineConfig['visionThinking'],
    ebay: { clientId: env.ebayClientId, clientSecret: env.ebayClientSecret },
    openWebNinjaKey: env.openWebNinjaKey,
    webPrices: Boolean(env.webPrices),
  };
}

import type { Repo, ListingRow, Profile } from './types.ts';
import type { Comp } from '../pricing/types.ts';
import type { PipelineConfig, Analysis } from '../pricing/pipeline.ts';
import { analyzeItem, priceItem, rewriteFromDetails } from '../pricing/pipeline.ts';
import type { Pricing } from '../pricing/types.ts';
import { CostMeter } from '../pricing/cost.ts';
import {
  classifyPhotos, planOrder, arrangedPaths, normalizeReads, photoLabels, slotOfPath, type PhotoRead, type PhotoRole, type Plan,
} from '../pricing/arrange.ts';
import { redact } from '../pricing/http.ts';
import { CURRENCY_CODES, market } from '../pricing/markets.ts';
import { fieldsFromModel, type DepopFields } from '../depop/fields.ts';
import { validateListing, buildCsv } from '../depop/csv.ts';
import { buildListingText, normalizeTags } from '../depop/listing-text.ts';
import { matchBrand } from '../depop/brands.ts';
import { normalizeMeasurements, applyMeasurementsLine } from '../depop/measurements.ts';
import { normalizeSize, isValidSize } from '../depop/sizes.ts';
import {
  DEPOP_LOCATIONS, DEPOP_CATEGORIES, DEPOP_CONDITIONS, DEPOP_COLORS, DEPOP_SOURCES, DEPOP_AGES, DEPOP_STYLES, label, isNoBrand,
} from '../depop/data.ts';

export class ApiError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export interface Deps {
  repo: Repo;
  pipeline: PipelineConfig;
  limits: { monthly: number };
  budgetCents: number;
  analyze?: typeof analyzeItem;
  arrange?: typeof classifyPhotos;
  price?: typeof priceItem;
  rewrite?: typeof rewriteFromDetails;
  admin?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTOS = 8;
const MAX_PRICE_RUNS = 2;
const MAX_REWRITES = 3;
const DAY = 86_400_000;
const ADMIN_RUNS = 99;
export const CLEANUP = { afterExportDays: 30, afterUploadDays: 90 };

async function ensureProfile(repo: Repo, userId: string, email?: string | null): Promise<Profile> {
  return (await repo.getProfile(userId)) || repo.updateProfile(userId, { email: email ?? null } as Partial<Profile>);
}

function firstOfNextMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export async function usage(deps: Deps, userId: string, profile?: Profile) {
  const p = profile || (await ensureProfile(deps.repo, userId));
  const [counts, spend, askedForMore] = await Promise.all([
    deps.repo.usageCounts(userId), deps.repo.monthSpendCents(), deps.repo.hasEvent(userId, 'interest'),
  ]);
  const monthlyLeft = Math.max(0, deps.limits.monthly - counts.used_month);
  return {
    month: counts.used_month,
    monthlyLimit: deps.limits.monthly,
    bonusCredits: p.bonus_credits,
    left: deps.admin ? 999 : monthlyLeft + p.bonus_credits,
    paused: !deps.admin && spend >= deps.budgetCents,
    monthResets: firstOfNextMonth(),
    admin: Boolean(deps.admin),
    askedForMore,
  };
}
export type Usage = Awaited<ReturnType<typeof usage>>;

async function spendAndCheck(deps: Deps) {
  if (deps.admin) return;
  if ((await deps.repo.monthSpendCents()) >= deps.budgetCents) {
    throw new ApiError(503, "Depilot has reached this month's capacity. New listings are back on the 1st.", { code: 'paused' });
  }
}

async function takeSlot(deps: Deps, userId: string, key: string, limit: number, windowSec: number) {
  try {
    return await deps.repo.takeSlot(userId, key, limit, windowSec);
  } catch (err) {
    console.error('[rate-limit] check skipped:', (err as Error).message);
    return true;
  }
}

async function saveRow(deps: Deps, userId: string, id: string, build: (row: ListingRow) => Partial<ListingRow>): Promise<ListingRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await deps.repo.getListing(userId, id);
    if (!row) throw new ApiError(404, 'This item was deleted.');
    const saved = await deps.repo.updateListingIf(userId, id, build(row), row.updated_at);
    if (saved) return saved;
  }
  throw new ApiError(409, 'This item was changing while you saved. Please try again.');
}

function cut(s: string, max: number) {
  if (s.length <= max) return s;
  const t = s.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(t) ? t.slice(0, -1) : t;
}

async function withLock<T>(deps: Deps, userId: string, key: string, seconds: number, busy: string, run: () => Promise<T>): Promise<T> {
  if (!(await takeSlot(deps, userId, key, 1, seconds))) throw new ApiError(429, busy, { code: 'busy' });
  try {
    return await run();
  } finally {
    await deps.repo.releaseSlot(userId, key).catch(() => {});
  }
}

const thumbOf = (path: string) => path.replace(/\.(jpe?g|png|webp)$/i, '_t.jpg');

function eraNote(ai: Record<string, any>): string {
  const d = ai.dating || {};
  const age = String(ai.age || '');
  if (age && !/^modern/i.test(age)) return `${label(age)}, confirmed from the ${d.confidence === 'tag' ? 'label' : 'construction'}`;
  if (/^modern/i.test(age) || /^modern/i.test(d.era || '')) return 'Modern';
  if (d.era && !/^unclear/i.test(d.era) && d.confidence === 'style') {
    return `Not confirmed. The design looks ${label(d.era)}, but nothing on the garment shows when it was made`;
  }
  return 'Not confirmed from the photos';
}

const trimComp = (c: Comp) => ({
  title: c.title, price: c.price, currency: c.currency, source: c.source, status: c.status, site: c.site,
  url: c.url, soldDate: c.soldDate, match: c.match, brandNamed: c.brandNamed,
});

function debugView(row: ListingRow) {
  const ai = row.ai || {};
  const pr: Record<string, any> = row.pricing || {};
  const d: Record<string, any> = pr.debug || {};
  return {
    totalCents: Number(d.totalCents) || 0,
    analysis: (d.analysis || null) as Record<string, any> | null,
    priceRuns: (d.priceRuns || []) as Record<string, any>[],
    rewrites: (d.rewrites || []) as Record<string, any>[],
    read: {
      tagText: String(ai.tagText ?? ''), tagLegibility: String(ai.tagLegibility ?? ''), brand: String(ai.brandRaw ?? ai.brand ?? ''),
      dating: (ai.dating ?? null) as Record<string, any> | null, age: String(ai.age ?? ''),
      evidence: (ai.evidence ?? []) as string[], notVisible: (ai.notVisible ?? []) as string[],
      searchQuery: String(ai.searchQuery ?? ''), broadQuery: String(ai.broadQuery ?? ''),
      suggestedPrice: (ai.suggestedPrice ?? null) as number | null, checks: (ai.checks ?? []) as string[],
    },
    price: {
      confidence: (pr.confidence ?? null) as number | null, aiPrice: (pr.aiPrice ?? null) as number | null,
      steps: (pr.steps ?? []) as string[], sources: (pr.sources ?? {}) as Record<string, number>,
      errors: (pr.errors ?? []) as string[], timings: (pr.timings ?? {}) as Record<string, number>,
    },
    ai: ai as Record<string, unknown>,
  };
}
export type DebugView = ReturnType<typeof debugView>;

export function toClient(row: ListingRow, repo: Repo, admin = false) {
  const ai = row.ai || {};
  const pr: Record<string, any> = row.pricing || {};
  const removed = Boolean(row.photos_deleted_at);
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    photos: removed ? [] : row.photo_paths.map(p => repo.publicUrl(p)),
    thumbs: removed ? [] : row.photo_paths.map(p => repo.publicUrl(thumbOf(p))),
    photosRemoved: removed,
    title: ai.title || '',
    description: row.description || '',
    price: row.price,
    fields: row.fields,
    pricing: row.pricing ? {
      pending: Boolean(pr.pending),
      price: pr.price ?? null, low: pr.low ?? null, high: pr.high ?? null,
      currency: pr.currency || 'USD',
      confidenceLabel: pr.confidenceLabel as 'High' | 'Medium' | 'Low' | undefined,
      basis: pr.basis as Pricing['basis'] | undefined,
      summary: pr.summary || '',
      soldCount: pr.soldCount ?? 0, listedCount: pr.listedCount ?? 0, rejectedCount: pr.rejectedCount ?? 0,
      comps: (pr.comps || []) as Pricing['comps'],
      userPriced: Boolean(pr.userPriced),
      recheckLeft: admin ? ADMIN_RUNS : Math.max(0, MAX_PRICE_RUNS - (pr.runs || 0)),
      brandSuggestion: pr.brandSuggestion || null,
    } : null,
    insights: row.ai ? {
      tagRead: String(ai.tagText || ''),
      tagHint: Boolean(ai.tagLegibility) && ai.tagLegibility !== 'clear',
      era: eraNote(ai),
      flaws: (ai.flaws || []) as string[],
      notVisible: (ai.notVisible || []) as string[],
      notes: (Array.isArray(ai.checks) ? ai.checks : []) as string[],
    } : null,
    measurements: normalizeMeasurements(ai.measurements),
    rewritesLeft: admin ? ADMIN_RUNS : Math.max(0, MAX_REWRITES - (row.rewrites || 0)),
    validation: row.fields ? validateListing(row.fields) : null,
    exportedAt: row.exported_at,
    error: row.error,
    debug: admin ? debugView(row) : undefined,
  };
}
export type ClientListing = ReturnType<typeof toClient>;

export function friendly(err: unknown, secrets: string[]): string {
  const msg = redact((err as Error)?.message || err, secrets);
  if (/safety|blocked|no usable output/i.test(msg)) return "We couldn't read these photos. Try brighter, sharper photos of the item and its tag.";
  if (/timed out/i.test(msg)) return 'This took longer than usual. Please try again.';
  if (/\(429\)|\(503\)|quota|rate limit|RESOURCE_EXHAUSTED|overloaded/i.test(msg)) return 'Depilot is busy right now. Please try again in a minute.';
  return 'Something went wrong on our side. Please try again in a few minutes.';
}

function logError(where: string, err: unknown, deps: Deps) {
  console.error(`[${where}]`, redact((err as Error)?.message || err, [deps.pipeline.geminiKey, deps.pipeline.openWebNinjaKey]));
}

async function logSpend(deps: Deps, userId: string, kind: string, meter: CostMeter) {
  await deps.repo.logSpend({ user_id: userId, kind, cents: meter.cents }).catch(err => logError('spend', err, deps));
}

export async function getMe(deps: Deps, user: { id: string; email?: string | null }) {
  const profile = await ensureProfile(deps.repo, user.id, user.email);
  return {
    id: user.id,
    email: profile.email || user.email || null,
    name: profile.full_name,
    avatar: profile.avatar_url,
    settings: {
      location: profile.location, currency: profile.currency,
      domesticShipping: profile.domestic_shipping, intlShipping: profile.intl_shipping,
      theme: (profile.theme || 'light') as 'light' | 'dark' | 'system',
    },
    usage: await usage(deps, user.id, profile),
  };
}

export async function saveSettings(deps: Deps, userId: string, body: any) {
  const patch: Partial<Profile> = {};
  if (body?.location !== undefined) {
    if (!DEPOP_LOCATIONS.includes(body.location)) throw new ApiError(400, 'Pick a location from the list');
    patch.location = body.location;
  }
  if (body?.currency !== undefined) {
    if (!CURRENCY_CODES.includes(body.currency)) throw new ApiError(400, 'Unsupported currency');
    patch.currency = body.currency;
  }
  if (body?.theme !== undefined) {
    if (!['light', 'dark', 'system'].includes(body.theme)) throw new ApiError(400, 'Pick light, dark or system');
    patch.theme = body.theme;
  }
  for (const [k, col] of [['domesticShipping', 'domestic_shipping'], ['intlShipping', 'intl_shipping']] as const) {
    if (body?.[k] === undefined) continue;
    const v = body[k];
    if (v === null || v === '') { patch[col] = null; continue; }
    const n = Number(v);
    if (!isFinite(n) || n < 0 || n > 1000) throw new ApiError(400, 'Shipping must be a number between 0 and 1000, or blank');
    patch[col] = Math.round(n * 100) / 100;
  }
  await ensureProfile(deps.repo, userId);
  await deps.repo.updateProfile(userId, patch);
  return getMe(deps, { id: userId });
}

interface ArrangeNote { by: 'seller' | 'quick' | 'read' | 'none'; roles?: PhotoRole[]; order?: number[]; changed?: boolean; moved?: boolean }

async function quickSort(deps: Deps, cfg: PipelineConfig, paths: string[]): Promise<PhotoRead[] | null> {
  try {
    const thumbs = await Promise.all(paths.map(p => deps.repo.downloadPhoto(thumbOf(p)).catch(() => deps.repo.downloadPhoto(p))));
    return await (deps.arrange || classifyPhotos)(cfg, thumbs);
  } catch (err) {
    console.warn('[arrange] quick sort skipped:', (err as Error).message);
    return null;
  }
}

async function applyPlan(deps: Deps, userId: string, id: string, paths: string[], plan: Plan): Promise<string[] | null> {
  const next = arrangedPaths(paths, plan);
  const pairs = next.map((to, k) => [paths[plan.order[k]], to] as const);
  const undo = (moved: boolean[]) => Promise.all(pairs.map(async ([from, to], k) => {
    if (!moved[k]) return;
    await deps.repo.movePhoto(to, from).catch(() => {});
    await deps.repo.movePhoto(thumbOf(to), thumbOf(from)).catch(() => {});
  }));
  const results = await Promise.allSettled(pairs.map(async ([from, to]) => {
    await deps.repo.movePhoto(from, to);
    await deps.repo.movePhoto(thumbOf(from), thumbOf(to)).catch(() => {});
  }));
  if (results.some(r => r.status === 'rejected')) {
    const why = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
    console.warn('[arrange] rename failed, keeping the original order:', (why as Error)?.message);
    await undo(results.map(r => r.status === 'fulfilled'));
    return null;
  }
  try {
    await deps.repo.updateListing(userId, id, { photo_paths: next });
  } catch (err) {
    console.warn('[arrange] saving the new order failed, putting the photos back:', (err as Error).message);
    await undo(pairs.map(() => true));
    return null;
  }
  return next;
}

export async function createListing(deps: Deps, userId: string, body: any) {
  const id = String(body?.id || '');
  if (!UUID.test(id)) throw new ApiError(400, 'Invalid listing id');
  let paths: string[] = Array.isArray(body?.photoPaths) ? body.photoPaths.map(String) : [];
  if (!paths.length) throw new ApiError(400, 'Add at least one photo');
  const wantsArrange = body?.arrange === true && paths.length > 1;
  if (paths.length > MAX_PHOTOS) throw new ApiError(400, `Up to ${MAX_PHOTOS} photos per item`);
  const pathRe = photoPathRe(userId, id);
  if (!paths.every(p => pathRe.test(p))) throw new ApiError(400, 'Photo paths do not belong to this listing');

  const existing = await deps.repo.getListing(userId, id);
  if (existing) return { listing: toClient(existing, deps.repo, deps.admin), usage: await usage(deps, userId) };

  await spendAndCheck(deps);
  const profile = await ensureProfile(deps.repo, userId);
  await deps.repo.insertListing({ id, user_id: userId, photo_paths: paths, status: 'analyzing' });

  const quota = deps.admin
    ? { ok: true, reason: '' as const }
    : await deps.repo.consumeListing(userId, deps.limits.monthly, deps.limits.monthly, id);
  if (!quota.ok) {
    await deps.repo.deleteListing(userId, id);
    await deps.repo.removePhotos([...paths, ...paths.map(thumbOf)]).catch(() => {});
    const message = `You've used this month's ${deps.limits.monthly} free listings. More on the 1st.`;
    throw new ApiError(429, message, { code: 'monthly', usage: await usage(deps, userId) });
  }

  const meter = new CostMeter();
  const cfg = { ...deps.pipeline, meter };
  let analysis: Analysis;
  let arranged: ArrangeNote = { by: wantsArrange ? 'none' : 'seller' };
  try {
    const [downloaded, reads] = await Promise.all([
      Promise.all(paths.map(p => deps.repo.downloadPhoto(p))),
      wantsArrange ? quickSort(deps, cfg, paths) : null,
    ]);
    let images = downloaded;
    let roles: (PhotoRole | null)[] | undefined;
    let slots = paths.map(slotOfPath);
    if (reads) {
      roles = reads.map(r => r.role);
      const plan = planOrder(reads, slots);
      const moved = plan.changed ? await applyPlan(deps, userId, id, paths, plan) : null;
      if (moved) {
        images = plan.order.map(i => downloaded[i]);
        paths = moved; roles = plan.roles; slots = plan.slots;
      }
      arranged = { by: 'quick', roles: plan.roles, order: plan.order, changed: plan.changed, moved: Boolean(moved) };
    }
    analysis = await (deps.analyze || analyzeItem)(cfg, images, profile.currency, photoLabels(images.length, roles, slots));

    if (wantsArrange && !reads) {
      const fromRead = normalizeReads(analysis.ai?.photos, paths.length);
      if (fromRead) {
        const plan = planOrder(fromRead, slots);
        const moved = plan.changed ? await applyPlan(deps, userId, id, paths, plan) : null;
        if (moved) paths = moved;
        arranged = { by: 'read', roles: plan.roles, order: plan.order, changed: plan.changed, moved: Boolean(moved) };
      }
    }
  } catch (err) {
    logError('createListing', err, deps);
    await logSpend(deps, userId, 'analyse', meter);
    await deps.repo.refundAnalysis(userId, id).catch(() => {});
    const message = friendly(err, [deps.pipeline.geminiKey]);
    const detail = redact((err as Error)?.message || err, [deps.pipeline.geminiKey, deps.pipeline.openWebNinjaKey]);
    const row = await deps.repo.updateListing(userId, id, {
      status: 'error', error: message,
      pricing: { debug: { totalCents: meter.cents, analysis: {
        at: new Date().toISOString(), failed: detail, cents: meter.cents, parts: meter.parts,
        ...(wantsArrange ? { arrange: true } : {}),
      } } } as any,
    });
    throw new ApiError(502, message, { listing: toClient(row, deps.repo, deps.admin), usage: await usage(deps, userId) });
  }
  await logSpend(deps, userId, 'analyse', meter);

  const fields = fieldsFromModel(analysis.ai, {
    category: analysis.category, brand: analysis.brand, location: profile.location,
    photoUrls: paths.map(p => deps.repo.publicUrl(p)),
    domesticShipping: profile.domestic_shipping, intlShipping: profile.intl_shipping,
    sku: id.slice(0, 8), price: null,
  });
  const row = await deps.repo.updateListing(userId, id, {
    status: 'pricing', ai: analysis.ai, fields, description: fields.description,
    pricing: {
      pending: true, imageComps: analysis.imageComps, runs: 0, timings: analysis.timings,
      debug: {
        totalCents: meter.cents,
        analysis: {
          at: new Date().toISOString(), model: analysis.model, timings: analysis.timings, errors: analysis.errors,
          cents: meter.cents, parts: meter.parts, ...(analysis.debug || {}), arranged,
        },
      },
    } as any,
    error: null,
  });
  return { listing: toClient(row, deps.repo, deps.admin), usage: await usage(deps, userId, profile) };
}

export function priceListing(deps: Deps, userId: string, id: string) {
  return withLock(deps, userId, `price:${id}`, 130, 'This item is already being priced.', () => priceNow(deps, userId, id));
}
async function priceNow(deps: Deps, userId: string, id: string) {
  const row = await deps.repo.getListing(userId, id);
  if (!row) throw new ApiError(404, 'Listing not found');
  if (!row.ai || !row.fields) throw new ApiError(409, 'This item has not been analysed yet');
  const prev: Record<string, any> = row.pricing || {};
  const runs = prev.runs || 0;
  if (!deps.admin && runs >= MAX_PRICE_RUNS) throw new ApiError(429, 'The price has already been re-checked for this item');
  if (runs >= 1) await spendAndCheck(deps);

  const profile = await ensureProfile(deps.repo, userId);
  let itemImage = null;
  if (!row.photos_deleted_at && row.photo_paths[0]) {
    itemImage = await deps.repo.downloadPhoto(thumbOf(row.photo_paths[0]))
      .catch(() => deps.repo.downloadPhoto(row.photo_paths[0])).catch(() => null);
  }

  const meter = new CostMeter();
  let pricing: Pricing;
  try {
    pricing = await (deps.price || priceItem)({ ...deps.pipeline, meter, webPrices: deps.pipeline.webPrices || Boolean(deps.admin) }, {
      ai: row.ai, brand: isNoBrand(row.fields.brand) ? '' : row.fields.brand, imageComps: prev.imageComps || [], condition: row.fields.condition, itemImage,
    }, profile.currency);
    if (pricing.errors?.length) logError('priceListing sources', pricing.errors.join(' | '), deps);
  } catch (err) {
    logError('priceListing', err, deps);
    const fallback = Number(row.ai.suggestedPrice) || null;
    pricing = {
      price: fallback, low: null, high: null, currency: market(profile.currency).code,
      confidence: fallback ? 15 : 0, confidenceLabel: 'Low', basis: fallback ? 'estimate' : 'none',
      summary: "We couldn't reach the price sources just now, so this is an estimate. You can re-check the price in a minute.",
      soldCount: 0, listedCount: 0, comps: [], rejectedCount: 0, aiPrice: fallback, steps: [],
      sources: { ebay_sold: 0, ebay_image: 0, ebay_active: 0, web: 0 },
    };
  }
  await logSpend(deps, userId, 'price', meter);

  const { judged, queries, ...kept } = pricing;
  const run = {
    at: new Date().toISOString(), cents: meter.cents, parts: meter.parts, queries: queries || null,
    timings: pricing.timings || {}, errors: pricing.errors || [], sources: pricing.sources,
    basis: pricing.basis, confidence: pricing.confidence, price: pricing.price,
    judged: (judged || []).map(trimComp),
  };
  const updated = await saveRow(deps, userId, id, latest => {
    const now: Record<string, any> = latest.pricing || {};
    const userPriced = Boolean(now.userPriced);
    const price = userPriced ? latest.price : pricing.price;
    const prevDebug: Record<string, any> = now.debug || {};
    const debug = {
      ...prevDebug,
      totalCents: (Number(prevDebug.totalCents) || 0) + meter.cents,
      priceRuns: [...(prevDebug.priceRuns || []), run].slice(-5),
    };
    return {
      status: 'ready', price, fields: { ...(latest.fields || row.fields!), price },
      pricing: { ...kept, pending: false, imageComps: now.imageComps ?? prev.imageComps, runs: (now.runs || 0) + 1, userPriced, debug } as any,
    };
  });
  return { listing: toClient(updated, deps.repo, deps.admin) };
}

export function rewriteListing(deps: Deps, userId: string, id: string) {
  return withLock(deps, userId, `rewrite:${id}`, 70, 'This description is already being updated.', () => rewriteNow(deps, userId, id));
}
async function rewriteNow(deps: Deps, userId: string, id: string) {
  const row = await deps.repo.getListing(userId, id);
  if (!row || !row.fields || !row.ai) throw new ApiError(404, 'Listing not found');
  if (!deps.admin && (row.rewrites || 0) >= MAX_REWRITES) throw new ApiError(429, `This description has already been updated ${MAX_REWRITES} times`);
  await spendAndCheck(deps);

  const f = row.fields;
  const ai = structuredClone(row.ai);
  const meter = new CostMeter();
  try {
    await (deps.rewrite || rewriteFromDetails)({ ...deps.pipeline, meter }, ai, {
      brand: isNoBrand(f.brand) ? '' : label(f.brand), age: label(f.age), condition: label(f.condition), size: f.size,
      colors: [label(f.color1), label(f.color2)], category: label(f.category),
    });
  } catch (err) {
    logError('rewriteListing', err, deps);
    await logSpend(deps, userId, 'rewrite', meter);
    throw new ApiError(502, friendly(err, [deps.pipeline.geminiKey]));
  }
  await logSpend(deps, userId, 'rewrite', meter);

  ai.tags = normalizeTags(ai.tags);
  const COPY = ['title', 'opener', 'details', 'tags', 'searchQuery', 'broadQuery', 'brand'] as const;
  const updated = await saveRow(deps, userId, id, latest => {
    const nextAi: Record<string, any> = { ...(latest.ai || ai) };
    for (const k of COPY) nextAi[k] = ai[k];
    const description = buildListingText(nextAi);
    const pr: Record<string, any> = latest.pricing || {};
    const prevDebug: Record<string, any> = pr.debug || {};
    const debug = {
      ...prevDebug,
      totalCents: (Number(prevDebug.totalCents) || 0) + meter.cents,
      rewrites: [...(prevDebug.rewrites || []), { at: new Date().toISOString(), cents: meter.cents }].slice(-10),
    };
    return {
      ai: nextAi, description, fields: { ...(latest.fields || f), description }, rewrites: (latest.rewrites || 0) + 1,
      pricing: latest.pricing ? { ...latest.pricing, debug } as any : latest.pricing,
    };
  });
  return { listing: toClient(updated, deps.repo, deps.admin) };
}

const ENUMS: Partial<Record<keyof DepopFields, string[]>> = {
  category: DEPOP_CATEGORIES, condition: DEPOP_CONDITIONS, color1: DEPOP_COLORS, color2: DEPOP_COLORS,
  source1: DEPOP_SOURCES, source2: DEPOP_SOURCES, age: DEPOP_AGES,
  style1: DEPOP_STYLES, style2: DEPOP_STYLES, style3: DEPOP_STYLES,
};

export async function editListing(deps: Deps, userId: string, id: string, patch: any) {
  const p = patch || {};
  const updated = await saveRow(deps, userId, id, row => applyEdit(row, p));
  return { listing: toClient(updated, deps.repo, deps.admin) };
}

function applyEdit(row: ListingRow, p: Record<string, any>): Partial<ListingRow> {
  if (!row.fields) throw new ApiError(404, 'Listing not found');
  const f: DepopFields = { ...row.fields };
  let userPriced = Boolean(row.pricing?.userPriced);

  let ai = row.ai;
  const firstLine = (t: string) => t.split('\n')[0].trim();
  const oldTitle = String(row.ai?.title || '').trim();
  if (p.description !== undefined) {
    f.description = cut(String(p.description).replace(/\r\n/g, '\n'), 2000);
    const head = firstLine(f.description);
    if (oldTitle && firstLine(row.description || '') === oldTitle && head && head.length <= 80 && head !== oldTitle) {
      ai = { ...(ai || {}), title: head };
    }
  }
  if (p.title !== undefined) {
    const t = cut(String(p.title || '').replace(/\s+/g, ' ').trim(), 80).trim();
    if (!t) throw new ApiError(400, 'Give the item a title');
    const lines = f.description.split('\n');
    if (oldTitle && lines[0].trim() === oldTitle) lines[0] = t;
    else lines.unshift(t, '');
    f.description = lines.join('\n');
    ai = { ...(ai || {}), title: t };
  }
  if (p.price !== undefined) {
    const n = p.price === null || p.price === '' ? null : Math.round(Number(p.price) * 100) / 100;
    if (n !== null && (!isFinite(n) || n <= 0 || n > 100000)) throw new ApiError(400, 'Price must be a positive number');
    f.price = n;
    userPriced = n !== null;
  }
  for (const [k, list] of Object.entries(ENUMS) as [keyof DepopFields, string[]][]) {
    if (p[k] === undefined) continue;
    const v = p[k] === null ? '' : String(p[k]);
    if (v && !list.includes(v)) throw new ApiError(400, `"${v}" is not a valid Depop option`);
    (f as any)[k] = v;
  }
  if (p.brand !== undefined) {
    const raw = String(p.brand || '').trim();
    if (raw.length > 100) throw new ApiError(400, 'That brand name is too long');
    const matched = raw ? matchBrand(raw) : '';
    if (raw && !matched) throw new ApiError(400, `"${raw}" isn't on Depop's brand list. Pick one from the suggestions or choose Other.`);
    f.brand = isNoBrand(matched) ? '' : matched;
  }
  if (p.size !== undefined) {
    const size = String(p.size || '').replace(/[\u0000-\u001f]/g, '').trim();
    if (size.length > 30) throw new ApiError(400, 'That size is too long');
    f.size = size;
  }
  if (f.size && !isValidSize(f.size, f.category)) f.size = normalizeSize(f.size, f.category);

  const pricing = row.pricing ? { ...row.pricing, userPriced } : row.pricing;
  if (p.brand !== undefined && pricing) pricing.brandSuggestion = null;

  if (p.measurements !== undefined) {
    const ms = normalizeMeasurements(p.measurements);
    ai = { ...(ai || {}), measurements: ms };
    f.description = applyMeasurementsLine(f.description, ms);
  }

  return { fields: f, description: f.description, price: f.price, pricing, ...(ai !== row.ai ? { ai } : {}) };
}

const photoPathRe = (userId: string, id: string) => new RegExp(`^${userId}/${id}/[A-Za-z0-9-]{1,40}\\.(jpg|jpeg|png|webp)$`);

export async function editPhotos(deps: Deps, userId: string, id: string, body: any) {
  const add = body?.add ? String(body.add) : '';
  const remove = body?.remove ? String(body.remove) : '';
  const cover = body?.cover ? String(body.cover) : '';
  if (add && !photoPathRe(userId, id).test(add)) throw new ApiError(400, 'Photo paths do not belong to this listing');

  const updated = await saveRow(deps, userId, id, row => {
    if (!row.fields) throw new ApiError(404, 'Listing not found');
    if (row.photos_deleted_at) throw new ApiError(409, 'Photos for this item were removed. Upload it again to change them.');
    let paths = row.photo_paths.slice();
    if (cover) {
      if (!paths.includes(cover)) throw new ApiError(400, 'That photo is not on this item');
      paths = [cover, ...paths.filter(x => x !== cover)];
    } else {
      if (remove && !paths.includes(remove)) throw new ApiError(400, 'That photo is not on this item');
      if (add && remove) paths = paths.map(x => (x === remove ? add : x));
      else if (remove) {
        if (paths.length <= 1) throw new ApiError(400, 'An item needs at least one photo');
        paths = paths.filter(x => x !== remove);
      } else if (add && !paths.includes(add)) {
        if (paths.length >= MAX_PHOTOS) throw new ApiError(400, `Up to ${MAX_PHOTOS} photos per item`);
        paths.push(add);
      }
    }
    return { photo_paths: paths, fields: { ...row.fields, photoUrls: paths.map(x => deps.repo.publicUrl(x)) } };
  });
  if (remove && remove !== add && !updated.photo_paths.includes(remove)) {
    await deps.repo.removePhotos([remove, thumbOf(remove)]).catch(() => {});
  }
  return { listing: toClient(updated, deps.repo, deps.admin) };
}

const STUCK_MS = 3 * 60_000;
const isReading = (row: ListingRow) => row.status === 'analyzing' && Date.now() - Date.parse(row.created_at) <= STUCK_MS;

export async function retryListing(deps: Deps, userId: string, id: string) {
  return withLock(deps, userId, `read:${id}`, 160, 'This item is already being read.', () => retryNow(deps, userId, id));
}
async function retryNow(deps: Deps, userId: string, id: string) {
  const row = await deps.repo.getListing(userId, id);
  if (!row) throw new ApiError(404, 'Listing not found');
  const stuck = row.status === 'analyzing' && !isReading(row);
  if (row.status !== 'error' && !stuck) return { listing: toClient(row, deps.repo, deps.admin), usage: await usage(deps, userId) };
  if (!deps.admin && !(await takeSlot(deps, userId, 'retry', 15, 86_400))) {
    throw new ApiError(429, 'That\'s a lot of retries for one day. Try again tomorrow, or delete the item and upload it again.');
  }
  if (stuck) await deps.repo.refundAnalysis(userId, id).catch(() => {});
  await spendAndCheck(deps);
  if (!deps.admin) {
    const u = await usage(deps, userId);
    if (u.left <= 0) throw new ApiError(429, `You've used this month's ${deps.limits.monthly} free listings. More on the 1st.`, { code: 'monthly', usage: u });
  }
  await deps.repo.deleteListing(userId, id);
  const arrange = (row.pricing as Record<string, any> | null)?.debug?.analysis?.arrange;
  return createListing(deps, userId, { id, photoPaths: row.photo_paths, ...(arrange ? { arrange: true } : {}) });
}

export async function removeListing(deps: Deps, userId: string, id: string) {
  const row = await deps.repo.getListing(userId, id);
  if (!row) return { ok: true };
  if (isReading(row)) throw new ApiError(409, 'This item is still being read. Delete it once it’s done.');
  await deps.repo.deleteListing(userId, id);
  if (!row.photos_deleted_at) {
    await deps.repo.removePhotos([...row.photo_paths, ...row.photo_paths.map(thumbOf)]).catch(() => {});
  }
  return { ok: true };
}

export async function removeListings(deps: Deps, userId: string, body: any) {
  const ids: string[] = Array.isArray(body?.ids) ? [...new Set<string>(body.ids.map(String))].filter(x => UUID.test(x)) : [];
  if (!ids.length) throw new ApiError(400, 'Choose at least one item');
  if (ids.length > 200) throw new ApiError(400, 'Up to 200 items at a time');
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const row = await deps.repo.getListing(userId, id);
    if (!row) { deleted.push(id); continue; }
    if (isReading(row)) { skipped.push(id); continue; }
    await removeListing(deps, userId, id);
    deleted.push(id);
  }
  return { deleted, skipped };
}

export async function listListings(deps: Deps, userId: string) {
  const rows = await deps.repo.listListings(userId, 200);
  return { listings: rows.map(r => toClient(r, deps.repo, deps.admin)), usage: await usage(deps, userId) };
}

export async function bootstrap(deps: Deps, user: { id: string; email?: string | null }) {
  const [me, rows] = await Promise.all([getMe(deps, user), deps.repo.listListings(user.id, 200)]);
  return { me, listings: rows.map(r => toClient(r, deps.repo, deps.admin)) };
}

export async function exportCsv(deps: Deps, userId: string, ids: unknown) {
  const wanted = new Set(Array.isArray(ids) ? ids.slice(0, 1000).map(String).filter(i => UUID.test(i)) : []);
  if (!wanted.size) throw new ApiError(400, 'Select at least one listing');
  const profile = await ensureProfile(deps.repo, userId);
  const rows = (await deps.repo.listListings(userId, 5000)).filter(r => wanted.has(r.id) && r.fields);
  const gone = rows.filter(r => r.photos_deleted_at);
  const items = rows.filter(r => !r.photos_deleted_at).map(r => ({
    id: r.id, title: r.ai?.title || 'Untitled',
    fields: {
      ...r.fields!, location: profile.location,
      domesticShipping: profile.domestic_shipping, intlShipping: profile.intl_shipping,
    },
  }));
  const result = buildCsv(items, { isKnownBrand: b => matchBrand(b) === b });
  for (const r of gone) {
    result.rejected.push({
      id: r.id, title: r.ai?.title || 'Untitled', fields: ['photos'],
      errors: ['Photos are removed 30 days after export. Upload the item again to export it.'],
    });
  }
  await deps.repo.markExported(userId, result.included);
  return result;
}

export async function cleanupPhotos(deps: Deps, now = Date.now()) {
  const exportedBefore = new Date(now - CLEANUP.afterExportDays * DAY).toISOString();
  const createdBefore = new Date(now - CLEANUP.afterUploadDays * DAY).toISOString();
  const rows = await deps.repo.listForCleanup(exportedBefore, createdBefore, 300);
  const due = rows.filter(r =>
    (r.exported_at && r.exported_at < exportedBefore) || r.created_at < createdBefore);
  const paths = due.flatMap(r => [...r.photo_paths, ...r.photo_paths.map(thumbOf)]);
  for (let i = 0; i < paths.length; i += 900) await deps.repo.removePhotos(paths.slice(i, i + 900));
  await deps.repo.markPhotosDeleted(due.map(r => r.id));

  const orphans = await deps.repo.orphanPhotos(2000).catch(err => (console.error('[cleanup] orphans skipped:', err.message), [] as string[]));
  for (let i = 0; i < orphans.length; i += 900) await deps.repo.removePhotos(orphans.slice(i, i + 900));
  await deps.repo.pruneRateLimits().catch(() => {});
  return { listings: due.length, files: paths.length, orphans: orphans.length };
}

export async function registerInterest(deps: Deps, userId: string) {
  if (!(await deps.repo.hasEvent(userId, 'interest'))) await deps.repo.logEvent(userId, 'interest');
  return { ok: true, usage: await usage(deps, userId) };
}

function startOfMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function adminStats(deps: Deps, now = new Date()) {
  if (!deps.admin) throw new ApiError(404, 'Not found');
  const since = startOfMonth(now);
  const snap = await deps.repo.adminSnapshot(since);
  const emailOf = new Map(snap.profiles.map(p => [p.id, p.email || '(no email)']));
  const round = (n: number) => Math.round(n * 100) / 100;

  const spendByKind: Record<string, number> = {};
  const spendByUser = new Map<string, number>();
  let spent = 0;
  for (const s of snap.spend) {
    spent += s.cents;
    spendByKind[s.kind] = round((spendByKind[s.kind] || 0) + s.cents);
    if (s.user_id) spendByUser.set(s.user_id, (spendByUser.get(s.user_id) || 0) + s.cents);
  }

  const perUser = new Map<string, number>();
  for (const l of snap.listings) perUser.set(l.user_id, (perUser.get(l.user_id) || 0) + 1);
  const topUsers = [...perUser.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([id, listings]) => ({
      email: emailOf.get(id) || '(deleted user)', listings,
      cents: round(spendByUser.get(id) || 0), wantsMore: snap.interest.some(i => i.user_id === id),
    }));

  const finished = snap.listings.filter(l => l.status === 'ready');
  const costs = snap.listings.map(l => l.cost).filter((c): c is number => typeof c === 'number' && c > 0);
  const conf = { High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  for (const l of finished) if (l.confidence && l.confidence in conf) conf[l.confidence]++;

  return {
    month: since,
    budgetCents: deps.budgetCents,
    spentCents: round(spent),
    spendByKind,
    users: {
      total: snap.profiles.length,
      newThisMonth: snap.profiles.filter(p => p.created_at >= since).length,
      activeThisMonth: perUser.size,
    },
    listings: {
      thisMonth: snap.listings.length,
      failed: snap.listings.filter(l => l.status === 'error').length,
      avgCostCents: costs.length ? round(costs.reduce((a, b) => a + b, 0) / costs.length) : null,
      confidence: conf,
    },
    topUsers,
    interest: snap.interest.map(i => ({ email: i.user_id ? emailOf.get(i.user_id) || '(deleted user)' : '(deleted user)', at: i.created_at })),
    recentErrors: snap.listings
      .filter(l => l.status === 'error' || (l.sourceErrors && l.sourceErrors.length))
      .slice(0, 20)
      .map(l => ({
        at: l.created_at, email: emailOf.get(l.user_id) || '(deleted user)', title: l.title || 'Untitled',
        error: l.status === 'error' ? l.failure || l.error || 'Failed' : (l.sourceErrors || []).join(' | '),
        failed: l.status === 'error',
      })),
    recent: snap.listings.slice(0, 15).map(l => ({
      at: l.created_at, email: emailOf.get(l.user_id) || '(deleted user)', title: l.title || 'Untitled',
      status: l.status, price: l.price, confidence: l.confidence, cents: l.cost,
    })),
  };
}
export type AdminStats = Awaited<ReturnType<typeof adminStats>>;

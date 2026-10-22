'use client';
import { allowedSizes, hasSizeField } from '@/lib/depop/sizes';
import { label, isNoBrand } from '@/lib/depop/data';
import { money, type Listing } from './api';

export type Slot = 'front' | 'back' | 'tag' | 'measure' | 'more';
export const SLOTS: { key: Exclude<Slot, 'more'>; name: string }[] = [
  { key: 'front', name: 'Front' }, { key: 'back', name: 'Back' }, { key: 'tag', name: 'Tag' }, { key: 'measure', name: 'Measure' },
];
export const SLOT_NAME: Record<Slot, string> = { front: 'Front', back: 'Back', tag: 'Tag', measure: 'Measure', more: 'More' };
export const MAX_PHOTOS = 8;

export function slotOf(url: string): Slot | null {
  const m = /\/\d+-(front|back|tag|measure|more)(?:-[a-z0-9]+)?(?:_t)?\.(?:jpe?g|png|webp)(?:\?.*)?$/i.exec(url);
  return m ? (m[1].toLowerCase() as Slot) : null;
}

export function photoPath(userId: string, listingId: string, index: number, slot: Slot, unique = false) {
  const tail = unique ? `-${Date.now().toString(36)}` : '';
  return `${userId}/${listingId}/${index}-${slot}${tail}.jpg`;
}

export function pathOf(url: string) {
  const i = url.indexOf('/photos/');
  return i === -1 ? url : decodeURIComponent(url.slice(i + '/photos/'.length).split('?')[0]);
}

export type Need =
  | { kind: 'size'; options: string[] }
  | { kind: 'brand'; suggestion: string; current: string }
  | { kind: 'fix'; message: string; field: string };

export function needOf(l: Listing): Need | null {
  if (l.status !== 'ready' || !l.fields || l.photosRemoved || l.exportedAt) return null;
  const v = l.validation;
  if (v && v.errors.length) return { kind: 'fix', message: v.errors[0], field: String(v.fields[0] || '') };
  const s = l.pricing?.brandSuggestion;
  if (s && s.depopBrand && s.depopBrand !== l.fields.brand) return { kind: 'brand', suggestion: s.depopBrand, current: isNoBrand(l.fields.brand) ? '' : l.fields.brand };
  if (hasSizeField(l.fields.category) && !l.fields.size) return { kind: 'size', options: likelySizes(l.fields.category) };
  return null;
}

export function likelySizes(category: string): string[] {
  const all = allowedSizes(category).filter(s => !/^(other|one size)$/i.test(label(s)));
  const letters = ['S', 'M', 'L', 'XL'].filter(s => all.includes(s));
  if (letters.length === 4) return letters;
  if (all.length <= 4) return all;
  const mid = Math.floor(all.length / 2);
  return all.slice(Math.max(0, mid - 1), mid + 2);
}

export const isExportable = (l: Listing) =>
  l.status === 'ready' && !l.photosRemoved && !l.exportedAt && Boolean(l.fields) && !(l.validation?.errors.length);

export type Bucket = 'working' | 'needs' | 'ready' | 'sent';
export function bucketOf(l: Listing): Bucket {
  if (l.status === 'analyzing' || l.status === 'pricing' || l.status === 'error') return 'working';
  if (l.exportedAt || l.photosRemoved) return 'sent';
  return needOf(l) ? 'needs' : 'ready';
}

export function metaOf(l: Listing): string {
  const f = l.fields;
  if (!f) return '';
  const cond = label(f.condition).replace(/^Used - /, 'Used, ').replace(/ - /g, ', ');
  const cased = cond ? cond.charAt(0) + cond.slice(1).toLowerCase() : '';
  return [label(f.size), cased].filter(Boolean).join(' · ');
}

export function fullMetaOf(l: Listing): string {
  const f = l.fields;
  if (!f) return '';
  return [label(f.category).split(' >> ').pop(), metaOf(l)].filter(Boolean).join(' · ');
}

export const titleOf = (l: Listing) => l.title || l.description.split('\n')[0] || 'Untitled item';
export const priceText = (l: Listing, currency: string) => (l.price != null ? money(l.price, l.pricing?.currency || currency) : '');
export const isStuck = (l: Listing) => l.status === 'analyzing' && Date.now() - Date.parse(l.createdAt) > 3 * 60_000;

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const refillDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const monthOf = (iso: string) => {
  const d = new Date(iso); d.setUTCDate(0);
  return d.toLocaleDateString(undefined, { month: 'long', timeZone: 'UTC' });
};

export interface PlotPoint { x: number; price: number; sold: boolean; lift: number; i: number }
export interface Plot { min: number; max: number; points: PlotPoint[]; band: [number, number] | null; pos: (p: number) => number; at: (pct: number) => number }

export function plotOf(l: Listing): Plot | null {
  const p = l.pricing;
  if (!p) return null;
  const comps = (p.comps || []).map((c, i) => ({ price: Number(c.price), sold: c.status === 'sold', i })).filter(c => isFinite(c.price) && c.price > 0);
  const values = [...comps.map(c => c.price), p.low, p.high, l.price].filter((v): v is number => typeof v === 'number' && isFinite(v) && v > 0);
  if (!values.length || (!comps.length && (p.low == null || p.high == null))) return null;
  let min = Math.min(...values), max = Math.max(...values);
  if (max - min < 4) { min -= 2; max += 2; }
  const pad = (max - min) * 0.04;
  min = Math.max(0, min - pad); max += pad;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
  const at = (pct: number) => min + (Math.min(100, Math.max(0, pct)) / 100) * (max - min);
  const sorted = comps.slice().sort((a, b) => a.price - b.price);
  const placed: PlotPoint[] = [];
  for (const c of sorted) {
    const x = pos(c.price);
    const near = placed.filter(q => Math.abs(q.x - x) < 3);
    placed.push({ x, price: c.price, sold: c.sold, lift: Math.min(2, near.length), i: c.i });
  }
  const band: [number, number] | null = p.low != null && p.high != null ? [pos(p.low), pos(p.high)] : null;
  return { min, max, points: placed, band, pos, at };
}

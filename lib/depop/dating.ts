import { DEPOP_AGES } from './data.ts';

export const UNCLEAR = 'Unclear';
export const DATING_ERAS = [...DEPOP_AGES, UNCLEAR];
export const DATING_CONFIDENCES = ['tag', 'construction', 'style', 'unclear'] as const;
type Confidence = (typeof DATING_CONFIDENCES)[number];

const PHYSICAL = new Set<Confidence>(['tag', 'construction']);
const ERA_LOOKUP = new Map(DATING_ERAS.map(e => [e.toLowerCase(), e]));

export interface Dating { era: string; confidence: Confidence; basis: string[] }

export function normalizeDating(raw: unknown): Dating {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const era = resolveEra(d.era);
  let confidence = String(d.confidence || '').trim().toLowerCase() as Confidence;
  if (!DATING_CONFIDENCES.includes(confidence)) confidence = 'unclear';
  const basis = toLines(d.basis);
  if (era === UNCLEAR || !basis.length) confidence = 'unclear';
  return { era, confidence, basis };
}

function resolveEra(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return UNCLEAR;
  const exact = ERA_LOOKUP.get(text.toLowerCase());
  if (exact) return exact;
  if (/^(y2k|2000s|00s)$/i.test(text)) return '00s (y2k)';
  const decade = text.match(/\b(?:19|20)?(\d0)s?\b/);
  if (decade) {
    const hit = DEPOP_AGES.find(a => a.startsWith(`${decade[1]}s`));
    if (hit) return hit;
  }
  if (/^(modern|new|current|contemporary)$/i.test(text)) return 'Modern (modern)';
  return UNCLEAR;
}

function toLines(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map(x => String(x).trim()).filter(Boolean);
}

export function ageFromDating(raw: unknown): string {
  const { era, confidence } = normalizeDating(raw);
  if (era === UNCLEAR || !PHYSICAL.has(confidence)) return '';
  return era;
}

export function datingSummary(raw: unknown): string {
  const { era, confidence, basis } = normalizeDating(raw);
  const why = basis.join('; ');
  const name = era.replace(/\s*\([^)]*\)$/, '');
  if (era === UNCLEAR) return basis.length ? `Era unclear — ${why}` : 'Era unclear — not enough evidence';
  if (confidence === 'unclear') return `Era not set — "${name}" was given with nothing on the garment behind it`;
  if (!PHYSICAL.has(confidence)) return `Looks ${name} from the design only, so no era set — ${why}`;
  return `${name}, dated from the ${confidence} — ${why}`;
}

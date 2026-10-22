import { measurementsLine, type Measurement } from './measurements.ts';

export const SIGN_OFF = 'dm any offers or questions.';
export const DESCRIPTION_LIMIT = 1000;
export const MAX_HASHTAGS = 5;

interface TextParts {
  title?: string; opener?: string; details?: string[]; fit?: string;
  conditionNote?: string; styling?: string; tags?: string[];
  measurements?: Measurement[];
}

const endWithPeriod = (s: string) => (/[.!?]$/.test(s) ? s : s + '.');

export function assembleBody(ai: TextParts, maxDetails = 4): string {
  const lead = [ai.opener, ...(Array.isArray(ai.details) ? ai.details.slice(0, maxDetails) : [])]
    .filter(Boolean)
    .map(s => endWithPeriod(String(s).trim()))
    .join(' ');
  const meta: string[] = [];
  if (ai.fit) meta.push(`fit: ${String(ai.fit).trim()}`);
  const ms = measurementsLine(Array.isArray(ai.measurements) ? ai.measurements : []);
  if (ms) meta.push(ms);
  if (ai.conditionNote) meta.push(`condition: ${String(ai.conditionNote).trim()}`);
  return [lead, meta.join('\n'), ai.styling, SIGN_OFF]
    .filter(s => s && String(s).trim())
    .join('\n\n')
    .trim();
}

export function normalizeTags(tags: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const clean = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.length < 2 || seen.has(clean)) continue;
    seen.add(clean);
    out.push('#' + clean);
    if (out.length === MAX_HASHTAGS) break;
  }
  return out;
}

function tidy(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ', ').replace(/ {2,}/g, ' ');
}

export function buildListingText(ai: TextParts): string {
  const tags = normalizeTags(ai.tags).join(' ');
  const make = (parts: TextParts, maxDetails: number) =>
    tidy([parts.title?.trim() || '', assembleBody(parts, maxDetails), tags].filter(Boolean).join('\n\n'));

  for (let n = 4; n >= 0; n--) {
    const text = make(ai, n);
    if (text.length <= DESCRIPTION_LIMIT) return text;
  }
  const noStyling = make({ ...ai, styling: '' }, 0);
  if (noStyling.length <= DESCRIPTION_LIMIT) return noStyling;
  const room = DESCRIPTION_LIMIT - tags.length - 3;
  let body = noStyling.replace(tags, '').trim().slice(0, room);
  if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1);
  return tidy(body.trim() + '…\n\n' + tags);
}

export const AI_TELLS = [
  'features', 'boasts', 'classic', 'stylish', 'elevate', 'effortless', 'timeless', 'iconic',
  'versatile', 'staple', 'must-have', 'perfect for', 'statement piece', 'showcasing', 'crafted', 'curated',
];

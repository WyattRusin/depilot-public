import { normalizeBrand, matchBrand } from './brands.ts';

const compact = (s: unknown) => normalizeBrand(String(s ?? '').replace(/\?/g, ' ')).replace(/ /g, '');

export function brandInTag(brand: string, tagText: string): boolean {
  const t = compact(tagText);
  const b = compact(brand);
  if (!b || !t) return false;
  if (t.includes(b)) return true;
  const first = normalizeBrand(brand).split(' ').find(w => w.length >= 4);
  return Boolean(first && t.includes(first));
}

export interface GuardOutcome {
  corrections: string[];
  wrongBrand: string;
  rewrite: boolean;
}

export function applyTagGuards(ai: Record<string, any>): GuardOutcome {
  const out: GuardOutcome = { corrections: [], wrongBrand: '', rewrite: false };
  const tagText = String(ai.tagText ?? '').trim();
  const legibility = String(ai.tagLegibility || (tagText ? 'partial' : 'not_pictured'));
  const brand = String(ai.brand ?? '').trim();
  let brandCorrected = false;
  const logoOnly = Boolean(tagText) && compact(tagText).length <= 3;

  if (brand && tagText && !brandInTag(brand, tagText)) {
    const cleanTag = tagText.replace(/\?/g, '').replace(/\s+/g, ' ').trim();
    const replacement = legibility === 'clear' && !logoOnly ? (matchBrand(cleanTag) ? cleanTag : '') : '';
    out.wrongBrand = brand;
    ai.brand = replacement;
    brandCorrected = true;
    out.corrections.push(
      replacement
        ? `Brand corrected from "${brand}" to "${replacement}" to match the tag, which reads "${tagText}".`
        : logoOnly
          ? `Brand "${brand}" removed: the tag only shows a logo ("${tagText}"), which doesn't confirm a maker.`
          : `Brand "${brand}" removed: the tag reads "${tagText}", which doesn't spell that name.`,
    );
  }

  const d = ai.dating && typeof ai.dating === 'object' ? ai.dating : null;
  if (d && String(d.confidence).toLowerCase() === 'tag' && (legibility !== 'clear' || brandCorrected || logoOnly)) {
    const era = String(d.era || '');
    d.confidence = 'style';
    d.basis = [...(Array.isArray(d.basis) ? d.basis : []),
      logoOnly ? 'tag is only a logo, so the era is not confirmed'
        : brandCorrected ? 'tag was misidentified, so the era is not confirmed'
        : 'tag not clearly readable, so the era is not confirmed'];
    if (!/^(modern|unclear)/i.test(era)) {
      out.corrections.push(`Era "${era.replace(/\s*\([^)]*\)$/, '')}" not used: it relied on a tag that ${logoOnly ? 'only shows a logo' : brandCorrected ? 'was misread' : "wasn't clearly readable"}.`);
      out.rewrite = true;
      if (ai.source1 === 'Vintage (vintage)') ai.source1 = 'Preloved (preloved)';
      if (ai.source2 === 'Vintage (vintage)') ai.source2 = '';
    }
  }
  if (brandCorrected) out.rewrite = true;
  return out;
}

const ERA_WORDS = /\b(vintage|(19|20)?[0-9]0'?s|y2k|19[5-9][0-9]|200[0-9]|single[- ]stitch(ed)?)\b/gi;

export function scrubCopy(ai: Record<string, any>, g: GuardOutcome) {
  const wrong = g.wrongBrand ? new RegExp(`\\b${g.wrongBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi') : null;
  const fix = (s: string, era: boolean) => {
    let t = String(s ?? '');
    if (wrong) t = t.replace(wrong, ai.brand || '');
    if (era) t = t.replace(ERA_WORDS, '');
    return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  };
  const eraGone = g.corrections.some(c => c.startsWith('Era'));
  for (const k of ['title', 'opener', 'searchQuery', 'broadQuery']) ai[k] = fix(ai[k], eraGone);
  ai.details = (ai.details || []).map((x: string) => fix(x, false)).filter(Boolean);
  const wrongTag = g.wrongBrand ? new RegExp(wrong!.source, 'i') : null;
  ai.tags = (ai.tags || []).filter((t: string) => !(eraGone && /^#?(vintage|[0-9]0s|y2k)$/i.test(t)) && !(wrongTag && wrongTag.test(t)));
}

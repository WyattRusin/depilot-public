import { DEPOP_CONDITIONS, DEPOP_COLORS, DEPOP_SOURCES, DEPOP_STYLES, DEPOP_CATEGORY_LEAVES } from './data.ts';
import { normalizeSize } from './sizes.ts';
import { ageFromDating } from './dating.ts';
import { buildListingText } from './listing-text.ts';

export interface DepopFields {
  description: string;
  category: string;
  price: number | null;
  brand: string;
  condition: string;
  size: string;
  color1: string; color2: string;
  source1: string; source2: string;
  age: string;
  style1: string; style2: string; style3: string;
  location: string;
  photoUrls: string[];
  domesticShipping: number | null;
  intlShipping: number | null;
  sku: string;
}

const pick = (v: unknown, allowed: string[]) => (typeof v === 'string' && allowed.includes(v) ? v : '');

export function fieldsFromModel(
  ai: Record<string, any>,
  opts: { category: string; brand: string; location: string; photoUrls: string[];
          domesticShipping: number | null; intlShipping: number | null; sku: string; price: number | null },
): DepopFields {
  const styles = [ai.style1, ai.style2, ai.style3].map(s => pick(s, DEPOP_STYLES));
  const uniqueStyles = styles.filter((s, i) => s && styles.indexOf(s) === i);
  const color1 = pick(ai.color1, DEPOP_COLORS);
  const color2 = pick(ai.color2, DEPOP_COLORS);
  const source1 = pick(ai.source1, DEPOP_SOURCES);
  const source2 = pick(ai.source2, DEPOP_SOURCES);
  return {
    description: buildListingText(ai),
    category: opts.category,
    price: opts.price,
    brand: opts.brand,
    condition: pick(ai.condition, DEPOP_CONDITIONS),
    size: normalizeSize(ai.size, opts.category),
    color1,
    color2: color2 && color2 !== color1 ? color2 : '',
    source1,
    source2: source2 && source2 !== source1 ? source2 : '',
    age: ageFromDating(ai.dating),
    style1: uniqueStyles[0] || '', style2: uniqueStyles[1] || '', style3: uniqueStyles[2] || '',
    location: opts.location,
    photoUrls: opts.photoUrls.slice(0, 8),
    domesticShipping: opts.domesticShipping,
    intlShipping: opts.intlShipping,
    sku: opts.sku,
  };
}

export function leavesFor(group: string): string[] {
  return DEPOP_CATEGORY_LEAVES[group] || [];
}

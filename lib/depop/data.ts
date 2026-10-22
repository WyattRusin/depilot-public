import core from './data/core.json' with { type: 'json' };

export const TEMPLATE_VERSION: number = core.templateVersion;
export const DEPOP_CONDITIONS: string[] = core.conditions;
export const DEPOP_COLORS: string[] = core.colors;
export const DEPOP_SOURCES: string[] = core.sources;
export const DEPOP_AGES: string[] = core.ages;
export const DEPOP_STYLES: string[] = core.styles;
export const DEPOP_LOCATIONS: string[] = core.locations;

export const DEPOP_CATEGORY_LEAVES: Record<string, string[]> = core.categoryLeaves;
export const DEPOP_CATEGORY_GROUPS: string[] = Object.keys(DEPOP_CATEGORY_LEAVES);
export const DEPOP_CATEGORIES: string[] = Object.values(DEPOP_CATEGORY_LEAVES).flat();

export const DEPOP_SIZE_GROUPS: Record<string, string[]> = core.sizeGroups;
export const DEPOP_CATEGORY_SIZE_GROUP: Record<string, string> = core.categorySizeGroup;

export const OTHER_BRAND = 'Other (unbranded)';

export function isNoBrand(v: string | null | undefined): boolean {
  return !v || v === OTHER_BRAND || v === 'No Brand (no-brand)';
}

export function label(v: string | null | undefined): string {
  return String(v ?? '').replace(/\s*\([^)]*\)\s*$/, '');
}

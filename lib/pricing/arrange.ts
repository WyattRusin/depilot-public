import { generate } from './gemini.ts';
import type { PipelineConfig, ImageInput } from './pipeline.ts';

export const PHOTO_ROLES = ['front', 'back', 'tag', 'care', 'detail', 'flaw', 'measure', 'other'] as const;
export type PhotoRole = (typeof PHOTO_ROLES)[number];
export type Slot = 'front' | 'back' | 'tag' | 'measure' | 'more';

export interface PhotoRead { photo: number; role: PhotoRole; fullItem: boolean; quality: number }

const ROLE_SLOT: Record<PhotoRole, Slot> = {
  front: 'front', back: 'back', tag: 'tag', measure: 'measure', care: 'more', detail: 'more', flaw: 'more', other: 'more',
};
export const ROLE_LABEL: Record<PhotoRole, string> = {
  front: 'front', back: 'back', tag: 'brand tag', care: 'care or size label', detail: 'close-up',
  flaw: 'close-up of a flaw', measure: 'tape measure', other: 'other',
};
export const SLOT_LABEL: Record<Slot, string> = { front: 'front', back: 'back', tag: 'brand tag', measure: 'tape measure', more: 'extra' };

const PROMPT = `These photos all show ONE secondhand item being listed for resale. For each photo, in order, say what it mainly shows.

role:
- front: the whole item from the front (laid flat, hung, or worn facing the camera)
- back: the whole item from behind
- tag: the maker's label (neck tag, waistband patch, inside label with the brand name)
- care: a care, size or fabric-content label
- detail: a close-up of a print, logo, hardware, stitching or fabric
- flaw: a close-up of damage: a hole, stain, tear, fading, pilling
- measure: a tape measure or ruler laid against the item
- other: anything else

fullItem: true if the whole item is in frame.
quality: 3 = sharp, well lit, the item fills the frame (a good cover photo); 2 = fine; 1 = blurry, dark or badly cropped.

A flat-laid item can be front-up or back-up. The front usually shows the main graphic, the zip or button opening, chest pockets, or the inside of the collar.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    photos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          photo: { type: 'INTEGER' },
          role: { type: 'STRING', enum: [...PHOTO_ROLES] },
          fullItem: { type: 'BOOLEAN' },
          quality: { type: 'INTEGER' },
        },
        required: ['photo', 'role', 'fullItem', 'quality'],
        propertyOrdering: ['photo', 'role', 'fullItem', 'quality'],
      },
    },
  },
  required: ['photos'],
};

export function normalizeReads(raw: unknown, count: number): PhotoRead[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PhotoRead[] = [];
  for (let n = 1; n <= count; n++) {
    const r = raw.find((x: any) => Number(x?.photo) === n) as any;
    const role = PHOTO_ROLES.includes(r?.role) ? r.role as PhotoRole : 'other';
    const q = Math.round(Number(r?.quality));
    out.push({ photo: n, role, fullItem: r ? Boolean(r.fullItem) : false, quality: q >= 1 && q <= 3 ? q : 2 });
  }
  return out.some(r => r.role !== 'other') ? out : null;
}

export async function classifyPhotos(cfg: PipelineConfig, thumbs: ImageInput[], timeoutMs = 9000): Promise<PhotoRead[] | null> {
  if (thumbs.length < 2) return null;
  const parts = [
    { text: `${thumbs.length} photos.` },
    ...thumbs.flatMap((t, i) => [{ text: `Photo ${i + 1}:` }, { inlineData: { mimeType: t.mimeType, data: t.base64 } }]),
  ];
  const out = await generate({
    apiKey: cfg.geminiKey, models: cfg.fastModels, system: PROMPT, parts, schema: SCHEMA,
    temperature: 0, mediaResolution: 'low', timeoutMs, deadline: Date.now() + timeoutMs,
    meter: cfg.meter, meterLabel: 'arrange',
  });
  return normalizeReads(out.json?.photos, thumbs.length);
}

export interface Plan {
  order: number[];
  slots: Slot[];
  roles: PhotoRole[];
  changed: boolean;
}

export function planOrder(reads: PhotoRead[], currentSlots: (Slot | null)[] = []): Plan {
  const items = reads.map((r, i) => ({ ...r, i }));
  const rank = (a: typeof items[0], b: typeof items[0]) =>
    Number(b.fullItem) - Number(a.fullItem) || b.quality - a.quality || a.i - b.i;

  const groups = PHOTO_ROLES.map(role => items.filter(x => x.role === role).sort(rank));
  let ordered = groups.flat();

  if (!groups[0].length) {
    const prefer: PhotoRole[] = ['back', 'other', 'detail', 'flaw', 'tag', 'care', 'measure'];
    const cover = items.filter(x => x.fullItem).sort((a, b) => b.quality - a.quality || a.i - b.i)[0]
      ?? items.slice().sort((a, b) => prefer.indexOf(a.role) - prefer.indexOf(b.role) || b.quality - a.quality || a.i - b.i)[0];
    if (cover) ordered = [cover, ...ordered.filter(x => x !== cover)];
  }

  const used = new Set<Slot>();
  const slots = ordered.map((x, k) => {
    let s = ROLE_SLOT[x.role];
    if (k === 0 && x.role === 'other' && x.fullItem) s = 'front';
    if (s !== 'more' && used.has(s)) s = 'more';
    used.add(s);
    return s;
  });
  const order = ordered.map(x => x.i);
  const changed = order.some((v, k) => v !== k) || slots.some((s, k) => s !== (currentSlots[order[k]] ?? null));
  return { order, slots, roles: ordered.map(x => x.role), changed };
}

export function slotOfPath(path: string): Slot | null {
  const m = /\/\d+-(front|back|tag|measure|more)(?:-[a-z0-9]+)?\.(?:jpe?g|png|webp)$/i.exec(path);
  return m ? (m[1].toLowerCase() as Slot) : null;
}

export function arrangedPaths(paths: string[], plan: Plan, stamp = Date.now().toString(36)): string[] {
  return plan.order.map((from, k) => {
    const dir = paths[from].slice(0, paths[from].lastIndexOf('/') + 1);
    return `${dir}${k}-${plan.slots[k]}-${stamp}.jpg`;
  });
}

export function photoLabels(count: number, roles?: (PhotoRole | null)[], slots?: (Slot | null)[]): string[] {
  return Array.from({ length: count }, (_, i) => {
    const role = roles?.[i];
    const slot = slots?.[i];
    const what = role ? ROLE_LABEL[role] : slot ? SLOT_LABEL[slot] : '';
    return what ? `Photo ${i + 1} (${what}):` : `Photo ${i + 1}:`;
  });
}

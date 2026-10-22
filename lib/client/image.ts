'use client';

const MAX_AT_ONCE = 2;
let running = 0;
const waiting: (() => void)[] = [];
async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>(r => waiting.push(r));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);

export function compressImage(file: File, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  return oneAtATime(async () => {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    } catch {
      throw new Error(isHeic(file)
        ? 'This browser can’t open iPhone (HEIC) photos. Upload from your phone, or save them as JPG first.'
        : `Couldn’t open "${file.name}". Try a JPG or PNG.`);
    }
    const canvas = document.createElement('canvas');
    try {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Your browser could not process this photo');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality));
      if (!blob) throw new Error('Your browser could not process this photo');
      return blob;
    } finally {
      bitmap.close?.();
      canvas.width = 0;
      canvas.height = 0;
    }
  });
}

export function makeThumb(full: Blob): Promise<Blob> {
  return compressImage(new File([full], 'thumb.jpg', { type: 'image/jpeg' }), 480, 0.75);
}

export function newId(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

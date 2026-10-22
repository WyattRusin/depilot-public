import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planOrder, normalizeReads, arrangedPaths, slotOfPath, photoLabels, classifyPhotos, PHOTO_ROLES,
} from '../lib/pricing/arrange.ts';
import { buildListingSchema } from '../lib/depop/schema.ts';
import { LISTING_PROMPT } from '../lib/depop/prompt.ts';
import { CostMeter } from '../lib/pricing/cost.ts';

const read = (role, fullItem = false, quality = 2) => ({ role, fullItem, quality });
const reads = (...xs) => xs.map((x, i) => ({ photo: i + 1, ...x }));

test('a shuffled library pick comes out front, back, tag, care, close-ups, flaws, tape', () => {
  const p = planOrder(reads(
    read('measure'), read('flaw'), read('tag'), read('back', true), read('care'), read('front', true, 3), read('detail'),
  ));
  assert.deepEqual(p.roles, ['front', 'back', 'tag', 'care', 'detail', 'flaw', 'measure']);
  assert.deepEqual(p.order, [5, 3, 2, 4, 6, 1, 0]);
  assert.deepEqual(p.slots, ['front', 'back', 'tag', 'more', 'more', 'more', 'measure']);
  assert.equal(p.changed, true);
});

test('the cover is the best front: whole item in frame, then the sharper one', () => {
  const p = planOrder(reads(read('front', false, 3), read('front', true, 1), read('front', true, 3)));
  assert.deepEqual(p.order, [2, 1, 0]);
  assert.deepEqual(p.slots, ['front', 'more', 'more'], 'only one photo takes each named slot');
});

test('no front at all: the best full shot leads, so a listing never opens on a tag', () => {
  const p = planOrder(reads(read('tag', false, 3), read('other', true, 2), read('detail')));
  assert.deepEqual(p.order, [1, 0, 2]);
  assert.equal(p.slots[0], 'front', 'an unlabelled full shot on the cover is the front');
  const q = planOrder(reads(read('tag'), read('back', true)));
  assert.deepEqual(q.order, [1, 0]);
  assert.equal(q.slots[0], 'back', 'a back stays a back, even as the cover');
});

test('photos already in order are left alone', () => {
  const p = planOrder(reads(read('front', true), read('back', true), read('tag')), ['front', 'back', 'tag']);
  assert.equal(p.changed, false);
  const q = planOrder(reads(read('front', true), read('back', true), read('tag')), ['front', 'tag', 'back']);
  assert.equal(q.changed, true, 'same order but wrong labels still gets renamed');
});

test('model answers are cleaned up: missing or unknown photos become "other"', () => {
  assert.deepEqual(normalizeReads([{ photo: 2, role: 'back', fullItem: true, quality: 9 }, { photo: 7, role: 'front' }], 3), [
    { photo: 1, role: 'other', fullItem: false, quality: 2 },
    { photo: 2, role: 'back', fullItem: true, quality: 2 },
    { photo: 3, role: 'other', fullItem: false, quality: 2 },
  ]);
  assert.equal(normalizeReads([{ photo: 1, role: 'banana' }], 1), null, 'nothing recognised: keep the seller\'s order');
  assert.equal(normalizeReads('nope', 2), null);
});

test('new names keep the slot readable and never collide with the old ones', () => {
  const paths = ['u/i/0-front.jpg', 'u/i/1-back.jpg', 'u/i/2-tag.jpg'];
  const plan = planOrder(reads(read('tag'), read('front', true), read('back', true)), paths.map(slotOfPath));
  const next = arrangedPaths(paths, plan, 'k2x9');
  assert.deepEqual(next, ['u/i/0-front-k2x9.jpg', 'u/i/1-back-k2x9.jpg', 'u/i/2-tag-k2x9.jpg']);
  assert.ok(next.every(p => !paths.includes(p)));
  assert.deepEqual(next.map(slotOfPath), ['front', 'back', 'tag']);
  assert.ok(next.every(p => /^[A-Za-z0-9-]{1,40}\.jpg$/.test(p.split('/').pop())), 'names pass the server\'s path check');
  assert.equal(slotOfPath('u/i/3.jpg'), null, 'older names have no slot');
});

test('labels introduce each photo to the main read', () => {
  assert.deepEqual(photoLabels(3, ['front', 'care', null], ['front', 'more', 'more']), ['Photo 1 (front):', 'Photo 2 (care or size label):', 'Photo 3 (extra):']);
  assert.deepEqual(photoLabels(2), ['Photo 1:', 'Photo 2:']);
});

test('the quick sort: numbered small photos, cheapest model, low detail, costed', async () => {
  let body, url;
  globalThis.fetch = async (u, init) => {
    url = String(u); body = JSON.parse(init.body);
    const json = { photos: [{ photo: 1, role: 'tag', fullItem: false, quality: 3 }, { photo: 2, role: 'front', fullItem: true, quality: 3 }] };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }], usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 40 } }));
  };
  const meter = new CostMeter();
  const img = { base64: 'AAAA', mimeType: 'image/jpeg' };
  const out = await classifyPhotos({ geminiKey: 'k', fastModels: ['gemini-3.5-flash-lite'], meter }, [img, img]);
  assert.match(url, /gemini-3\.5-flash-lite/);
  const texts = body.contents[0].parts.filter(p => p.text).map(p => p.text);
  assert.deepEqual(texts, ['2 photos.', 'Photo 1:', 'Photo 2:']);
  assert.equal(body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_LOW');
  assert.deepEqual(out.map(r => r.role), ['tag', 'front']);
  assert.ok(meter.parts.arrange > 0);
  assert.equal(await classifyPhotos({ geminiKey: 'k', fastModels: ['x'] }, [img]), null, 'one photo: nothing to sort');
});

test('the main read catalogues the photos first, with the same roles', () => {
  const s = buildListingSchema();
  assert.equal(s.propertyOrdering[0], 'photos');
  assert.ok(s.required.includes('photos'));
  assert.deepEqual(s.properties.photos.items.properties.role.enum, [...PHOTO_ROLES]);
  assert.match(LISTING_PROMPT, /The label is a guess from a quick sort; go by what you see/);
});

test('no front and nothing whole in frame: still never opens on a label or a tape', () => {
  const p = planOrder(reads(read('measure', false, 3), read('tag', false, 3), read('detail', false, 2), read('care', false, 3)));
  assert.equal(p.roles[0], 'detail');
});

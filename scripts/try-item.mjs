import fs from 'node:fs';
import path from 'node:path';
import { analyzeItem, priceItem, pipelineConfigFromEnv } from '../lib/pricing/pipeline.ts';
import { fieldsFromModel } from '../lib/depop/fields.ts';
import { classifyPhotos, planOrder, photoLabels } from '../lib/pricing/arrange.ts';

const files = process.argv.slice(2);
if (!files.length) { console.log('Usage: scripts/try-item.mjs photo1.jpg [photo2.jpg ...]'); process.exit(1); }
const currency = process.env.CURRENCY || 'USD';
const cfg = pipelineConfigFromEnv({
  geminiKey: process.env.GEMINI_API_KEY || '', visionModel: process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash',
  fastModel: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite', ebayClientId: process.env.EBAY_CLIENT_ID || '',
  ebayClientSecret: process.env.EBAY_CLIENT_SECRET || '', openWebNinjaKey: process.env.OPENWEBNINJA_API_KEY || '',
});
const images = files.map(f => ({
  base64: fs.readFileSync(f).toString('base64'),
  mimeType: /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg',
}));

const reads = await classifyPhotos(cfg, images).catch(() => null);
const plan = reads ? planOrder(reads) : null;
const sorted = plan ? plan.order.map(i => images[i]) : images;
console.log(`Reading ${(plan ? plan.order.map(i => files[i]) : files).map(f => path.basename(f)).join(', ')}${plan ? ` (sorted: ${plan.roles.join(', ')})` : ''}…`);
const a = await analyzeItem(cfg, sorted, currency, photoLabels(sorted.length, plan?.roles));
const f = fieldsFromModel(a.ai, { category: a.category, brand: a.brand, location: 'United States', photoUrls: [], domesticShipping: null, intlShipping: null, sku: '', price: null });
console.log(`\n── DESCRIPTION (${a.timings.total} ms, ${a.model}) ──\n${f.description}`);
console.log(`\nBrand: ${f.brand || '(none)'}  Category: ${f.category || '(pick)'}  Size: ${f.size || '(none)'}  Condition: ${f.condition}  Age: ${f.age || '(not set)'}`);
console.log(`Search: "${a.ai.searchQuery}"   Era: ${a.ai.datingNote}`);
if (a.errors.length) console.log('Warnings:', a.errors.join(' | '));

console.log('\nPricing…');
const p = await priceItem(cfg, { ai: a.ai, brand: a.brand, imageComps: a.imageComps, condition: f.condition }, currency);
console.log(`\n── PRICE (${p.timings?.total} ms) ──\n${p.price} ${p.currency}  (range ${p.low}–${p.high}, ${p.confidenceLabel} confidence ${p.confidence}, basis: ${p.basis})`);
console.log(p.summary);
console.log('Working:', p.steps.join(' | '));
console.log(`Sources searched: ${JSON.stringify(p.sources)}   Rejected as non-matches: ${p.rejectedCount}`);
for (const c of p.comps) console.log(`  ${c.status === 'sold' ? 'SOLD  ' : 'listed'} ${String(c.price).padStart(7)} ${c.currency}  ${c.match?.padEnd(7)} ${c.site?.padEnd(8)} ${c.title.slice(0, 70)}`);
if (p.errors?.length) console.log('\nSource errors:', p.errors.join(' | '));

import fs from 'node:fs';
import path from 'node:path';
import { generate } from '../lib/pricing/gemini.ts';
import { pipelineConfigFromEnv } from '../lib/pricing/pipeline.ts';
import { CostMeter } from '../lib/pricing/cost.ts';
import { classifyPhotos, planOrder, photoLabels } from '../lib/pricing/arrange.ts';
import { LISTING_PROMPT } from '../lib/depop/prompt.ts';
import { LISTING_PROMPT as OLD_PROMPT } from '../lib/depop/prompt-v2.ts';
import { buildListingSchema } from '../lib/depop/schema.ts';
import { applyTagGuards } from '../lib/depop/tag-guard.ts';

const args = process.argv.slice(2);
if (!args.length || !process.env.GEMINI_API_KEY) {
  console.log('Usage: npm run compare-prompts -- <item folder or photo> [more items...]\n(needs GEMINI_API_KEY in .env.local)');
  process.exit(1);
}
const cfg = pipelineConfigFromEnv({
  geminiKey: process.env.GEMINI_API_KEY, visionModel: process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash',
  fastModel: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite', ebayClientId: '', ebayClientSecret: '', openWebNinjaKey: '',
  visionThinking: process.env.GEMINI_VISION_THINKING,
});

const IMG = /\.(jpe?g|png|webp)$/i;
const load = (f) => ({ base64: fs.readFileSync(f).toString('base64'), mimeType: /\.png$/i.test(f) ? 'image/png' : /\.webp$/i.test(f) ? 'image/webp' : 'image/jpeg' });
const filesOf = (a) => (fs.statSync(a).isDirectory()
  ? fs.readdirSync(a).filter(f => IMG.test(f)).sort().map(f => path.join(a, f))
  : [a]);

function oldSchema() {
  const s = structuredClone(buildListingSchema());
  delete s.properties.photos;
  s.properties.marketNote = { type: 'STRING' };
  const swap = (list) => list.filter(k => k !== 'photos').flatMap(k => (k === 'dating' ? ['dating', 'marketNote'] : [k]));
  s.required = swap(s.required);
  s.propertyOrdering = swap(s.propertyOrdering);
  return s;
}

async function run(label, prompt, schema, parts, meter) {
  const t = Date.now();
  const out = await generate({
    apiKey: cfg.geminiKey, models: cfg.visionModels, system: prompt, parts, schema,
    temperature: 1.0, thinkingLevel: cfg.visionThinking, timeoutMs: 90_000, meter, meterLabel: label,
  });
  const ai = out.json || {};
  const guard = applyTagGuards(ai);
  return { ai, guard, ms: Date.now() - t, usage: out.usage, model: out.model };
}

const row = (k, a, b) => {
  const same = String(a) === String(b);
  console.log(`  ${k.padEnd(13)} ${String(a ?? '').slice(0, 58).padEnd(60)} ${same ? '=' : '≠'} ${String(b ?? '').slice(0, 58)}`);
};

for (const arg of args) {
  const files = filesOf(arg).slice(0, 8);
  if (!files.length) { console.log(`\n${arg}: no photos`); continue; }
  const images = files.map(load);
  console.log(`\n━━ ${path.basename(arg)} (${files.length} photo${files.length > 1 ? 's' : ''}) ━━`);

  const m2 = new CostMeter(), m3 = new CostMeter();
  const oldParts = [{ text: `Analyze this item. ${images.length} photo${images.length > 1 ? 's' : ''}.` }, ...images.map(i => ({ inlineData: { mimeType: i.mimeType, data: i.base64 } }))];

  let order = images.map((_, i) => i), roles;
  const reads = await classifyPhotos({ ...cfg, meter: m3 }, images).catch(e => (console.log('  quick sort failed:', e.message), null));
  if (reads) { const plan = planOrder(reads); order = plan.order; roles = plan.roles; }
  const sorted = order.map(i => images[i]);
  const labels = photoLabels(sorted.length, roles);
  const newParts = [{ text: `${sorted.length} photo${sorted.length > 1 ? 's' : ''} of one item.` },
    ...sorted.flatMap((img, i) => [{ text: labels[i] }, { inlineData: { mimeType: img.mimeType, data: img.base64 } }])];

  const [v2, v3] = await Promise.all([
    run('vision', OLD_PROMPT, oldSchema(), oldParts, m2).catch(e => ({ error: e.message })),
    run('vision', LISTING_PROMPT, buildListingSchema(), newParts, m3).catch(e => ({ error: e.message })),
  ]);
  if (v2.error || v3.error) { console.log('  failed:', v2.error || '', v3.error || ''); continue; }

  console.log(`  ${''.padEnd(13)} ${'OLD (v2)'.padEnd(60)}   NEW (v3)`);
  if (reads) console.log(`  ${'photo order'.padEnd(13)} ${files.map(f => path.basename(f)).join(', ').slice(0, 58).padEnd(60)} → ${order.map(i => path.basename(files[i])).join(', ')}`);
  row('brand', v2.ai.brand || '(none)', v3.ai.brand || '(none)');
  row('tag read', `${v2.ai.tagText || '–'} (${v2.ai.tagLegibility})`, `${v3.ai.tagText || '–'} (${v3.ai.tagLegibility})`);
  row('era', `${v2.ai.dating?.era} from ${v2.ai.dating?.confidence}`, `${v3.ai.dating?.era} from ${v3.ai.dating?.confidence}`);
  row('size', v2.ai.size, v3.ai.size);
  row('condition', v2.ai.condition, v3.ai.condition);
  row('title', v2.ai.title, v3.ai.title);
  row('search', v2.ai.searchQuery, v3.ai.searchQuery);
  row('fallback $', v2.ai.suggestedPrice, v3.ai.suggestedPrice);
  row('measured', (v2.ai.measurements || []).map(x => `${x.name} ${x.value}${x.unit}`).join(', ') || '–', (v3.ai.measurements || []).map(x => `${x.name} ${x.value}${x.unit}`).join(', ') || '–');
  row('tag guard', v2.guard.corrections.length ? 'corrected' : 'ok', v3.guard.corrections.length ? 'corrected' : 'ok');
  row('tokens in', v2.usage.input, v3.usage.input);
  row('cost', `${m2.cents.toFixed(2)}¢`, `${m3.cents.toFixed(2)}¢ (incl. sort)`);
  row('time', `${(v2.ms / 1000).toFixed(1)}s`, `${(v3.ms / 1000).toFixed(1)}s + sort`);
  console.log(`\n  OLD opener:  ${v2.ai.opener}\n  NEW opener:  ${v3.ai.opener}`);
  console.log(`  OLD details: ${(v2.ai.details || []).join(' / ')}\n  NEW details: ${(v3.ai.details || []).join(' / ')}`);
}

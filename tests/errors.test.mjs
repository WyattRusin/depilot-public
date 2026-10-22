import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendly } from '../lib/server/service.ts';
import { generate } from '../lib/pricing/gemini.ts';

const KEY = 'AIzaSyFAKEKEY1234567890abc';

test('users only ever see a short, plain message; keys and setup details stay in the server log', () => {
  const GENERIC = /^Something went wrong on our side/;
  const cases = [
    ['GEMINI_API_KEY is not set', GENERIC],
    [`Gemini gemini-3.8-flash (400): API key not valid. Please pass a valid API key. ${KEY}`, GENERIC],
    ['Gemini gemini-3.5-flash (404): models/gemini-3.5-flash is not found for API version v1beta', GENERIC],
    ['Gemini x (400): Invalid JSON payload received. Unknown name "foo"', GENERIC],
    ['photo u/l/0.jpg: Object not found', GENERIC],
    ['Gemini x (429): Resource has been exhausted (RESOURCE_EXHAUSTED)', /busy right now/],
    ['Gemini x (503): The model is overloaded', /busy right now/],
    ['Gemini x timed out after 50s', /longer than usual/],
    ['Gemini returned no usable output (SAFETY)', /brighter, sharper photos/],
  ];
  for (const [raw, want] of cases) {
    const out = friendly(new Error(raw), [KEY]);
    assert.match(out, want, raw);
    assert.ok(!out.includes('AIzaSy'), 'key leaked: ' + out);
    assert.ok(!/gemini|API|\(\d{3}\)/i.test(out), 'technical detail shown: ' + out);
  }
});

test('a model this key cannot use falls through to the backup model', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url).match(/models\/([^:]+)/)[1]);
    if (String(url).includes('gemini-3.8-flash')) {
      return new Response(JSON.stringify({ error: { message: 'models/gemini-3.8-flash is not found' } }), { status: 404 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
  };
  const out = await generate({ apiKey: KEY, models: ['gemini-3.8-flash', 'gemini-3.5-flash'], parts: [{ text: 'hi' }], schema: { type: 'OBJECT' } });
  assert.deepEqual(seen, ['gemini-3.8-flash', 'gemini-3.5-flash']);
  assert.equal(out.model, 'gemini-3.5-flash');
  assert.deepEqual(out.json, { ok: true });
});

test('a bad key fails fast instead of trying every model', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }); };
  await assert.rejects(generate({ apiKey: KEY, models: ['a', 'b'], parts: [{ text: 'hi' }] }), /API key not valid/);
  assert.equal(calls, 1);
});

test('no backup model is started when the time budget is nearly spent', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  };
  const started = Date.now();
  await assert.rejects(generate({
    apiKey: KEY, models: ['slow-model', 'backup-model'], parts: [{ text: 'hi' }],
    timeoutMs: 60_000, deadline: Date.now() + 10_000,
  }), /timed out/);
  const took = Date.now() - started;
  assert.equal(calls, 1, 'backup must not start with <8s left');
  assert.ok(took < 10_000, `finished inside the budget (${took}ms)`);
});

test('vision runs in the faster thinking mode', async () => {
  const { analyzeItem } = await import('../lib/pricing/pipeline.ts');
  let thinking;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.systemInstruction) thinking = body.generationConfig.thinkingConfig;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: 't', categoryGroup: 'none', tags: [], dating: {} }) }] } }] }));
  };
  await analyzeItem({ geminiKey: KEY, visionModels: ['m'], fastModels: ['f'], webModel: 'm', ebay: { clientId: '', clientSecret: '' }, openWebNinjaKey: '' },
    [{ base64: 'aGk=', mimeType: 'image/jpeg' }], 'USD');
  assert.deepEqual(thinking, { thinkingLevel: 'low' });
});

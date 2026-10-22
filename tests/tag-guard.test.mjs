import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTagGuards, brandInTag, scrubCopy } from '../lib/depop/tag-guard.ts';
import { ageFromDating } from '../lib/depop/dating.ts';
import { analyzeItem } from '../lib/pricing/pipeline.ts';

const backstock = () => ({
  tagText: 'BACKSTOCK CO.', tagLegibility: 'clear', brand: 'Brockum',
  dating: { era: '90s (90s)', confidence: 'tag', basis: ['Brockum tag'] },
  source1: 'Vintage (vintage)',
  title: 'Vintage 90s Brockum Metallica 1994 Tour Tee Black XL', opener: '1994 metallica tour tee on a brockum body',
  details: ['brockum tag', 'tour dates on back'], tags: ['#metallica', '#brockum', '#vintage', '#90s', '#bandtee'],
  searchQuery: 'Metallica 1994 tour shirt vintage', broadQuery: 'Metallica tour shirt',
});

test('the real case: BACKSTOCK CO. read as Brockum, dated 1994', () => {
  const ai = backstock();
  const g = applyTagGuards(ai);
  assert.notEqual(ai.brand, 'Brockum');
  assert.equal(ageFromDating(ai.dating), '', 'no decade on the listing');
  assert.equal(ai.source1, 'Preloved (preloved)');
  assert.equal(g.rewrite, true);
  assert.equal(g.corrections.length, 2);
  assert.match(g.corrections[0], /BACKSTOCK CO/);
});

test('fallback scrub removes the wrong brand and unproven era words', () => {
  const ai = backstock();
  const g = applyTagGuards(ai);
  scrubCopy(ai, g);
  assert.ok(!/brockum/i.test(ai.title + ai.opener + ai.details.join() + ai.tags.join()), JSON.stringify(ai));
  assert.ok(!/vintage|90s|1994/i.test(ai.title), ai.title);
  assert.ok(!/vintage|1994/i.test(ai.searchQuery), ai.searchQuery);
  assert.ok(!ai.tags.includes('#vintage') && !ai.tags.includes('#90s'));
  assert.ok(ai.tags.includes('#metallica'));
});

test('correct brands are left alone', () => {
  for (const [brand, tag] of [
    ["Levi's", 'LEVI STRAUSS & CO.'], ['Carhartt WIP', 'CARHARTT WORK IN PROGRESS'], ['Screen Stars', 'SCREEN STARS BEST 50/50'],
    ['The North Face', 'THE NORTH FACE'], ['Nike', 'NIKE'], ['Champion', 'Champion Reverse Weave'], ['Brockum', 'BROCKUM'],
  ]) assert.equal(brandInTag(brand, tag), true, `${brand} / ${tag}`);
  const ai = { tagText: 'SCREEN STARS BEST', tagLegibility: 'clear', brand: 'Screen Stars', dating: { era: '80s (80s)', confidence: 'tag', basis: ['tag'] } };
  const g = applyTagGuards(ai);
  assert.deepEqual(g.corrections, []);
  assert.equal(ageFromDating(ai.dating), '80s (80s)', 'a clearly read vintage tag still dates the shirt');
});

test('a blurry tag cannot date the shirt', () => {
  const ai = { tagText: 'BR?C?UM', tagLegibility: 'partial', brand: '', dating: { era: '90s (90s)', confidence: 'tag', basis: ['tag'] } };
  applyTagGuards(ai);
  assert.equal(ageFromDating(ai.dating), '');
});

test('no tag pictured: brand is left to the prompt rules, not rewritten', () => {
  const ai = { tagText: '', tagLegibility: 'not_pictured', brand: 'Nike', dating: { era: 'Modern (modern)', confidence: 'style', basis: ['swoosh'] } };
  const g = applyTagGuards(ai);
  assert.equal(ai.brand, 'Nike');
  assert.equal(g.rewrite, false);
});

test('pipeline: a misread tag triggers a rewrite and the listing comes out modern', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const text = body.contents[0].parts[0].text || '';
    const reply = o => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }));
    if (body.systemInstruction) { calls.push('vision'); return reply({ ...backstock(), evidence: ['tag reads BACKSTOCK CO.'], categoryGroup: 'Men >> Tops', condition: 'Used - Excellent (used_excellent)' }); }
    if (text.includes('fact-checked')) {
      calls.push('rewrite');
      assert.match(text, /BACKSTOCK CO/);
      return reply({ title: 'Metallica Tour Graphic Tee Black XL', opener: 'metallica tour graphic tee, backstock co. tag', details: ['tour dates on back'], tags: ['#metallica', '#bandtee', '#graphictee', '#rock', '#black'], searchQuery: 'Metallica tour graphic tee', broadQuery: 'Metallica tee' });
    }
    calls.push('category');
    return reply({ category: body.generationConfig.responseSchema.properties.category.enum.find(c => /T-shirts/.test(c)) });
  };
  const a = await analyzeItem({ geminiKey: 'k', visionModels: ['m'], fastModels: ['f'], webModel: 'm', ebay: { clientId: '', clientSecret: '' }, openWebNinjaKey: '' },
    [{ base64: 'aGk=', mimeType: 'image/jpeg' }], 'USD');
  assert.deepEqual(calls, ['vision', 'rewrite', 'category']);
  assert.equal(a.ai.age, '');
  assert.equal(a.brand, '');
  assert.equal(a.ai.title, 'Metallica Tour Graphic Tee Black XL');
  assert.equal(a.ai.searchQuery, 'Metallica tour graphic tee');
  assert.equal(a.ai.checks.length, 2);
});

test('your real tag: just a "B" logo, reported as Brockum and dated 1994', () => {
  const ai = { ...backstock(), tagText: 'B', tagLegibility: 'clear' };
  const g = applyTagGuards(ai);
  assert.equal(ai.brand, '', 'a logo cannot confirm a brand');
  assert.equal(ageFromDating(ai.dating), '', 'a logo cannot date the shirt');
  assert.match(g.corrections[0], /only shows a logo \("B"\)/);
  assert.match(g.corrections[1], /only shows a logo/);
  assert.equal(g.rewrite, true);
});

test('a logo-only tag cannot date the shirt even with no brand claimed', () => {
  const ai = { tagText: 'B', tagLegibility: 'clear', brand: '', dating: { era: '90s (90s)', confidence: 'tag', basis: ['B logo tag'] } };
  const g = applyTagGuards(ai);
  assert.equal(ageFromDating(ai.dating), '');
  assert.equal(g.rewrite, true);
});

test('short real names still work', () => {
  for (const [brand, tag] of [['H&M', 'H&M'], ['Gap', 'GAP'], ['Zara', 'ZARA']]) {
    const ai = { tagText: tag, tagLegibility: 'clear', brand, dating: { era: 'Modern (modern)', confidence: 'tag', basis: ['tag'] } };
    applyTagGuards(ai);
    assert.equal(ai.brand, brand, `${brand} kept`);
  }
});

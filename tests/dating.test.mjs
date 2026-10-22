import * as dating from '../lib/depop/dating.ts';
const { normalizeDating, ageFromDating, datingSummary, UNCLEAR } = dating;
import { buildListingSchema as buildSchema } from '../lib/depop/schema.ts';
import { LISTING_PROMPT, SECTIONS } from '../lib/depop/prompt.ts';
import { DEPOP_AGES } from '../lib/depop/data.ts';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log('  ok  ' + name); pass++; } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; } };
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const eq = (a, b, msg) => assert(a === b, `${msg || 'not equal'}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const GARMENTS = {
  original80sTee: {
    era: '80s (80s)', confidence: 'tag',
    basis: [
      'neck tag reads SCREEN STARS BEST, 50/50, MADE IN USA',
      'single stitch sleeve and bottom hems',
      'plastisol print, cracked through the graphic',
      '1988 copyright line under the print',
    ],
  },

  modernReprintOfSameGraphic: {
    era: 'Modern (modern)', confidence: 'tag',
    basis: [
      'same 1977 tour artwork as the original',
      'Gildan tear-away neck label',
      'double stitched hems',
      'DTG print, flat and uncracked',
    ],
  },

  datedFromGraphicAlone: {
    era: '70s (70s)', confidence: 'style',
    basis: ['artwork is a 1977 tour poster design'],
  },

  carhartt90sUnionLabel: {
    era: '90s (90s)', confidence: 'tag',
    basis: ['union label on the inner tag', 'Made in USA', 'square-label Carhartt tag'],
  },
  carharttModernWip: {
    era: 'Modern (modern)', confidence: 'tag',
    basis: ['Carhartt WIP tag', 'made in Vietnam care label', 'modern printed care symbols'],
  },

  singleStitchNoTag: {
    era: '90s (90s)', confidence: 'construction',
    basis: ['single stitch sleeve hems', 'thin 50/50 hand', 'neck tag cut out'],
  },

  tagNotPhotographed: { era: UNCLEAR, confidence: 'unclear', basis: ['neck tag not pictured', 'hems not visible'] },
  blurryPhotos: { era: UNCLEAR, confidence: 'unclear', basis: [] },

  conflictingResolvedByTag: {
    era: '90s (90s)', confidence: 'tag',
    basis: [
      'graphic is a 1970s design',
      'tag is a 90s Brockum',
      'dated by the tag; the print is a licensed 90s reissue',
    ],
  },

  assertedWithNoBasis: { era: '70s (70s)', confidence: 'tag', basis: [] },
};

console.log('\ndating: the same graphic across different decades');

t('an original 80s tee keeps its decade', () => {
  eq(ageFromDating(GARMENTS.original80sTee), '80s (80s)');
});

t('a modern reprint of the same graphic is dated Modern, not by its artwork', () => {
  eq(ageFromDating(GARMENTS.modernReprintOfSameGraphic), 'Modern (modern)',
    'a reprint was dated by the design instead of the blank');
});

t('the same graphic dated from the artwork alone gets NO decade', () => {
  eq(ageFromDating(GARMENTS.datedFromGraphicAlone), '',
    'a decade was assigned purely because the graphic is associated with an era — the exact bug this prevents');
});

t('all three carry the same artwork and reach three different answers', () => {
  const ages = [
    ageFromDating(GARMENTS.original80sTee),
    ageFromDating(GARMENTS.modernReprintOfSameGraphic),
    ageFromDating(GARMENTS.datedFromGraphicAlone),
  ];
  assert(new Set(ages).size === 3, `the graphic drove the outcome instead of the garment: ${JSON.stringify(ages)}`);
});

t('one brand across two eras is separated by its label', () => {
  eq(ageFromDating(GARMENTS.carhartt90sUnionLabel), '90s (90s)');
  eq(ageFromDating(GARMENTS.carharttModernWip), 'Modern (modern)');
});

t('conflicting evidence resolved by the tag keeps the tag\'s answer', () => {
  eq(ageFromDating(GARMENTS.conflictingResolvedByTag), '90s (90s)');
  assert(datingSummary(GARMENTS.conflictingResolvedByTag).includes('1970s design'),
    'the contradicting evidence was dropped instead of recorded');
});

console.log('\ndating: what counts as evidence');

t('a tag dates an item', () => eq(ageFromDating(GARMENTS.original80sTee), '80s (80s)'));

t('construction dates an item even with no readable tag', () => {
  eq(ageFromDating(GARMENTS.singleStitchNoTag), '90s (90s)');
});

t('style never dates an item, whichever era it points at', () => {
  for (const era of DEPOP_AGES) {
    eq(ageFromDating({ era, confidence: 'style', basis: ['silhouette looks period'] }), '',
      `style-only evidence produced the decade ${era}`);
  }
});

t('an era asserted with no basis is discarded', () => {
  eq(ageFromDating(GARMENTS.assertedWithNoBasis), '',
    'a decade with nothing behind it was accepted');
  eq(normalizeDating(GARMENTS.assertedWithNoBasis).confidence, 'unclear');
});

console.log('\ndating: weak and absent evidence');

t('an unphotographed tag yields no decade and says why', () => {
  eq(ageFromDating(GARMENTS.tagNotPhotographed), '');
  assert(datingSummary(GARMENTS.tagNotPhotographed).includes('not pictured'));
});

t('nothing at all yields no decade and does not throw', () => {
  eq(ageFromDating(GARMENTS.blurryPhotos), '');
  eq(ageFromDating(undefined), '');
  eq(ageFromDating(null), '');
  eq(ageFromDating({}), '');
  eq(ageFromDating('90s'), '');
});

t('junk from the model degrades to Unclear rather than to a guess', () => {
  for (const junk of [{ era: 'sometime in the past' }, { era: 42 }, { era: [] }, { confidence: 'vibes' }]) {
    const n = normalizeDating(junk);
    eq(n.era, UNCLEAR, `"${JSON.stringify(junk)}" was resolved to ${n.era}`);
    eq(ageFromDating(junk), '');
  }
});

t('an unrecognised confidence value never grants a decade', () => {
  eq(ageFromDating({ era: '90s (90s)', confidence: 'pretty sure', basis: ['a hunch'] }), '');
});

console.log('\ndating: tolerating how the model actually writes');

t('decades written the human way still resolve', () => {
  for (const [written, expected] of [
    ['90s', '90s (90s)'], ['1990s', '90s (90s)'], ['80s (80s)', '80s (80s)'],
    ['1970s', '70s (70s)'], ['modern', 'Modern (modern)'], ['y2k', '00s (y2k)'],
    ['2000s', '00s (y2k)'], ['MODERN', 'Modern (modern)'],
  ]) {
    eq(normalizeDating({ era: written, confidence: 'tag', basis: ['x'] }).era, expected, `"${written}"`);
  }
});

t('confidence casing is tolerated', () => {
  eq(normalizeDating({ era: '90s (90s)', confidence: 'TAG', basis: ['x'] }).confidence, 'tag');
});

t('a basis sent as a bare string is accepted as one line', () => {
  const n = normalizeDating({ era: '90s (90s)', confidence: 'tag', basis: 'single stitch' });
  assert(Array.isArray(n.basis) && n.basis[0] === 'single stitch');
});

t('every era the schema offers round-trips', () => {
  for (const era of dating.DATING_ERAS) {
    eq(normalizeDating({ era, confidence: 'tag', basis: ['x'] }).era, era, `era ${era} did not survive`);
  }
});

t('a granted decade is always a real Depop age value', () => {
  for (const era of dating.DATING_ERAS) {
    const age = ageFromDating({ era, confidence: 'tag', basis: ['x'] });
    assert(age === '' || DEPOP_AGES.includes(age), `"${age}" is not a Depop age`);
  }
});

console.log('\nschema: uncertainty has somewhere to go');

t('age is not something the model chooses any more', () => {
  const s = buildSchema();
  assert(!('age' in s.properties),
    'age is back on the schema — a required decade enum with no unknown value forces a guess');
});

t('the dating judgement is required, and carries its own reasoning', () => {
  const d = buildSchema().properties.dating;
  assert(d, 'no dating field');
  for (const k of ['era', 'confidence', 'basis']) assert(d.properties[k], `dating.${k} missing`);
  assert(d.required.includes('era') && d.required.includes('confidence') && d.required.includes('basis'),
    'a dating judgement can be returned without saying how it was reached');
  assert(d.properties.era.enum.includes(UNCLEAR), 'there is no way to say the era is unclear');
});

t('there is a field for what could not be checked', () => {
  const s = buildSchema();
  assert(s.properties.notVisible, 'no notVisible field');
  assert(s.required.includes('notVisible'),
    'notVisible is optional, so an unphotographed back can silently become "no flaws"');
});

t('evidence is gathered before anything that depends on it', () => {
  const order = buildSchema().propertyOrdering;
  for (const dependent of ['dating', 'title', 'opener', 'suggestedPrice', 'condition']) {
    assert(order.indexOf('evidence') < order.indexOf(dependent),
      `${dependent} is generated before evidence, so it is not conditioned on it`);
  }
  assert(order.indexOf('notVisible') < order.indexOf('conditionNote'));
  assert(order.indexOf('dating') < order.indexOf('title'), 'the title is written before the item is dated');
});

t('fields that are often unknowable are not required', () => {
  const s = buildSchema();
  for (const f of ['model', 'styling', 'color2', 'source2', 'style2', 'style3']) {
    assert(!s.required.includes(f), `${f} is required, so the model will invent one rather than leave it blank`);
  }
  assert(s.properties.model, 'no model field, so an identifiable style can never be named');
});

t('brand and size stay free text so they can be left empty or deferred', () => {
  const s = buildSchema();
  assert(!s.properties.brand.enum, 'brand became an enum, which forces a choice');
  assert(!s.properties.size.enum);
});

console.log('\nprompt: the contract the dating rule depends on');

t('the prompt tells the model to date the garment, not the artwork', () => {
  assert(/date the GARMENT, not the artwork/i.test(SECTIONS.DATE), 'the core rule is missing');
  assert(/never reason "this graphic is associated with the 70s/i.test(SECTIONS.DATE),
    'the specific failure mode is not called out');
});

t('the prompt ranks tag and construction evidence above style', () => {
  const d = SECTIONS.DATE;
  assert(d.indexOf('The label itself') < d.indexOf('Last and weakest'), 'evidence is not ranked');
  assert(/Last and weakest: the graphic or silhouette/.test(d));
});

t('the prompt covers reprints and the copyright-year trap', () => {
  assert(/REPRINT/.test(SECTIONS.DATE), 'reprints are not covered');
  assert(/EARLIEST the design existed/.test(SECTIONS.DATE),
    'a copyright year could still be read as the date of manufacture');
  assert(/reprint prices as a modern shirt/i.test(SECTIONS.FIELDS), 'a reprint could still be priced as an original');
});

t('the era vocabulary is fixed by the schema, so the prompt need not repeat it', () => {
  const s = buildSchema();
  eq(JSON.stringify(s.properties.dating.properties.era.enum), JSON.stringify(dating.DATING_ERAS));
  assert(/"Unclear" costs nothing/.test(SECTIONS.DATE), 'the honest empty era is not offered');
});

t('every reasoning dimension the item needs is asked for', () => {
  const p = LISTING_PROMPT.toLowerCase();
  const required = [
    'silhouette', 'typography', 'single or double stitch', 'selvedge', 'chain stitch',
    'blend', 'plastisol', 'dtg', 'halftone', 'copyright', 'union', 'rn/ca',
    'country of make', 'graphic', 'hardware', 'flaws', 'authentic', 'demand',
  ];
  const missing = required.filter(k => !p.includes(k));
  assert(!missing.length, `the prompt never asks about: ${missing.join(', ')}`);
});

t('the never-invent list covers each thing the model used to fabricate', () => {
  const n = SECTIONS.NEVER_INVENT;
  for (const [label, re] of [
    ['dates', /no decade unless the (garment|item) gave it to you/i],
    ['materials', /materials and blends/i],
    ['manufacturing', /manufacturing details/i],
    ['measurements', /never state a chest, length or waist/i],
    ['model names', /model names and numbers/i],
    ['condition', /never describe wear in an area you cannot see/i],
    ['authenticity', /never write authentic, genuine, real or verified/i],
  ]) {
    assert(re.test(n), `never-invent does not cover ${label}`);
  }
});

t('the brand rule that fails imports is still stated', () => {
  assert(/MANUFACTURER ON THE (NECK )?TAG/.test(SECTIONS.FIELDS));
  assert(/Nirvana tee is not brand "Nirvana"/.test(SECTIONS.FIELDS));
  assert(/empty brand is fine; a wrong brand fails the import/.test(SECTIONS.FIELDS));
});

t('the voice rules are stated once, not scattered', () => {
  const sections = Object.entries(SECTIONS).filter(([, v]) => /write in fragments|Fragments\. Short lines/i.test(v));
  eq(sections.length, 1, `the voice rules appear in ${sections.length} sections: ${sections.map(s => s[0]).join(', ')}`);
});

t('the prompt is assembled from its sections with nothing dropped', () => {
  for (const [name, text] of Object.entries(SECTIONS)) {
    assert(LISTING_PROMPT.includes(text), `section ${name} is not in the assembled prompt`);
  }
});

t('the prompt does not contain the phrasing it bans', () => {
  for (const banned of ['effortless', 'timeless', 'must-have', 'statement piece']) {
    const uses = LISTING_PROMPT.split(banned).length - 1;
    eq(uses, 1, `"${banned}" appears ${uses} times; it should appear only in the banned list`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

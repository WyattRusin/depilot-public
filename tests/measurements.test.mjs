import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeasurements, measurementsLine, applyMeasurementsLine } from '../lib/depop/measurements.ts';
import { buildListingText } from '../lib/depop/listing-text.ts';
import { buildListingSchema } from '../lib/depop/schema.ts';
import { SECTIONS } from '../lib/depop/prompt.ts';

test('only readable values survive: a name, a number, inches or cm', () => {
  const ms = normalizeMeasurements([
    { name: 'Pit to Pit', value: '21', unit: 'in', readFrom: 'photo 3' },
    { name: 'length', value: '28.3"', unit: 'inches' },
    { name: 'waist', value: '41', unit: 'cm' },
    { name: 'inseam', value: 'about thirty', unit: 'in' },
    { name: 'rise', value: '12', unit: 'ft' },
    { name: '', value: '10', unit: 'in' },
    { name: 'sleeve', value: '900', unit: 'in' },
    { name: 'pit to pit', value: '22', unit: 'in' },
  ]);
  assert.deepEqual(ms, [
    { name: 'pit to pit', value: '21', unit: 'in' },
    { name: 'length', value: '28.25', unit: 'in' },
    { name: 'waist', value: '41', unit: 'cm' },
  ]);
  assert.deepEqual(normalizeMeasurements(undefined), []);
});

test('the description line', () => {
  assert.equal(measurementsLine([{ name: 'pit to pit', value: '21', unit: 'in' }, { name: 'waist', value: '41', unit: 'cm' }]),
    'measurements: pit to pit 21" · waist 41 cm');
  assert.equal(measurementsLine([]), '');
});

test('the line goes under fit in a new description, and is absent without a tape', () => {
  const ai = { title: 'Levi\'s 501 Jeans Blue 32x30', opener: 'levis 501s', details: ['button fly'], fit: 'true to size', conditionNote: 'clean', tags: ['#levis'] };
  const without = buildListingText(ai);
  assert.ok(!/measurements:/.test(without));
  const withMs = buildListingText({ ...ai, measurements: [{ name: 'waist', value: '16', unit: 'in' }, { name: 'inseam', value: '30', unit: 'in' }] });
  assert.match(withMs, /fit: true to size\nmeasurements: waist 16" · inseam 30"\ncondition: clean/);
});

test('editing measurements swaps the line in place and keeps the seller\'s own edits', () => {
  const desc = 'Title\n\nmy own opener, edited.\n\nfit: big\nmeasurements: pit to pit 21"\ncondition: clean\n\ndm any offers or questions.\n\n#tee';
  const changed = applyMeasurementsLine(desc, [{ name: 'pit to pit', value: '22', unit: 'in' }, { name: 'length', value: '29', unit: 'in' }]);
  assert.equal(changed, desc.replace('measurements: pit to pit 21"', 'measurements: pit to pit 22" · length 29"'));
  const removed = applyMeasurementsLine(desc, []);
  assert.ok(!removed.includes('measurements'));
  assert.ok(removed.includes('my own opener, edited.') && removed.includes('fit: big\ncondition: clean'));
  assert.match(applyMeasurementsLine('T\n\nfit: big\ncondition: ok\n\ndm any offers or questions.', [{ name: 'waist', value: '15', unit: 'in' }]), /fit: big\nmeasurements: waist 15"\ncondition: ok/);
  assert.match(applyMeasurementsLine('T\n\nsome text\n\ndm any offers or questions.\n\n#a', [{ name: 'waist', value: '15', unit: 'in' }]), /measurements: waist 15"\n\ndm any offers/);
});

test('the AI is asked for tape readings only, and never to guess', () => {
  const s = buildListingSchema();
  assert.ok(s.required.includes('measurements'), 'the model should always consider it (an empty list is fine)');
  assert.deepEqual(s.properties.measurements.items.properties.unit.enum, ['in', 'cm']);
  assert.equal(s.properties.measurements.items.propertyOrdering[0], 'readFrom', 'it says where it read the number before giving it');
  assert.match(SECTIONS.READ, /ONLY when a photo shows a tape measure or ruler/);
  assert.match(SECTIONS.READ, /never estimate a size from how the item looks/);
  assert.match(SECTIONS.NEVER_INVENT, /never estimate one by eye/);
  assert.match(SECTIONS.WRITE, /don't write measurement numbers in any text field/);
});

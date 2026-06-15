import test from 'node:test';
import assert from 'node:assert/strict';
import { findValidatedTerms, makeBoundaryTermRegex } from '../worker.js';

function termsFor(text) {
  return findValidatedTerms(text).map((term) => term.term);
}

test('boundary-aware matching avoids substrings inside longer words', () => {
  assert.deepEqual(termsFor('Take levothyroxine apart from cholestyramine resin.'), []);
  assert.match('Avoid high tyramine foods.', makeBoundaryTermRegex('tyramine'));
  assert.equal(makeBoundaryTermRegex('tyramine').test('cholestyramine resin'), false);
});

test('flexible phrase matching accepts spaces, hyphens, dashes, and slashes', () => {
  assert.match('Take with a high-fat meal.', makeBoundaryTermRegex('high fat'));
  assert.match('Take with a high fat meal.', makeBoundaryTermRegex('high-fat'));
  assert.match('Do not take with grapefruit/juice.', makeBoundaryTermRegex('grapefruit juice'));
});

test('ambiguous minerals require diet, supplement, antacid, or administration context', () => {
  assert.deepEqual(termsFor('Metformin may be coadministered with calcium channel blockers.'), []);
  assert.deepEqual(termsFor('Calcium channel blocking drugs affect calcium influx.'), []);
  assert.ok(termsFor('Calcium carbonate may reduce levothyroxine absorption; separate calcium supplements by 4 hours.').includes('calcium'));
  assert.ok(termsFor('Antacids containing magnesium or aluminum can bind this medicine and reduce absorption.').includes('magnesium'));
});

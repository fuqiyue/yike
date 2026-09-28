import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPeriodicDue, validPeriodicDate } from './public/periodic.js';

test('monthly and quarterly boundaries clamp without drifting from the original day', () => {
  assert.equal(nextPeriodicDue('2026-01-31', 'monthly', '2026-02-01'), '2026-02-28');
  assert.equal(nextPeriodicDue('2026-01-31', 'monthly', '2026-02-28'), '2026-02-28');
  assert.equal(nextPeriodicDue('2026-01-31', 'monthly', '2026-03-01'), '2026-03-31');
  assert.equal(nextPeriodicDue('2026-01-31', 'quarterly', '2026-04-01'), '2026-04-30');
  assert.equal(nextPeriodicDue('2026-01-31', 'quarterly', '2026-05-01'), '2026-07-31');
  assert.equal(nextPeriodicDue('2026-01-31', 'quarterly', '2027-01-31'), '2027-01-31');
});

test('yearly leap anchors restore leap day and weekly boundaries remain calendar based', () => {
  assert.equal(nextPeriodicDue('2024-02-29', 'yearly', '2025-01-01'), '2025-02-28');
  assert.equal(nextPeriodicDue('2024-02-29', 'yearly', '2028-02-01'), '2028-02-29');
  assert.equal(nextPeriodicDue('2024-02-29', 'yearly', '2100-02-01'), '2100-02-28');
  assert.equal(nextPeriodicDue('2026-03-01', 'weekly', '2026-03-08'), '2026-03-08');
  assert.equal(nextPeriodicDue('2026-03-01', 'weekly', '2026-03-09'), '2026-03-15');
  assert.equal(nextPeriodicDue('2026-12-28', 'weekly', '2027-01-01'), '2027-01-04');
});

test('first boundary is at least one full cycle even before or on the start date', () => {
  for (const today of ['2025-01-01', '2026-01-31']) {
    assert.equal(nextPeriodicDue('2026-01-31', 'monthly', today), '2026-02-28');
    assert.equal(nextPeriodicDue('2026-01-31', 'quarterly', today), '2026-04-30');
    assert.equal(nextPeriodicDue('2026-01-31', 'yearly', today), '2027-01-31');
    assert.equal(nextPeriodicDue('2026-01-31', 'weekly', today), '2026-02-07');
  }
});

test('invalid dates reject and representable years never overflow', () => {
  for (const date of ['2026-02-29', '2026-04-31', '0000-01-01', '10000-01-01', '2026-1-01', '2026-01-01T00:00:00Z', null]) {
    assert.equal(validPeriodicDate(date), false);
    assert.throws(() => nextPeriodicDue(date, 'monthly', '2026-01-01'), RangeError);
  }
  assert.equal(nextPeriodicDue('0001-01-31', 'monthly', '0001-02-01'), '0001-02-28');
  assert.equal(nextPeriodicDue('9999-11-30', 'monthly', '9999-12-30'), '9999-12-30');
  assert.equal(nextPeriodicDue('9999-11-30', 'monthly', '9999-12-31'), null);
  for (const frequency of ['weekly', 'monthly', 'quarterly', 'yearly']) assert.equal(nextPeriodicDue('9999-12-31', frequency, '9999-12-31'), null);
  for (const frequency of ['daily', '__proto__', [], null]) assert.throws(() => nextPeriodicDue('2026-01-01', frequency, '2026-01-02'), RangeError);
  assert.throws(() => nextPeriodicDue('2026-01-01', 'monthly', '2026-02-30'), RangeError);
});

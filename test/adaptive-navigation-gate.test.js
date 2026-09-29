import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdaptiveNavigationGate } from '../src/catalog.js';

test('adaptive navigation gate spaces starts and globally pauses after 403', async () => {
  let clock = 0;
  const sleeps = [];
  const gate = createAdaptiveNavigationGate({
    intervalMs: 300,
    accessDeniedPauseMs: 10000,
    now: () => clock,
    sleepFn: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });

  await gate.beforeAttempt();
  await gate.beforeAttempt();
  await gate.beforeAttempt();
  assert.deepEqual(sleeps, [300, 300]);
  assert.equal(clock, 600);

  await gate.onAttemptResult({
    ok: false,
    status: 403,
    accessDenied: true,
    retryAfterMs: null,
  });

  assert.equal(gate.snapshot().currentIntervalMs, 600);

  await gate.beforeAttempt();
  assert.equal(clock, 10600);
  assert.equal(sleeps.at(-1), 10000);
});

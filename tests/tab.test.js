import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForLandingTarget } from '../src/core/tab.js';

describe('waitForLandingTarget()', () => {
  it('polls until a delayed TradingView landing target appears', async () => {
    let calls = 0;
    const target = { id: 'landing', title: 'New tab' };
    const result = await waitForLandingTarget(
      async () => (++calls === 3 ? target : null),
      { attempts: 5, interval: 1, sleep: async () => {} }
    );
    assert.equal(result, target);
    assert.equal(calls, 3);
  });

  it('returns null after the bounded polling window', async () => {
    let calls = 0;
    const result = await waitForLandingTarget(
      async () => { calls += 1; return null; },
      { attempts: 4, interval: 1, sleep: async () => {} }
    );
    assert.equal(result, null);
    assert.equal(calls, 4);
  });
});

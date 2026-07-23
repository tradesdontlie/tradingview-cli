import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseLayout,
  createTargetAdapter,
  parseFeedSpecs,
  planFeedAssignments,
  prepareFeedBindings,
  selectChangedEvents,
  streamOhlcvFeeds,
  validateInterval,
} from '../src/core/multi-feed.js';

describe('multi-feed specification parsing', () => {
  it('parses exchange-qualified futures with independent timeframes', () => {
    assert.deepEqual(
      parseFeedSpecs(['CME_MINI:ES1!@1', 'CME_MINI:NQ1!@5', 'NASDAQ:AAPL@15']),
      [
        { key: 'CME_MINI:ES1!@1', symbol: 'CME_MINI:ES1!', timeframe: '1' },
        { key: 'CME_MINI:NQ1!@5', symbol: 'CME_MINI:NQ1!', timeframe: '5' },
        { key: 'NASDAQ:AAPL@15', symbol: 'NASDAQ:AAPL', timeframe: '15' },
      ]
    );
  });

  it('rejects missing, malformed, and duplicate feeds', () => {
    assert.throws(() => parseFeedSpecs([]), /At least one feed/);
    assert.throws(() => parseFeedSpecs(['NASDAQ:AAPL']), /SYMBOL@TIMEFRAME/);
    assert.throws(() => parseFeedSpecs(['@5']), /SYMBOL@TIMEFRAME|symbol/);
    assert.throws(() => parseFeedSpecs(['NASDAQ:AAPL@']), /timeframe/);
    assert.throws(() => parseFeedSpecs(['NASDAQ:AAPL@5', 'NASDAQ:AAPL@5']), /Duplicate/);
  });

  it('validates the polling interval', () => {
    assert.equal(validateInterval(undefined), 250);
    assert.equal(validateInterval('100'), 100);
    assert.equal(validateInterval('500'), 500);
    assert.throws(() => validateInterval('99'), /at least 100/);
    assert.throws(() => validateInterval('1.5'), /integer/);
    assert.throws(() => validateInterval('nope'), /finite/);
  });
});

describe('multi-feed CDP adapter', () => {
  it('discovers only chart targets and opens tabs without replacing the cached client', async () => {
    const opened = [];
    const adapter = createTargetAdapter({
      fetchFn: async () => ({ json: async () => [
        { id: 'chart', type: 'page', url: 'https://www.tradingview.com/chart/abc', title: 'Chart' },
        { id: 'shell', type: 'page', url: 'file:///window/index.html', title: 'Shell' },
      ] }),
      newTabFn: async (options) => { opened.push(options); },
      cdpFn: async () => ({ Runtime: { enable: async () => {} } }),
      sleepFn: async () => {},
    });

    assert.deepEqual(await adapter.discover(), [
      { id: 'chart', url: 'https://www.tradingview.com/chart/abc', title: 'Chart' },
    ]);
    await adapter.openTab('feed tab');
    assert.deepEqual(opened, [{ layout: 'new', name: 'feed tab', reconnect: false }]);
  });

  it('uses escaped values and validates pane indexes before provisioning', async () => {
    const expressions = [];
    const delays = [];
    const state = { symbol: 'TEST:OLD', timeframe: '1', hasBar: true };
    const client = {
      Runtime: {
        async evaluate({ expression }) {
          expressions.push(expression);
          if (expression.includes('.setSymbol(')) state.symbol = 'TEST:`${danger}`';
          if (expression.includes('.setResolution(')) state.timeframe = '5';
          return { result: { value: {
            targetId: 'tab-a',
            visible: true,
            panes: [{ index: 0, ...state }],
          } } };
        },
      },
    };
    const adapter = createTargetAdapter({ sleepFn: async (ms) => { delays.push(ms); } });

    await assert.rejects(
      adapter.provision(client, 1.5, { symbol: 'TEST:X', timeframe: '5', key: 'TEST:X@5' }),
      /pane index/i
    );
    await adapter.provision(client, 0, {
      symbol: 'TEST:`${danger}`',
      timeframe: '5',
      key: 'TEST:`${danger}`@5',
    });
    assert.ok(expressions.some((expression) => expression.includes('"TEST:`${danger}`"')));
    assert.ok(expressions.some((expression) => expression.includes('setResolution("5"')));
    assert.ok(delays.filter((ms) => ms >= 500).length >= 2, 'symbol and timeframe changes each get a settle window');
  });

  it('samples validated pane indexes with source identity', async () => {
    const expressions = [];
    const client = { Runtime: { async evaluate({ expression }) {
      expressions.push(expression);
      return { result: { value: [{
        pane_index: 2,
        symbol: 'NASDAQ:AAPL',
        timeframe: '15',
        bar_time: 10,
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 5,
        bar_index: 7,
      }] } };
    } } };
    const adapter = createTargetAdapter();

    assert.deepEqual(await adapter.sample(client, [2]), [{
      pane_index: 2,
      symbol: 'NASDAQ:AAPL',
      timeframe: '15',
      bar_time: 10,
      open: 1,
      high: 2,
      low: 1,
      close: 2,
      volume: 5,
      bar_index: 7,
    }]);
    assert.ok(expressions[0].includes('[2]'));
    await assert.rejects(adapter.sample(client, [-1]), /pane index/i);
  });
});

describe('multi-feed pane assignment', () => {
  const feeds = parseFeedSpecs(['CME_MINI:ES1!@1', 'CME_MINI:NQ1!@5']);

  it('reuses exact matches across different tabs', () => {
    const plan = planFeedAssignments(feeds, [
      { targetId: 'tab-a', visible: true, panes: [{ index: 0, symbol: 'CME_MINI:ES1!', timeframe: '1', hasBar: true }] },
      { targetId: 'tab-b', visible: false, panes: [{ index: 2, symbol: 'CME_MINI:NQ1!', timeframe: '5', hasBar: true }] },
    ]);
    assert.deepEqual(plan.bindings.map((x) => [x.feed.key, x.targetId, x.paneIndex]), [
      ['CME_MINI:ES1!@1', 'tab-a', 0],
      ['CME_MINI:NQ1!@5', 'tab-b', 2],
    ]);
    assert.deepEqual(plan.missing, []);
  });

  it('reserves unused panes for missing feeds without double assignment', () => {
    const plan = planFeedAssignments(feeds, [
      { targetId: 'tab-a', visible: true, panes: [
        { index: 0, symbol: 'CME_MINI:ES1!', timeframe: '1', hasBar: true },
        { index: 1, symbol: 'NASDAQ:AAPL', timeframe: '15', hasBar: true },
      ] },
    ]);
    assert.equal(plan.bindings[0].paneIndex, 0);
    assert.deepEqual(plan.unused.map((x) => [x.targetId, x.paneIndex]), [['tab-a', 1]]);
    assert.deepEqual(plan.missing.map((x) => x.key), ['CME_MINI:NQ1!@5']);
  });

  it('chooses the smallest supported layout capacity', () => {
    assert.deepEqual(chooseLayout(1), { code: 's', capacity: 1 });
    assert.deepEqual(chooseLayout(2), { code: '2h', capacity: 2 });
    assert.deepEqual(chooseLayout(5), { code: '6', capacity: 6 });
    assert.deepEqual(chooseLayout(16), { code: '16', capacity: 16 });
    assert.equal(chooseLayout(17), null);
  });

  it('expands a visible tab and provisions a missing feed', async () => {
    const calls = [];
    const panes = [{ index: 0, symbol: 'CME_MINI:ES1!', timeframe: '1', hasBar: true }];
    const adapter = {
      async discover() { return [{ id: 'tab-a', visible: true }]; },
      async attach(id) { return { id }; },
      async inventory(_client, targetId) {
        calls.push(['inventory', targetId]);
        return { targetId, visible: true, panes: panes.map((pane) => ({ ...pane })) };
      },
      async setLayout(_client, code) {
        calls.push(['setLayout', code]);
        panes.push({ index: 1, symbol: 'NASDAQ:AAPL', timeframe: '15', hasBar: true });
      },
      async provision(_client, paneIndex, feed) {
        calls.push(['provision', paneIndex, feed.key]);
        panes[paneIndex] = { index: paneIndex, symbol: feed.symbol, timeframe: feed.timeframe, hasBar: true };
      },
      async openTab() { throw new Error('should not open a tab'); },
    };

    const prepared = await prepareFeedBindings(feeds, adapter);
    assert.deepEqual(prepared.bindings.map((x) => [x.feed.key, x.targetId, x.paneIndex]), [
      ['CME_MINI:ES1!@1', 'tab-a', 0],
      ['CME_MINI:NQ1!@5', 'tab-a', 1],
    ]);
    assert.ok(calls.some((call) => call[0] === 'setLayout' && call[1] === '2h'));
    assert.ok(calls.some((call) => call[0] === 'provision' && call[1] === 1));
    assert.ok(calls.filter((call) => call[0] === 'inventory').length >= 2);
  });

  it('opens a second tab when more than sixteen panes are required', async () => {
    const requested = parseFeedSpecs(Array.from({ length: 17 }, (_, i) => `TEST:S${i}@${i + 1}`));
    const tabs = new Map([
      ['tab-a', [{ index: 0, symbol: 'TEST:S0', timeframe: '1', hasBar: true }]],
    ]);
    let opened = 0;
    const adapter = {
      async discover() {
        return [...tabs.keys()].map((id, index) => ({ id, visible: index === 0 }));
      },
      async attach(id) { return { id }; },
      async inventory(client, targetId) {
        return { targetId, visible: client.id === 'tab-a', panes: tabs.get(targetId).map((pane) => ({ ...pane })) };
      },
      async setLayout(client, code) {
        const capacity = chooseLayout(Number(code) || (code === 's' ? 1 : code === '2h' ? 2 : code === '3h' ? 3 : 4))?.capacity
          || Number(code);
        const current = tabs.get(client.id);
        while (current.length < capacity) current.push({ index: current.length, symbol: 'EMPTY', timeframe: '1', hasBar: true });
      },
      async provision(client, paneIndex, feed) {
        tabs.get(client.id)[paneIndex] = { index: paneIndex, symbol: feed.symbol, timeframe: feed.timeframe, hasBar: true };
      },
      async openTab() {
        opened += 1;
        tabs.set(`tab-${opened + 1}`, [{ index: 0, symbol: 'EMPTY', timeframe: '1', hasBar: true }]);
      },
    };

    const prepared = await prepareFeedBindings(requested, adapter);
    assert.equal(opened, 1);
    assert.equal(prepared.bindings.length, 17);
    assert.equal(new Set(prepared.bindings.map((x) => `${x.targetId}:${x.paneIndex}`)).size, 17);
  });

  it('falls back to the largest account-supported layout and continues in new tabs', async () => {
    const requested = parseFeedSpecs(Array.from({ length: 17 }, (_, i) => `TEST:P${i}@1`));
    const tabs = new Map([
      ['tab-a', [{ index: 0, symbol: 'TEST:P0', timeframe: '1', hasBar: true }]],
    ]);
    const layoutAttempts = [];
    let opened = 0;
    const capacities = new Map([['s', 1], ['2h', 2], ['3h', 3], ['4', 4], ['6', 6], ['8', 8], ['10', 10], ['12', 12], ['14', 14], ['16', 16]]);
    const adapter = {
      async discover() { return [...tabs.keys()].map((id, i) => ({ id, visible: i === 0 })); },
      async attach(id) { return { id }; },
      async inventory(client, targetId) {
        return { targetId, visible: client.id === 'tab-a', panes: tabs.get(targetId).map((pane) => ({ ...pane })) };
      },
      async setLayout(client, code) {
        const capacity = capacities.get(code);
        layoutAttempts.push(capacity);
        if (capacity > 8) throw new Error('layout requires a higher TradingView plan');
        const panes = tabs.get(client.id);
        while (panes.length < capacity) panes.push({ index: panes.length, symbol: 'EMPTY', timeframe: '1', hasBar: true });
      },
      async provision(client, paneIndex, feed) {
        tabs.get(client.id)[paneIndex] = { index: paneIndex, symbol: feed.symbol, timeframe: feed.timeframe, hasBar: true };
      },
      async openTab() {
        opened += 1;
        tabs.set(`tab-${opened + 1}`, [{ index: 0, symbol: 'EMPTY', timeframe: '1', hasBar: true }]);
      },
    };

    const prepared = await prepareFeedBindings(requested, adapter);
    assert.ok(layoutAttempts.includes(16));
    assert.ok(layoutAttempts.includes(8));
    assert.equal(opened, 2);
    assert.equal(prepared.bindings.length, 17);
    assert.equal(new Set(prepared.bindings.map((x) => `${x.targetId}:${x.paneIndex}`)).size, 17);
  });
});

describe('multi-feed event streaming', () => {
  it('deduplicates each feed independently', () => {
    const previous = new Map();
    const first = selectChangedEvents([
      { key: 'ES@1', symbol: 'ES', timeframe: '1', bar_time: 10, open: 1, high: 2, low: 1, close: 2, volume: 5, bar_index: 7, tab_id: 'a', pane_index: 0 },
      { key: 'NQ@5', symbol: 'NQ', timeframe: '5', bar_time: 20, open: 3, high: 4, low: 3, close: 4, volume: 6, bar_index: 8, tab_id: 'b', pane_index: 1 },
    ], previous, 1000);
    assert.equal(first.length, 2);
    assert.ok(first.every((event) => event.observed_at === 1000));

    const second = selectChangedEvents([
      { key: 'ES@1', symbol: 'ES', timeframe: '1', bar_time: 10, open: 1, high: 2, low: 1, close: 2, volume: 5, bar_index: 7, tab_id: 'a', pane_index: 0 },
      { key: 'NQ@5', symbol: 'NQ', timeframe: '5', bar_time: 20, open: 3, high: 5, low: 3, close: 5, volume: 7, bar_index: 8, tab_id: 'b', pane_index: 1 },
    ], previous, 1250);
    assert.deepEqual(second.map((event) => event.symbol), ['NQ']);
  });

  it('rejects non-finite market data instead of emitting null JSON values', () => {
    assert.throws(() => selectChangedEvents([
      { key: 'ES@1', symbol: 'ES', timeframe: '1', bar_time: 10, open: 1, high: Infinity, low: 1, close: 2, volume: 5, bar_index: 7, tab_id: 'a', pane_index: 0 },
    ], new Map(), 1000), /high must be finite/);
  });

  it('samples targets concurrently, keeps stdout JSON-only, and continues healthy feeds', async () => {
    const stdout = [];
    const stderr = [];
    const clients = new Map([['tab-a', { id: 'a' }], ['tab-b', { id: 'b' }]]);
    const bindings = [
      { feed: { key: 'ES@1', symbol: 'ES', timeframe: '1' }, targetId: 'tab-a', paneIndex: 0 },
      { feed: { key: 'NQ@5', symbol: 'NQ', timeframe: '5' }, targetId: 'tab-b', paneIndex: 1 },
    ];
    let active = 0;
    let maxActive = 0;
    let iteration = 0;
    let bCalls = 0;
    const closed = [];
    const adapter = {
      async sample(client, indexes) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        if (client.id === 'b' && bCalls++ === 0) throw new Error('target disappeared');
        const price = client.id === 'a' ? 100 : 200 + bCalls;
        return [{
          pane_index: indexes[0],
          symbol: client.id === 'a' ? 'ES' : 'NQ',
          timeframe: client.id === 'a' ? '1' : '5',
          bar_time: 10,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: price,
          bar_index: 1,
        }];
      },
      async close(client) { closed.push(client.id); },
    };

    await streamOhlcvFeeds({
      feedSpecs: ['ES@1', 'NQ@5'],
      interval: 100,
      _deps: {
        adapter,
        prepare: async () => ({ bindings, clients }),
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
        sleep: async () => {},
        now: () => iteration * 100,
        shouldStop: () => iteration++ >= 3,
        recover: async () => null,
      },
    });

    assert.equal(maxActive, 2);
    const events = stdout.map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.symbol === 'ES'));
    assert.ok(events.filter((event) => event.symbol === 'ES').length === 1);
    assert.ok(events.some((event) => event.symbol === 'NQ'));
    assert.ok(stderr.join('').includes('target disappeared'));
    assert.deepEqual(closed.sort(), ['a', 'b']);
  });
});

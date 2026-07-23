import CDP from 'chrome-remote-interface';
import { CDP_HOST, CDP_PORT, safeString } from '../connection.js';
import { newTab } from './tab.js';

export function parseFeedSpecs(specs) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error('At least one feed is required. Usage: tv stream ohlcv SYMBOL@TIMEFRAME [...]');
  }

  const seen = new Set();
  return specs.map((raw) => {
    const value = String(raw).trim();
    const split = value.lastIndexOf('@');
    if (split < 1) throw new Error(`Invalid feed "${value}". Expected SYMBOL@TIMEFRAME.`);
    const symbol = value.slice(0, split).trim();
    const timeframe = value.slice(split + 1).trim();
    if (!symbol) throw new Error(`Invalid feed "${value}": symbol is required.`);
    if (!timeframe) throw new Error(`Invalid feed "${value}": timeframe is required.`);
    const key = `${symbol}@${timeframe}`;
    if (seen.has(key)) throw new Error(`Duplicate feed: ${key}`);
    seen.add(key);
    return { key, symbol, timeframe };
  });
}

export function validateInterval(value) {
  if (value === undefined) return 250;
  const interval = Number(value);
  if (!Number.isFinite(interval)) throw new Error(`Interval must be finite, got: ${value}`);
  if (!Number.isInteger(interval)) throw new Error(`Interval must be an integer, got: ${value}`);
  if (interval < 100) throw new Error('Interval must be at least 100 ms.');
  return interval;
}

const SUPPORTED_LAYOUTS = [
  { code: 's', capacity: 1 },
  { code: '2h', capacity: 2 },
  { code: '3h', capacity: 3 },
  { code: '4', capacity: 4 },
  { code: '6', capacity: 6 },
  { code: '8', capacity: 8 },
  { code: '10', capacity: 10 },
  { code: '12', capacity: 12 },
  { code: '14', capacity: 14 },
  { code: '16', capacity: 16 },
];

export function chooseLayout(count) {
  return SUPPORTED_LAYOUTS.find((layout) => layout.capacity >= count) || null;
}

export function planFeedAssignments(feeds, inventories) {
  const panes = inventories.flatMap((inventory) =>
    inventory.panes.map((pane) => ({
      targetId: inventory.targetId,
      paneIndex: pane.index,
      symbol: pane.symbol,
      timeframe: String(pane.timeframe ?? ''),
      hasBar: pane.hasBar,
    }))
  );
  const reserved = new Set();
  const bindings = [];
  const missing = [];

  for (const feed of feeds) {
    const match = panes.find((pane) =>
      !reserved.has(`${pane.targetId}:${pane.paneIndex}`)
      && pane.symbol === feed.symbol
      && pane.timeframe === feed.timeframe
      && pane.hasBar !== false
    );
    if (!match) {
      missing.push(feed);
      continue;
    }
    reserved.add(`${match.targetId}:${match.paneIndex}`);
    bindings.push({ feed, targetId: match.targetId, paneIndex: match.paneIndex, exact: true });
  }

  const unused = panes
    .filter((pane) => !reserved.has(`${pane.targetId}:${pane.paneIndex}`))
    .map(({ targetId, paneIndex }) => ({ targetId, paneIndex }));
  return { bindings, missing, unused };
}

export async function prepareFeedBindings(feeds, adapter) {
  const clients = new Map();
  let inventories = [];

  const refresh = async () => {
    const targets = await adapter.discover();
    for (const target of targets) {
      if (!clients.has(target.id)) clients.set(target.id, await adapter.attach(target.id));
    }
    inventories = await Promise.all(targets.map(async (target) => {
      const inventory = await adapter.inventory(clients.get(target.id), target.id);
      return { ...inventory, visible: inventory.visible ?? target.visible ?? false };
    }));
    return inventories;
  };

  const bindings = [];
  const reserve = (binding) => {
    bindings.push(binding);
  };
  const assignedPaneKeys = () => new Set(bindings.map((binding) => `${binding.targetId}:${binding.paneIndex}`));
  const assignInto = async (pending, panes) => {
    const remaining = [...pending];
    for (const pane of panes) {
      const feed = remaining.shift();
      if (!feed) break;
      await adapter.provision(clients.get(pane.targetId), pane.paneIndex, feed);
      reserve({ feed, targetId: pane.targetId, paneIndex: pane.paneIndex, exact: false });
    }
    return remaining;
  };

  try {
    await refresh();
    const initial = planFeedAssignments(feeds, inventories);
    initial.bindings.forEach(reserve);
    let missing = await assignInto(initial.missing, initial.unused);

    if (missing.length > 0) {
      const expandable = inventories.find((inventory) => inventory.visible && inventory.panes.length < 16)
        || inventories.find((inventory) => inventory.panes.length < 16);
      if (expandable) {
        const layout = chooseLayout(Math.min(16, expandable.panes.length + missing.length));
        if (layout && layout.capacity > expandable.panes.length) {
          await adapter.setLayout(clients.get(expandable.targetId), layout.code);
          await refresh();
          const reserved = assignedPaneKeys();
          const newPanes = inventories
            .filter((inventory) => inventory.targetId === expandable.targetId)
            .flatMap((inventory) => inventory.panes.map((pane) => ({
              targetId: inventory.targetId,
              paneIndex: pane.index,
            })))
            .filter((pane) => !reserved.has(`${pane.targetId}:${pane.paneIndex}`));
          missing = await assignInto(missing, newPanes);
        }
      }
    }

    while (missing.length > 0) {
      const before = new Set(clients.keys());
      await adapter.openTab(`TradingView CLI feeds ${clients.size + 1}`);
      await refresh();
      const created = inventories.find((inventory) => !before.has(inventory.targetId));
      if (!created) throw new Error('A new TradingView tab was requested but no new chart target appeared.');

      const layout = chooseLayout(Math.min(16, missing.length));
      if (!layout) throw new Error(`No supported TradingView layout can hold ${missing.length} feeds.`);
      if (layout.capacity > created.panes.length) {
        await adapter.setLayout(clients.get(created.targetId), layout.code);
        await refresh();
      }
      const targetInventory = inventories.find((inventory) => inventory.targetId === created.targetId);
      missing = await assignInto(missing, targetInventory.panes.map((pane) => ({
        targetId: created.targetId,
        paneIndex: pane.index,
      })));
    }

    await refresh();
    for (const binding of bindings) {
      const pane = inventories
        .find((inventory) => inventory.targetId === binding.targetId)
        ?.panes.find((candidate) => candidate.index === binding.paneIndex);
      if (!pane || pane.symbol !== binding.feed.symbol || String(pane.timeframe) !== binding.feed.timeframe || pane.hasBar === false) {
        throw new Error(`Feed ${binding.feed.key} was not ready in pane ${binding.targetId}:${binding.paneIndex}.`);
      }
    }

    const order = new Map(feeds.map((feed, index) => [feed.key, index]));
    bindings.sort((a, b) => order.get(a.feed.key) - order.get(b.feed.key));
    return { bindings, clients, inventories };
  } catch (error) {
    if (adapter.close) {
      await Promise.allSettled([...clients.values()].map((client) => adapter.close(client)));
    }
    throw error;
  }
}

function requirePaneIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Pane index must be a non-negative integer, got: ${value}`);
  }
  return index;
}

async function evaluateClient(client, expression, awaitPromise = false) {
  const response = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise });
  if (response.exceptionDetails) {
    const message = response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${message}`);
  }
  return response.result?.value;
}

export function createTargetAdapter({
  cdpFn = CDP,
  fetchFn = fetch,
  newTabFn = newTab,
  sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const inventoryExpression = `
    (function() {
      var cwc = window.TradingViewApi && window.TradingViewApi._chartWidgetCollection;
      if (!cwc || !cwc.getAll) throw new Error('TradingView chart widget collection is unavailable');
      var layout = cwc._layoutType;
      if (layout && typeof layout.value === 'function') layout = layout.value();
      var all = cwc.getAll();
      var panes = [];
      for (var i = 0; i < all.length; i++) {
        try {
          var series = all[i].model().mainSeries();
          var bars = series.bars();
          var last = bars.lastIndex();
          panes.push({
            index: i,
            symbol: series.symbol(),
            timeframe: String(series.interval()),
            hasBar: last >= 0 && !!bars.valueAt(last),
          });
        } catch (error) {
          panes.push({ index: i, symbol: null, timeframe: null, hasBar: false, error: error.message });
        }
      }
      return { visible: document.visibilityState === 'visible', layout: layout, panes: panes };
    })()
  `;

  const adapter = {
    async discover() {
      const response = await fetchFn(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
      const targets = await response.json();
      return targets
        .filter((target) => target.type === 'page' && /tradingview\.com\/chart/i.test(target.url || ''))
        .map(({ id, url, title }) => ({ id, url, title }));
    },

    async attach(targetId) {
      const client = await cdpFn({ host: CDP_HOST, port: CDP_PORT, target: targetId });
      await client.Runtime.enable();
      return client;
    },

    async close(client) {
      try { await client.close(); } catch { /* target already closed */ }
    },

    async inventory(client, targetId) {
      const result = await evaluateClient(client, inventoryExpression);
      return { targetId, ...result };
    },

    async setLayout(client, layoutCode) {
      await evaluateClient(
        client,
        `window.TradingViewApi._chartWidgetCollection.setLayout(${safeString(layoutCode)})`,
        true
      );
      await sleepFn(750);
    },

    async provision(client, paneIndex, feed) {
      const index = requirePaneIndex(paneIndex);
      await evaluateClient(client, `
        (function() {
          var pane = window.TradingViewApi._chartWidgetCollection.getAll()[${index}];
          if (!pane) throw new Error('Pane ${index} is unavailable');
          return pane.setSymbol(${safeString(feed.symbol)}, {});
        })()
      `, true);

      for (let attempt = 0; attempt < 60; attempt++) {
        const current = await adapter.inventory(client, '');
        if (current.panes[index]?.symbol === feed.symbol) break;
        if (attempt === 59) throw new Error(`Timed out setting symbol for ${feed.key}.`);
        await sleepFn(250);
      }

      await evaluateClient(client, `
        (function() {
          var pane = window.TradingViewApi._chartWidgetCollection.getAll()[${index}];
          if (!pane) throw new Error('Pane ${index} is unavailable');
          return pane.setResolution(${safeString(feed.timeframe)}, {});
        })()
      `, true);

      for (let attempt = 0; attempt < 60; attempt++) {
        const current = await adapter.inventory(client, '');
        const pane = current.panes[index];
        if (pane?.symbol === feed.symbol && pane.timeframe === feed.timeframe && pane.hasBar) return;
        if (attempt === 59) throw new Error(`Timed out loading ${feed.key} in pane ${index}.`);
        await sleepFn(250);
      }
    },

    async sample(client, paneIndexes) {
      const indexes = paneIndexes.map(requirePaneIndex);
      return evaluateClient(client, `
        (function() {
          var indexes = ${JSON.stringify(indexes)};
          var all = window.TradingViewApi._chartWidgetCollection.getAll();
          return indexes.map(function(index) {
            var pane = all[index];
            if (!pane) throw new Error('Pane ' + index + ' is unavailable');
            var series = pane.model().mainSeries();
            var bars = series.bars();
            var last = bars.lastIndex();
            var value = bars.valueAt(last);
            if (!value) return null;
            return {
              pane_index: index,
              symbol: series.symbol(),
              timeframe: String(series.interval()),
              bar_time: value[0],
              open: value[1],
              high: value[2],
              low: value[3],
              close: value[4],
              volume: value[5] == null ? 0 : value[5],
              bar_index: last,
            };
          }).filter(Boolean);
        })()
      `);
    },

    async openTab(name) {
      await newTabFn({ layout: 'new', name, reconnect: false });
    },
  };

  return adapter;
}

const BAR_FIELDS = ['bar_time', 'open', 'high', 'low', 'close', 'volume', 'bar_index'];

export function selectChangedEvents(samples, previous, observedAt) {
  const changed = [];
  for (const sample of samples) {
    for (const field of BAR_FIELDS) {
      if (!Number.isFinite(sample[field])) {
        throw new Error(`${field} must be finite for ${sample.key}.`);
      }
    }
    const hash = JSON.stringify(BAR_FIELDS.map((field) => sample[field]));
    if (previous.get(sample.key) === hash) continue;
    previous.set(sample.key, hash);
    const { key: _key, ...event } = sample;
    changed.push({ ...event, observed_at: observedAt });
  }
  return changed;
}

export async function streamOhlcvFeeds({ feedSpecs, interval, _deps = {} } = {}) {
  const feeds = parseFeedSpecs(feedSpecs);
  const pollInterval = validateInterval(interval);
  const adapter = _deps.adapter || createTargetAdapter();
  const prepare = _deps.prepare || prepareFeedBindings;
  const stdout = _deps.stdout || process.stdout.write.bind(process.stdout);
  const stderr = _deps.stderr || process.stderr.write.bind(process.stderr);
  const sleep = _deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = _deps.now || Date.now;
  const recover = _deps.recover || (async () => prepare(feeds, adapter));
  let stopped = false;
  const shouldStop = _deps.shouldStop || (() => stopped);
  const stop = () => { stopped = true; };
  const previous = new Map();
  const ownedClients = new Set();
  const closedClients = new Set();
  const recoveryState = new Map();
  let prepared;

  const closeOnce = async (client) => {
    if (!client || closedClients.has(client)) return;
    closedClients.add(client);
    await adapter.close(client);
  };

  try {
    prepared = await prepare(feeds, adapter);
    for (const client of prepared.clients.values()) ownedClients.add(client);

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    stderr(`[stream:ohlcv] ${feeds.length} chart-bar feeds ready; polling every ${pollInterval}ms (not raw exchange ticks).\n`);

    while (!stopped && !shouldStop()) {
      const cycleStartedAt = now();
      const grouped = new Map();
      for (const binding of prepared.bindings) {
        if (!grouped.has(binding.targetId)) grouped.set(binding.targetId, []);
        grouped.get(binding.targetId).push(binding);
      }

      const targetGroups = [...grouped.entries()];
      const results = await Promise.allSettled(targetGroups.map(async ([targetId, bindings]) => {
        const client = prepared.clients.get(targetId);
        if (!client) throw new Error(`No CDP client is attached to target ${targetId}.`);
        const samples = await adapter.sample(client, bindings.map((binding) => binding.paneIndex));
        return bindings.map((binding) => {
          const sample = samples.find((candidate) => candidate.pane_index === binding.paneIndex);
          if (!sample) throw new Error(`No chart bar is available for ${binding.feed.key}.`);
          if (sample.symbol !== binding.feed.symbol || String(sample.timeframe) !== binding.feed.timeframe) {
            throw new Error(`Pane ${targetId}:${binding.paneIndex} changed from ${binding.feed.key}.`);
          }
          return {
            ...sample,
            key: binding.feed.key,
            symbol: binding.feed.symbol,
            timeframe: binding.feed.timeframe,
            tab_id: targetId,
            pane_index: binding.paneIndex,
          };
        });
      }));

      const samples = [];
      const failures = [];
      results.forEach((result, index) => {
        const targetId = targetGroups[index][0];
        if (result.status === 'fulfilled') {
          samples.push(...result.value);
          recoveryState.delete(targetId);
        } else {
          failures.push({ targetId, error: result.reason });
          stderr(`[stream:ohlcv] target ${targetId} error: ${result.reason.message}\n`);
        }
      });

      for (const event of selectChangedEvents(samples, previous, now())) {
        stdout(`${JSON.stringify(event)}\n`);
      }

      for (const failure of failures) {
        const state = recoveryState.get(failure.targetId) || { attempts: 0, nextAt: 0 };
        if (now() < state.nextAt) continue;
        state.attempts += 1;
        state.nextAt = now() + Math.min(250 * (2 ** (state.attempts - 1)), 5000);
        recoveryState.set(failure.targetId, state);
        try {
          const recovered = await recover({ failure, feeds, adapter, prepared });
          if (recovered) {
            for (const client of recovered.clients.values()) ownedClients.add(client);
            prepared = recovered;
            recoveryState.clear();
            stderr(`[stream:ohlcv] bindings recovered after target ${failure.targetId} failed.\n`);
          }
        } catch (error) {
          stderr(`[stream:ohlcv] recovery attempt ${state.attempts} failed: ${error.message}\n`);
        }
      }

      const remaining = pollInterval - (now() - cycleStartedAt);
      if (remaining > 0 && !stopped) await sleep(remaining);
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await Promise.allSettled([...ownedClients].map(closeOnce));
    stderr('[stream:ohlcv] stopped. Provisioned panes and tabs were left open.\n');
  }
}

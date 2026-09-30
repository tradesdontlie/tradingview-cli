import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStrategy, runBatch } from '../examples/pine-batch.js';

const options = { chartId: 'fixture-layout', symbol: 'BINANCE:BTCUSDT', timeframe: '60', start: '2026-08-01T00:00:00Z', end: '2026-09-30T00:00:00Z' };

function fixture({ compileError = false, staleReport = false, foreign = [], restoreError = false } = {}) {
  const state = { symbol: 'NASDAQ:AAPL', resolution: '1D', chartType: 2, studies: [{ id: 'volume', name: 'Volume' }] };
  const initial = structuredClone(state);
  let source = 'original editor draft';
  let writes = 0, reports = 0;
  const api = {
    sleep: async () => {},
    tabs: { list: async () => ({ tabs: [{ chart_id: options.chartId }] }), switchTab: async () => {} },
    connection: { evaluate: async (expression) => expression.includes('innerWidth') ? { width: 1280, height: 720 } : foreign },
    chart: {
      getState: async () => structuredClone(state),
      setSymbol: async ({ symbol }) => { state.symbol = symbol; },
      setTimeframe: async ({ timeframe }) => { state.resolution = timeframe; },
      setType: async ({ chart_type }) => { state.chartType = chart_type === 'Candles' ? 1 : Number(chart_type); },
      manageIndicator: async ({ entity_id }) => { state.studies = state.studies.filter((study) => study.id !== entity_id); },
    },
    pine: {
      getSource: async () => ({ source }),
      setSource: async ({ source: next }) => {
        if (restoreError && next === 'original editor draft') throw new Error('restore failed');
        writes++; source = next;
      },
      smartCompile: async () => {
        if (compileError) return { has_errors: true, errors: ['invalid fixture'] };
        state.studies.push({ id: 'example', name: source.match(/strategy\("([^"]+)"/)[1] });
        return { has_errors: false };
      },
    },
    data: {
      getStrategyResults: async () => {
        reports++;
        return { success: true, strategy: staleReport ? 'another strategy' : state.studies.at(-1).name, currency: 'USDT', metrics: { total_trades: 0 } };
      },
      getTrades: async () => ({ trades: [], total_orders: 0 }),
    },
  };
  return { api, state, initial, source: () => source, writes: () => writes, reports: () => reports };
}

describe('Pine batch example', () => {
  it('rejects invalid lengths and dates before generating executable Pine', () => {
    assert.throws(() => createStrategy({ ...options, fast: NaN, slow: 30 }), /integer/);
    assert.throws(() => createStrategy({ ...options, fast: 30, slow: 10 }), /integer/);
    assert.throws(() => createStrategy({ ...options, fast: 10, slow: 30, start: options.end }), /start before end/);
  });

  it('requires an explicit open disposable layout', async () => {
    const f = fixture();
    await assert.rejects(runBatch({ ...options, chartId: undefined }, f.api), /explicit/);
    await assert.rejects(runBatch({ ...options, chartId: 'missing' }, f.api), /not open/);
    assert.equal(f.writes(), 0);
  });

  it('does not overwrite a layout containing another strategy', async () => {
    const f = fixture({ foreign: ['Personal strategy'] });
    await assert.rejects(runBatch(options, f.api), /Remove other strategies/);
    assert.equal(f.writes(), 0);
  });

  it('runs both variants and restores the original draft, chart settings, and indicators', async () => {
    const f = fixture();
    const result = await runBatch(options, f.api);
    assert.deepEqual(result.results.map((run) => run.strategy), ['TV CLI Example SMA 10-30', 'TV CLI Example SMA 20-60']);
    assert.equal(result.restored, true);
    assert.equal(f.source(), 'original editor draft');
    assert.deepEqual(f.state, f.initial);
  });

  it('restores the draft and chart settings after compilation fails', async () => {
    const f = fixture({ compileError: true });
    await assert.rejects(runBatch(options, f.api), /compilation failed/);
    assert.equal(f.source(), 'original editor draft');
    assert.deepEqual(f.state, f.initial);
  });

  it('rejects stale reports after bounded polling and still restores the original draft', async () => {
    const f = fixture({ staleReport: true });
    await assert.rejects(runBatch(options, f.api), /refusing stale results/);
    assert.equal(f.reports(), 12);
    assert.equal(f.source(), 'original editor draft');
    assert.deepEqual(f.state, f.initial);
  });

  it('reports cleanup failure instead of claiming that the draft was restored', async () => {
    const f = fixture({ restoreError: true });
    await assert.rejects(runBatch(options, f.api), /editor draft: restore failed/);
    assert.deepEqual(f.state, f.initial);
  });
});

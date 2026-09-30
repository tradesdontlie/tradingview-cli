/** Run a small Pine parameter sweep on an explicitly selected, disposable chart. */
import { parseArgs } from 'node:util';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chart from '../src/core/chart.js';
import * as pine from '../src/core/pine.js';
import * as data from '../src/core/data.js';
import * as tabs from '../src/core/tab.js';
import * as connection from '../src/connection.js';

const PREFIX = 'TV CLI Example SMA ';
const template = readFileSync(new URL('./sma-crossover.pine', import.meta.url), 'utf8');

export function createStrategy({ fast, slow, start, end }) {
  if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 1 || slow <= fast) throw new Error('Require integer SMA lengths with 0 < fast < slow');
  const begin = Date.parse(start), finish = Date.parse(end);
  if (!Number.isFinite(begin) || !Number.isFinite(finish) || begin >= finish) throw new Error('Require a valid start before end');
  const title = `${PREFIX}${fast}-${slow}`;
  return {
    title,
    source: template.replace('"TV CLI Example SMA"', JSON.stringify(title))
      .replace('input.int(10,', `input.int(${fast},`)
      .replace('input.int(30,', `input.int(${slow},`)
      .replace('input.time(0,', `input.time(${begin},`)
      .replace('input.time(timestamp("01 Jan 2100 00:00 +0000"),', `input.time(${finish},`),
  };
}

export async function runBatch(options, api = { chart, pine, data, tabs, connection }) {
  if (!options.chartId) throw new Error('An explicit --chart-id is required; use a separate disposable layout');
  const variants = [[10, 30], [20, 60]].map(([fast, slow]) => createStrategy({ fast, slow, start: options.start, end: options.end }));
  const state = await api.tabs.list();
  const index = state.tabs.findIndex((tab) => tab.chart_id === options.chartId);
  if (index < 0) throw new Error('The specified chart layout is not open in TradingView Desktop');
  await api.tabs.switchTab({ index });
  const viewport = await api.connection.evaluate('({ width: innerWidth, height: innerHeight })');
  if (!viewport.width || !viewport.height) throw new Error('Show the TradingView Desktop window; its chart viewport has zero size');
  const existing = await api.connection.evaluate(`(() => {
    const chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
    return chart.model().model().dataSources().filter(s => {
      const info = s.metaInfo?.(); return info?.isTVScriptStrategy || info?.is_strategy;
    }).map(s => s.metaInfo().description);
  })()`);
  if (existing.some((name) => !name?.startsWith(PREFIX))) throw new Error('Remove other strategies from this disposable layout before running the example');
  const beforeChart = await api.chart.getState();
  const beforeSource = (await api.pine.getSource()).source;
  const removeExamples = async () => {
    const current = await api.chart.getState();
    for (const study of current.studies.filter((item) => item.name.startsWith(PREFIX))) {
      await api.chart.manageIndicator({ action: 'remove', entity_id: study.id });
    }
  };
  const results = [];
  let failure;
  const cleanupErrors = [];
  try {
    if (beforeChart.symbol !== options.symbol) await api.chart.setSymbol({ symbol: options.symbol });
    if (beforeChart.resolution !== options.timeframe) await api.chart.setTimeframe({ timeframe: options.timeframe });
    if (beforeChart.chartType !== 1) await api.chart.setType({ chart_type: 'Candles' });
    const configured = await api.chart.getState();
    if (configured.symbol !== options.symbol || configured.resolution !== options.timeframe || configured.chartType !== 1) throw new Error('Chart settings did not match the requested experiment');
    for (const variant of variants) {
      await removeExamples();
      await api.pine.setSource({ source: variant.source });
      if ((await api.pine.getSource()).source.trim() !== variant.source.trim()) throw new Error('Pine source read-back mismatch');
      const compile = await api.pine.smartCompile();
      if (compile.has_errors) throw new Error(`Pine compilation failed: ${JSON.stringify(compile.errors)}`);
      let report;
      for (let attempt = 0; attempt < 12; attempt++) {
        report = await api.data.getStrategyResults();
        if (report.success && report.strategy === variant.title) break;
        await (api.sleep || ((ms) => new Promise((done) => setTimeout(done, ms))))(500);
      }
      if (!report.success || report.strategy !== variant.title) throw new Error('The requested strategy report is not ready; refusing stale results');
      const orders = await api.data.getTrades({ max_trades: 10 });
      results.push({ strategy: variant.title, currency: report.currency, metrics: report.metrics, recentOrders: orders.trades, totalOrders: orders.total_orders });
    }
  } catch (error) { failure = error; }
  finally {
    const cleanup = async (label, action) => { try { await action(); } catch (error) { cleanupErrors.push(`${label}: ${error.message}`); } };
    await cleanup('example studies', removeExamples);
    await cleanup('editor draft', async () => {
      await api.pine.setSource({ source: beforeSource });
      if ((await api.pine.getSource()).source !== beforeSource) throw new Error('restored draft did not match');
    });
    await cleanup('chart settings', async () => {
      const current = await api.chart.getState();
      if (current.symbol !== beforeChart.symbol) await api.chart.setSymbol({ symbol: beforeChart.symbol });
      if (current.resolution !== beforeChart.resolution) await api.chart.setTimeframe({ timeframe: beforeChart.resolution });
      if (current.chartType !== beforeChart.chartType) await api.chart.setType({ chart_type: String(beforeChart.chartType) });
    });
  }
  if (cleanupErrors.length) throw new Error([failure?.message, ...cleanupErrors].filter(Boolean).join('; '));
  if (failure) throw failure;
  return { symbol: options.symbol, timeframe: options.timeframe, start: options.start, endExclusive: options.end, results, restored: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'chart-id': { type: 'string' }, symbol: { type: 'string', default: 'BINANCE:BTCUSDT' },
      timeframe: { type: 'string', default: '60' }, start: { type: 'string' }, end: { type: 'string' },
      out: { type: 'string', default: 'results/pine-batch.json' },
    } });
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
    const end = values.end || midnight.toISOString();
    const start = values.start || new Date(Date.parse(end) - 60 * 86400000).toISOString();
    const result = await runBatch({ chartId: values['chart-id'], symbol: values.symbol, timeframe: values.timeframe, start, end });
    const output = resolve(values.out);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ success: true, experiments: result.results.length, output, restored: result.restored }));
  } catch (error) { console.error(JSON.stringify({ success: false, error: error.message })); process.exitCode = 1; }
  finally { await connection.disconnect(); }
}

# Pine batch example

This example runs two SMA configurations through the real TradingView Strategy Tester. It is a plumbing demonstration, not an assessment of strategy quality. It creates no alerts and places no live broker orders.

## Setup

1. Install the CLI dependencies with `npm ci`.
2. Run a signed-in TradingView Desktop with `--remote-debugging-port=9222` bound to localhost. Keep its window displayed: a hidden or newly created tab can have a zero-size viewport.
3. Create a separate disposable saved chart layout in TradingView and open it in Desktop. Remove other strategies from that layout; ordinary indicators may stay.
4. Run `node src/cli/index.js tab list` and copy that layout's `chart_id`.

Run from the repository root, replacing `YOUR_DISPOSABLE_CHART_ID`:

```powershell
node examples/pine-batch.js --chart-id YOUR_DISPOSABLE_CHART_ID --symbol BINANCE:BTCUSDT --timeframe 60 --start 2026-08-01T00:00:00Z --end 2026-09-30T00:00:00Z --out results/pine-batch.json
```

The same command works in bash. Omit `--start` and `--end` to use the 60 days ending at today's UTC midnight. The interval is an entry-signal window; the broker emulator fills market orders on the next available bar, so the final exit may occur at the boundary. Available chart history and subscription limits still apply.

The runner selects the explicit layout, tries SMA 10/30 and 20/60, verifies the source read-back, compiles, checks the report's strategy name, and saves metrics plus the ten most recent order records. No model invocation is needed between experiments. The Pine template uses a 10,000 initial balance, 10% equity per position, 0.05% commission per order, one tick of slippage, and no pyramiding.

After success or failure, it removes only its own example studies and restores the selected chart's symbol, timeframe, type, and editor draft. Cleanup failures produce a nonzero exit code. The selected layout tab remains open. TradingView may share the editor draft between tabs, so do not edit Pine elsewhere while the batch is running.

## Result interpretation

- `metrics` preserves the CLI's raw Strategy Tester fields. In the Desktop 3.4.1 build used for validation, percentage fields were fractions: `0.02` represented 2%. Check the UI before comparing these fields across versions.
- `recentOrders` contains order events, not a complete closed-trade ledger. The CLI currently limits this query to twenty records; this example requests ten.
- The current Desktop build did not expose a per-bar equity series through `data equity`. The example does not fabricate one or substitute buy-and-hold data.
- Reports are read sequentially from one layout. Do not run concurrent parameter sweeps against the same chart.

`sma-crossover.pine` is also a valid standalone Pine v6 script. Its default dates admit all available history; the batch runner sets explicit timestamps and lengths for each experiment.

## Validation

The compatible Pine and tab paths were verified on Windows, TradingView Desktop 3.4.1.8194 (Windows Store), Node.js 24.19.0, and the Korean UI. The fixes have offline DOM regression tests. A real Desktop run is still required to validate future TradingView releases, because the underlying UI and internal APIs are undocumented.

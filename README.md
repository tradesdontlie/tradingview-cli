# TradingView CLI

Control a running TradingView Desktop session from your terminal through Chrome DevTools Protocol (CDP). The `tv` command emits JSON, so it works well in shell scripts and `jq` pipelines.

This is an unofficial local automation tool. It is not affiliated with or endorsed by TradingView Inc.

## Prerequisites

- Node.js 20 or newer
- TradingView Desktop installed and signed in
- A TradingView plan that supports the features you use
- TradingView launched with a local CDP port (the default is `9222`)

## Install

Clone the repository and install its single runtime dependency:

```bash
git clone https://github.com/tradesdontlie/tradingview-cli.git
cd tradingview-cli
npm install
npm link
```

`npm link` makes the `tv` command available globally. Without linking, run commands as `npm run tv -- <command>`.

## Launch TradingView with CDP

The simplest option is:

```bash
tv launch
tv status
```

`tv launch` finds TradingView on macOS, Windows, or Linux and restarts it with `--remote-debugging-port=9222`. Pass `--no-kill` to avoid closing an existing instance, or `--port 9333` to choose another port.

Platform launch scripts are also included:

```powershell
# Windows
.\scripts\launch_tv_debug.bat
```

```bash
# macOS
./scripts/launch_tv_debug_mac.sh

# Linux
./scripts/launch_tv_debug_linux.sh
```

To launch manually, fully quit TradingView first and start its executable with:

```text
--remote-debugging-port=9222
```

## Quick Start

```bash
# Inspect the current chart
tv status
tv state
tv quote
tv ohlcv --count 20 --summary

# Change the chart
tv symbol NASDAQ:AAPL
tv timeframe 15
tv type Candles

# Read indicator and Pine drawing data
tv values
tv data lines --filter "My Indicator"
tv data labels --filter "My Indicator"

# Work with Pine Script
tv pine analyze --file indicator.pine
tv pine set --file indicator.pine
tv pine compile

# Practice with bar replay
tv replay start --date 2025-03-01
tv replay step
tv replay trade buy
tv replay status

# Stream newline-delimited JSON
tv stream quote --interval 500 | jq .close
```

Run `tv --help`, `tv <command> --help`, or `tv <command> <subcommand> --help` for the current options.

## Commands

| Area | Commands |
| --- | --- |
| Connection | `status`, `launch`, `update`, `discover`, `ui-state` |
| Chart | `state`, `symbol`, `timeframe`, `type`, `info`, `search`, `range`, `scroll` |
| Market data | `quote`, `ohlcv`, `values` |
| Advanced data | `data lines`, `labels`, `tables`, `boxes`, `strategy`, `trades`, `equity`, `depth`, `indicator` |
| Pine Script | `pine get`, `set`, `compile`, `raw-compile`, `analyze`, `check`, `save`, `new`, `open`, `list`, `errors`, `console` |
| Screenshots | `screenshot` |
| Replay | `replay start`, `step`, `stop`, `status`, `autoplay`, `trade` |
| Drawings | `draw shape`, `list`, `get`, `remove`, `clear` |
| Alerts | `alert list`, `create`, `delete` |
| Watchlists | `watchlist get`, `add`, `add-bulk`, `remove` |
| Layouts and indicators | `layout list`, `layout switch`, `indicator add`, `remove`, `toggle`, `set`, `get` |
| UI automation | `ui click`, `keyboard`, `hover`, `scroll`, `find`, `eval`, `type`, `panel`, `fullscreen`, `mouse` |
| Panes and tabs | `pane list`, `layout`, `focus`, `symbol`; `tab list`, `new`, `close`, `switch` |
| Streaming | `stream quote`, `bars`, `values`, `lines`, `labels`, `tables`, `all` |

Most commands operate on the currently active TradingView chart. Entity IDs returned by `tv state`, `tv draw list`, or related commands are session-specific.

## JSON Output and Exit Codes

Successful commands write formatted JSON to stdout:

```json
{
  "success": true,
  "symbol": "NASDAQ:AAPL",
  "resolution": "15"
}
```

Errors are JSON on stderr. Exit codes are:

- `0`: success
- `1`: invalid command, invalid input, or operation failure
- `2`: CDP connection failure or TradingView not running

Streaming commands emit JSON Lines (one JSON object per line) until interrupted with Ctrl+C.

## Updating

From a clean Git checkout on `main`:

```bash
tv update
```

The command fetches and fast-forwards `origin/main`. If `package-lock.json` changed, it also runs `npm ci`. Restart the `tv` command after an update.

## Testing

```bash
npm ci
npm run lint
npm test
```

The offline suite covers routing, Pine analysis and compile checks, input sanitization, replay behavior, launch detection, chart history, indicator inputs, self-update guards, and the repository boundary.

With TradingView Desktop running on port 9222, run the live integration suite:

```bash
npm run test:e2e
```

## Architecture

```text
tv command -> command adapter -> core operation -> CDP on localhost:9222 -> TradingView Desktop
```

- `src/cli/` parses commands and serializes results.
- `src/core/` implements chart, data, Pine, replay, drawing, UI, and launch behavior.
- `src/connection.js` owns the CDP connection and safe page evaluation helpers.
- `src/wait.js` centralizes chart readiness and render waits.

## Security and Limitations

- CDP can control the TradingView Desktop page. Keep it bound to localhost and never expose port 9222 to an untrusted network.
- The CLI automates your local desktop session; it does not bypass TradingView authentication, subscriptions, permissions, or product limits.
- TradingView's internal page APIs can change without notice and may require compatibility updates here.
- Review commands before using them in unattended scripts, especially UI automation, alert deletion, drawing removal, and replay trades.

Use this project subject to the [TradingView Terms of Use](https://www.tradingview.com/policies/).

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development commands and scope.

## Attribution and Disclaimer

TradingView is a trademark of TradingView Inc. This independent project is not affiliated with, endorsed by, sponsored by, or associated with TradingView Inc. It does not include or modify TradingView software. Users are responsible for complying with TradingView's terms and all applicable laws.

## License

The source code is available under the MIT License. See [LICENSE](LICENSE) for the full license and trademark notice.

# Contributing

Thanks for contributing to TradingView CLI.

## Scope

Changes are welcome when they improve:

- `tv` commands and argument handling
- CDP-backed core operations
- TradingView Desktop discovery and launch support on macOS, Windows, or Linux
- Input safety, error reporting, and compatibility
- Offline or live-CDP test coverage
- CLI documentation

Please keep unrelated integrations and hosted services out of scope. This repository is intentionally a focused, local command-line tool.

## Development

Use Node.js 20 or newer:

```bash
git clone https://github.com/tradesdontlie/tradingview-cli.git
cd tradingview-cli
npm ci
npm run lint
npm test
```

Run `npm run test:e2e` only when TradingView Desktop is available on local CDP port 9222.

Keep command adapters in `src/cli/commands/` thin. Put reusable TradingView behavior in `src/core/`, validate all values interpolated into page evaluations, and preserve JSON output plus the documented exit codes.

## Pull Requests

- Explain the user-visible behavior and compatibility impact.
- Add or update focused tests for behavior changes.
- Run `npm run lint` and `npm test` before opening the pull request.
- Note whether `npm run test:e2e` ran and which operating system and TradingView Desktop version you used.
- Avoid drive-by formatting or unrelated refactors.

## Bug Reports

Open an issue at <https://github.com/tradesdontlie/tradingview-cli/issues> with:

- operating system and Node.js version
- TradingView Desktop version and install type
- the exact `tv` command
- complete JSON output and exit code
- `tv status` output when the issue involves connectivity

Remove account details, proprietary Pine source, symbols, alerts, or other sensitive chart data before posting logs.

# Security Policy

## Reporting a Vulnerability

Please use a private [GitHub security advisory](https://github.com/tradesdontlie/tradingview-cli/security/advisories/new). Do not open a public issue for an unpatched vulnerability.

Include affected versions, operating system, reproduction steps, expected impact, and any proposed mitigation. Remove credentials and private chart or account data.

## Scope

Security reports may cover:

- command or argument handling that enables code injection
- unsafe interpolation into TradingView page evaluations
- path traversal or unintended local file writes
- CDP connection behavior that exposes control beyond localhost
- launch, update, or dependency behavior that can execute unintended code

TradingView account security, website vulnerabilities, billing, and subscription issues must be reported to TradingView through its official channels.

## Safe Use

- Bind CDP to localhost and do not expose port 9222 to your LAN or the internet.
- Run the CLI only on machines and TradingView sessions you control.
- Keep Node.js, TradingView Desktop, and project dependencies updated.
- Inspect automation scripts before running destructive UI, alert, drawing, or replay operations.
- Redact account details, Pine source, watchlists, alerts, and chart data from shared logs.

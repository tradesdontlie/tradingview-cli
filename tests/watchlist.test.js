import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = readFileSync(join(ROOT, 'src', 'core', 'watchlist.js'), 'utf8');

// The selector chain is a page-evaluation string, so exercise it the way the
// page does: build a function from the source expression and hand it a stub
// document that exposes only the attributes a given TradingView build has.
function findButton(attributes) {
  const match = SOURCE.match(/const WL_BUTTON_JS = `([\s\S]*?)`;/);
  assert.ok(match, 'WL_BUTTON_JS must be defined as a template literal');
  const button = { marker: 'watchlist-button' };
  const document = {
    querySelector(selector) {
      return attributes.some(attribute => selector === `[${attribute}]`
        || (selector.endsWith('^="Watchlist"]') && attribute.startsWith('aria-label="Watchlist')))
        ? button
        : null;
    },
  };
  return new Function('document', `return ${match[1]};`)(document);
}

describe('watchlist button lookup', () => {
  it('finds the button on a localized UI, where every aria-label differs', () => {
    // jp.tradingview.com renders aria-label="ウォッチリスト・詳細・ニュース".
    assert.ok(findButton(['data-name="base"']), 'localized UI must resolve the button');
  });

  it('finds the button on a current English build', () => {
    assert.ok(findButton(['data-name="base"', 'aria-label="Watchlist, details, and news"']));
  });

  it('still finds the button on builds that predate data-name="base"', () => {
    assert.ok(findButton(['data-name="base-watchlist-widget-button"']));
    assert.ok(findButton(['aria-label="Watchlist"']));
  });

  it('returns null when no watchlist button is present', () => {
    assert.equal(findButton([]), null);
  });

  it('prefers the language-independent handle over the localized one', () => {
    const order = SOURCE.match(/const WL_BUTTON_JS = `([\s\S]*?)`;/)[1];
    assert.ok(order.indexOf('data-name="base"') < order.indexOf('aria-label'),
      'data-name must be tried before any aria-label');
  });
});

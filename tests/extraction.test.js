import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(ROOT, path), 'utf8');
const LEGACY_SDK = ['@model', 'contextprotocol/sdk'].join('');
const LEGACY_REPO = ['tradingview', String.fromCharCode(109, 99, 112)].join('-');
const LEGACY_SERVER = ['M', 'CP server'].join('');

describe('standalone CLI repository boundary', () => {
  it('exposes only the tv CLI package entry point', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.name, 'tradingview-cli');
    assert.deepEqual(pkg.bin, { tv: 'src/cli/index.js' });
    assert.equal(pkg.main, undefined);
    assert.equal(pkg.exports, undefined);
  });

  it('has no legacy protocol dependency or implementation surfaces', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.dependencies[LEGACY_SDK], undefined);
    for (const path of [
      join('src', 'server.js'),
      join('src', 'tools'),
      join('src', 'core', 'batch.js'),
      join('src', 'core', 'index.js'),
    ]) {
      assert.equal(existsSync(join(ROOT, path)), false, `${path} must not exist`);
    }
  });

  it('uses the standalone repository for self-update guidance', () => {
    const source = read('src/core/update.js');
    assert.match(source, /github\.com\/tradesdontlie\/tradingview-cli/);
    assert.doesNotMatch(source, new RegExp(`${LEGACY_REPO}|${LEGACY_SERVER}`));
  });
});

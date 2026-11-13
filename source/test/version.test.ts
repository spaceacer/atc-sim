// The version (SemVer) must be the same everywhere it appears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../src/version.js';
import { sessionFromSim } from '../src/data/session.js';
import { emptySim } from './helpers.js';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('VERSION is MAJOR.MINOR.PATCH', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('every place that states the version agrees with src/version.ts', () => {
  assert.equal(JSON.parse(read('package.json')).version, VERSION, 'package.json');
  assert.match(read('python/pyproject.toml'), new RegExp(`^version = "${VERSION}"$`, 'm'), 'pyproject.toml');
  assert.match(read('python/atc_sim/__init__.py'), new RegExp(`^__version__ = "${VERSION}"$`, 'm'), '__init__.py');
  const html = read('index.html');
  assert.ok(html.includes(`<meta name="version" content="${VERSION}" />`), 'index.html meta');
  assert.ok(html.includes(`<title>ATC Simulator ${VERSION}</title>`), 'index.html title');
  assert.ok(html.includes(`<span id="version">${VERSION}</span>`), 'index.html footer');
  assert.ok(html.includes(`<span class="version-number">${VERSION}</span>`), 'index.html ground panel footer');
  assert.ok(read('README.md').includes(`Version ${VERSION}`), 'README');
  assert.ok(read('README.md').includes(`ATC-Sim-${VERSION}.html`), 'README standalone file name');
  const top = read('CHANGELOG.md').match(/^## (\d+\.\d+\.\d+)/m);
  assert.equal(top?.[1], VERSION, 'newest CHANGELOG entry');
});

test('saved sessions record the simulator version', () => {
  assert.equal(sessionFromSim(emptySim(), 'xdem').appVersion, VERSION);
});

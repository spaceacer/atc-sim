import assert from 'node:assert/strict';
import { test } from 'node:test';
import { THEME_IDS, cssVarsFor } from '../src/ui/theme.js';

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('every theme defines the same set of variables', () => {
  const keys = Object.keys(cssVarsFor(THEME_IDS[0])).sort();
  for (const id of THEME_IDS) assert.deepEqual(Object.keys(cssVarsFor(id)).sort(), keys, id);
});

test('themes keep text readable on their surfaces', () => {
  for (const id of THEME_IDS) {
    const v = cssVarsFor(id);
    assert.ok(contrast(v['--scope-text'], v['--scope']) >= 7, `${id}: scope text`);
    assert.ok(contrast(v['--ink'], v['--bezel']) >= 7, `${id}: panel text`);
    assert.ok(contrast(v['--ink-quiet'], v['--bezel']) >= 4.5, `${id}: quiet panel text`);
    assert.ok(contrast(v['--scope-dim'], v['--scope']) >= 4.5, `${id}: dim scope text`);
    assert.ok(contrast(v['--on-accent'], v['--accent']) >= 4.5, `${id}: text on accent`);
    assert.ok(contrast(v['--on-solid'], v['--solid']) >= 4.5, `${id}: text on solid`);
    assert.ok(contrast(v['--accent'], v['--scope']) >= 3, `${id}: accent on scope`);
  }
});

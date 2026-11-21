/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/styles/fieldEdge.test.ts
 *
 * WCAG 1.4.11 Non-text Contrast: the boundary of a text field must reach 3:1
 * against what it sits on (white card, or the #f1efeb canvas). The old edge,
 * --border-strong (#cfcac2), measured 1.63:1 / 1.42:1.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const css = fs.readFileSync(path.join(import.meta.dirname, 'global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('--field-edge is defined and reaches 3:1 on white and on the canvas', () => {
  const edge = css.match(/--field-edge:\s*(#[0-9a-fA-F]{6})\s*;/);
  assert.ok(edge, 'global.css must define --field-edge');
  assert.ok(contrast(edge![1], '#ffffff') >= 3, 'field edge must be >= 3:1 on white');
  assert.ok(contrast(edge![1], '#f1efeb') >= 3, 'field edge must be >= 3:1 on the canvas');
});

test('every text-entry control takes its border from the one shared --field-edge rule', () => {
  const rule = css.match(/([^{}]+)\{\s*border:\s*1px solid var\(--field-edge\);\s*\}/);
  assert.ok(rule, 'expected a single rule drawing border: 1px solid var(--field-edge)');
  for (const selector of ['.field select', '.field textarea', '.inbox-composer textarea', '.broadcast-compose textarea', '.audit-input', '.row-input', ".broadcast-send input[type='datetime-local']"]) {
    assert.ok(rule![1].includes(selector), `${selector} must be in the shared field-edge rule`);
  }
  assert.match(rule![1], /\.field input/);
});

test('the .select-pill placeholder colour reaches 4.5:1 on the pill fill over white and over the canvas', () => {
  const rule = css.match(/\.select-pill::placeholder\s*\{([^}]*)\}/);
  assert.ok(rule, 'global.css must style .select-pill::placeholder');
  const ref = rule![1].match(/color:\s*var\((--[a-z-]+)\)/);
  assert.ok(ref, 'placeholder colour must be a design token');
  const token = css.match(new RegExp(String.raw`${ref![1]}:\s*(#[0-9a-fA-F]{6})\s*;`));
  assert.ok(token, `${ref![1]} must be a hex token`);
  // Pill fill is rgba(21,23,26,0.06): composite it over each surface.
  const pill = css.match(/\.select-pill\s*\{[^}]*background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(pill, 'expected the .select-pill rgba background');
  const [pr, pg, pb] = [pill![1], pill![2], pill![3]].map(Number);
  const alpha = Number(pill![4]);
  for (const surface of ['#ffffff', '#f1efeb']) {
    const under = [1, 3, 5].map((i) => parseInt(surface.slice(i, i + 2), 16));
    const mixed = [pr, pg, pb].map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha)));
    const hex = `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    assert.ok(contrast(token![1], hex) >= 4.5, `placeholder must be >= 4.5:1 on the pill over ${surface} (${hex})`);
  }
});

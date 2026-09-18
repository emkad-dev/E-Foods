/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/styles/fillOnlyColors.test.ts
 *
 * Some colours in this palette are backgrounds and nothing else. They are light
 * or saturated enough that as a LINE -- text, an outline, an icon stroke -- they
 * fail contrast against the surfaces they sit on, while working perfectly as a
 * fill with dark ink on top.
 *
 * The design system states this for the token layer (`a11y.fillOnly` in
 * packages/design-system/src/tokens/color.ts, asserted by its own tests). This
 * file is the same rule for admin's stylesheet, which is hand-written CSS and
 * was never covered by anything.
 *
 * It exists because the rule was broken twice in one sweep, both times by the
 * same value:
 *
 *   - customer's focused tab icon was forced to #ffffff on #c8e6c9 -- 1.34:1,
 *     so tapping a tab made its icon disappear
 *   - admin's own focus ring drew #c8e6c9 at 1.34:1 against the field and
 *     1.25:1 against the page: an indicator present in the DOM and invisible
 *     on screen
 *
 * Twice is a pattern, and a pattern belongs in a test rather than in someone's
 * memory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const cssPath = path.join(import.meta.dirname, 'global.css');

/**
 * Values that may fill a box and must never draw a line.
 *
 * `--accent-soft` (#c8e6c9) and `--brand-orange` (#f57c00) mirror
 * `brand.primarySoft` and `brand.accent`, which the design system already
 * lists as fill-only. Both appear here as raw hex and as a var(), so the
 * check has to catch either spelling.
 */
const FILL_ONLY = [
  { token: '--accent-soft', hex: '#c8e6c9' },
  { token: '--brand-orange', hex: '#f57c00' },
];

/** Properties that draw a line or a glyph rather than a surface. */
const LINE_PROPERTIES = ['color', 'outline', 'outline-color', 'text-decoration-color'];

/**
 * The one exemption, and it is a real one: WCAG 1.4.3 excludes "text that is
 * part of a logo or brand name" from contrast entirely. The FEASTY wordmark is
 * FEAST in green and Y in orange, and the brief was to keep that identity.
 *
 * Matched on the selector name rather than offered as a magic opt-out comment,
 * so nobody exempts a button by writing the right words above it.
 */
const LOGOTYPE_SELECTOR = /^\.wordmark-/;

/** Blank comments so a hex inside prose is not read as a declaration. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

test('no fill-only colour is used to draw a line or text', () => {
  const css = stripComments(fs.readFileSync(cssPath, 'utf8'));
  const lines = css.split('\n');
  const offences: string[] = [];
  let inLogotypeRule = false;

  lines.forEach((line, index) => {
    const selector = line.match(/^(\.[A-Za-z0-9_-]+)[^{]*\{/);
    if (selector) {
      inLogotypeRule = LOGOTYPE_SELECTOR.test(selector[1]!);
    } else if (/^\s*\}/.test(line)) {
      inLogotypeRule = false;
    }

    const declaration = line.match(/^\s*([a-z-]+)\s*:\s*(.+?);/);
    if (!declaration) return;

    const property = declaration[1]!;
    const value = declaration[2]!;

    // `--accent-soft: #c8e6c9;` is the definition, not a use.
    if (property.startsWith('--')) return;
    if (!LINE_PROPERTIES.includes(property)) return;
    if (inLogotypeRule) return;

    for (const { token, hex } of FILL_ONLY) {
      if (value.includes(`var(${token})`) || value.toLowerCase().includes(hex)) {
        offences.push(`global.css:${index + 1}  ${property}: ${value.trim()}`);
      }
    }
  });

  assert.deepEqual(
    offences,
    [],
    "These colours are fills. As a line they fail contrast on this palette's own " +
      'surfaces -- #c8e6c9 measures 1.34:1 on white. Use --accent (#2e7d32) for a ' +
      'line that must be seen, or --text/--text-muted for words. If a box genuinely ' +
      'wants the soft green, that is `background`, not `color` or `outline`.\n  ' +
      offences.join('\n  ')
  );
});

test('the focus indicator is the strong accent, and offset clear of the control', () => {
  // Pinning the fix from this sweep: the ring was --accent-soft at offset 0,
  // which is why the rule above exists at all.
  const css = stripComments(fs.readFileSync(cssPath, 'utf8'));
  const rule = css.match(/:focus-visible\s*\{([^}]*)\}/);

  assert.ok(rule, 'the console must define a :focus-visible indicator');
  assert.match(
    rule![1]!,
    /outline:\s*2px solid var\(--accent\)/,
    'the ring must use --accent (4.75:1 against the page), not a soft fill'
  );
  assert.match(
    rule![1]!,
    /outline-offset:\s*2px/,
    'without an offset the ring sits on the control border and is hard to read'
  );
});

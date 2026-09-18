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
 * file is the same rule for admin, which is hand-written CSS with its own hex
 * values and no link to that package.
 *
 * It exists because the rule was broken three times in one sweep:
 *
 *   - customer's focused tab icon was forced to #ffffff on #c8e6c9 -- 1.34:1,
 *     so tapping a tab made its icon disappear
 *   - admin's own focus ring drew #c8e6c9 at 1.34:1 against the field and
 *     1.25:1 against the page: an indicator present in the DOM and invisible
 *     on screen
 *   - the provisioning notice wrote in `var(--success)`, a fill token, from a
 *     `style` prop where no CSS rule and no linter was looking
 *
 * Three times is not carelessness, it is a rule nobody can see. So it goes in
 * a test rather than in someone's memory.
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

/**
 * The stylesheet is only half the surface. React can write a colour straight
 * into a `style` prop, where no CSS rule and no linter looks -- and that is
 * exactly where the last one was hiding.
 *
 * The plain role tokens are the fills; each has a counterpart for writing.
 * `--success` is the odd one out with no `--success-text`, because
 * `--accent-strong` is already that colour's dark sibling -- which the
 * stylesheet says in so many words.
 */
const WRITING_COUNTERPART: Record<string, string> = {
  '--success': '--accent-strong',
  '--danger': '--danger-text',
  '--warning': '--warning-text',
  '--info': '--info-text',
  '--accent-soft': '--accent-strong',
  '--brand-orange': '--warning-text',
};

test('no inline style writes text in a fill token', () => {
  const srcDir = path.join(import.meta.dirname, '..');
  const offences: string[] = [];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(next);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;

      const source = fs.readFileSync(next, 'utf8');
      source.split('\n').forEach((line, index) => {
        // `color:` only. A fill token under `background` is the correct use.
        const match = line.match(/\bcolor:\s*'var\((--[a-z-]+)\)'/);
        if (!match) return;

        const fix = WRITING_COUNTERPART[match[1]!];
        if (!fix) return;

        const where = path.relative(srcDir, next).split(path.sep).join('/');
        offences.push(`${where}:${index + 1}  color: var(${match[1]}) -> use var(${fix})`);
      });
    }
  };

  walk(srcDir);

  assert.deepEqual(
    offences,
    [],
    'These tokens fill; their counterparts write. The stylesheet states the rule ' +
      'and the CSS test above enforces it, but a `style` prop is not CSS and nothing ' +
      'was checking it.\n  ' +
      offences.join('\n  ')
  );
});

test('the focus indicator is the strong accent, and offset clear of the control', () => {
  // Pinning the fix from this sweep: the ring was --accent-soft at offset 0,
  // which is why the rules above exist at all.
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

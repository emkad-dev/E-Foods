/**
 * Run with: node --test --experimental-strip-types apps/admin-web/src/styles/targetSize.test.ts
 *
 * WCAG 2.5.8 Target Size (Minimum) for the admin console: 24x24 CSS px. This
 * is the desktop AA floor -- the mobile apps hold themselves to 44 and have
 * scripts/uiContract.test.ts to say so, but that scanner reads React Native
 * StyleSheet literals and cannot see a single declaration of admin's
 * hand-written CSS.
 *
 * WHY A TEST RATHER THAN A NOTE: a target-size defect is not a wrong value
 * anywhere in the source. Nobody wrote "13" -- 13x13 is what a browser gives
 * an unstyled checkbox, and 45x17 is what a 13px line of text measures. There
 * is nothing on the screen or in the diff for a reviewer to catch, which is
 * exactly the class of defect that comes back. The two rules pinned here are
 * the two that were measured under the floor in the running console at
 * 1440x900: the broadcast audience checkboxes, which decide who receives a
 * mass send, and the overview's drill-down links.
 *
 * The suite reads static declarations only. It cannot prove the rendered box:
 * for that, render the app and measure the DOM.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const MIN_TARGET_PX = 24;

const srcDir = path.join(import.meta.dirname, '..');
const cssPath = path.join(import.meta.dirname, 'global.css');

/** Blank comments in place, so prose is never read as a declaration. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));

const declarationsOf = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `global.css no longer has a \`${selector}\` rule; the target-size fix has been lost`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

const pxValue = (declarations: string, property: string): number => {
  const match = declarations.match(new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*(-?[\\d.]+)px`));
  assert.ok(match, `expected a px \`${property}\` declaration, got:${declarations}`);
  return Number(match![1]);
};

test('the broadcast audience checkboxes meet the 24px target floor', () => {
  // These five decide who receives a mass send. They were 13x13 (browser
  // default) inside a label giving a 54x19 effective hit area.
  const css = stripComments(fs.readFileSync(cssPath, 'utf8'));
  const box = declarationsOf(css, ".check-row input[type='checkbox']");

  assert.ok(pxValue(box, 'width') >= MIN_TARGET_PX, 'the checkbox itself must be at least 24px wide');
  assert.ok(pxValue(box, 'height') >= MIN_TARGET_PX, 'the checkbox itself must be at least 24px tall');

  // Growing the box inside a 13px line box crops it unless the label makes
  // room, so the two declarations only work together.
  const label = declarationsOf(css, '.check-row label');
  assert.ok(pxValue(label, 'min-height') >= MIN_TARGET_PX, 'the label must leave room for the taller control');
});

test('a card drill-down link meets the 24px target floor without moving the header', () => {
  const css = stripComments(fs.readFileSync(cssPath, 'utf8'));
  const link = declarationsOf(css, '.card-title-row .card-more-link');

  // min-height does nothing to an inline box; the link has to become a block
  // box first, and inline-flex is the one that keeps it beside the title.
  assert.match(link, /display:\s*inline-flex/, 'min-height is ignored on an inline element');
  assert.ok(pxValue(link, 'min-height') >= MIN_TARGET_PX, 'the link must be at least 24px tall');

  // The negative margin cancels the padding so the card header keeps its
  // original height. Losing it is how this fix silently restyles every card.
  const padding = link.match(/padding:\s*([\d.]+)px\s+([\d.]+)px/);
  const margin = link.match(/margin:\s*(-[\d.]+)px\s+(-[\d.]+)px/);
  assert.ok(padding && margin, 'the link needs both the padding that grows it and the margin that pays for it');
  assert.equal(Number(margin![1]), -Number(padding![1]), 'vertical margin must cancel vertical padding');
  assert.equal(Number(margin![2]), -Number(padding![2]), 'horizontal margin must cancel horizontal padding');
});

test('every card drill-down link opts into the rule', () => {
  // The CSS is keyed on a class, so a new card that writes the same markup
  // without it is back under the floor with nothing to see in review.
  const offences: string[] = [];

  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(next);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) {
        continue;
      }

      const lines = fs.readFileSync(next, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('more →')) {
          return;
        }
        const opening = lines.slice(Math.max(0, index - 4), index + 1).join('\n');
        if (opening.includes('card-more-link')) {
          return;
        }
        const where = path.relative(srcDir, next).split(path.sep).join('/');
        offences.push(`${where}:${index + 1}`);
      });
    }
  };

  walk(srcDir);

  assert.deepEqual(
    offences,
    [],
    'These drill-down links render as ~45x17 text, under the 24px target floor. ' +
      'Add `card-more-link` alongside the existing classes.\n  ' + offences.join('\n  ')
  );
});

/**
 * Run with: node --test --experimental-strip-types scripts/uiContract.test.ts
 *
 * Two rules about the rendered UI that nothing else in this repo enforces.
 *
 * WHY THIS EXISTS: every UI defect found in the 2026-09-18 sweep was invisible
 * in review. Not one of them is a wrong value -- each is a set of individually
 * reasonable values that compose into a wrong box. `paddingVertical: 10` around
 * a 13pt label is a 36pt button; nobody writing that line wrote "36". Thirty-
 * four controls across three apps were under the tap-target floor, and
 * twenty-one style keys had outlived the markup that used them. Typecheck,
 * lint and 548 unit tests all passed throughout.
 *
 * So these are the two questions a human reviewer cannot answer by reading,
 * asked mechanically on every run. The suite is deliberately narrow: it makes
 * claims about static style declarations only. It cannot see anything that
 * depends on layout (a padded wrapper around an unpadded control, an inline
 * Text that ignores minHeight) -- for those, render the app and measure the
 * DOM. See the project notes on the localStorage render fixture.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { MIN_TAP_TARGET } from '../packages/design-system/src/tokens/space.ts';

const APPS = ['apps/customer', 'apps/partner', 'apps/dispatch'];
const SKIP_DIRS = new Set(['node_modules', '.expo', 'dist', 'build', '.next']);

/** Opt out of the tap-target rule on one style, with the reason required. */
const ALLOW_SMALL = 'ui-contract: allow-small';

const repoRoot = path.resolve(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(next, out);
    else if (/\.tsx$/.test(entry.name)) out.push(next);
  }
  return out;
}

/**
 * Blank comments in place, keeping every offset and newline.
 *
 * Not cosmetic: the first version of this scanner parsed keys out of prose and
 * reported "17", "to" and "point" as dead styles, because a colon in a sentence
 * looks exactly like a colon in an object literal.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let state: 'code' | 'line' | 'block' = 'code';
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    const ch = source[i]!;
    if (state === 'code') {
      if (two === '//' || two === '/*') {
        state = two === '//' ? 'line' : 'block';
        out += '  ';
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
    } else if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      i += 1;
    } else if (two === '*/') {
      state = 'code';
      out += '  ';
      i += 2;
    } else {
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
    }
  }
  return out;
}

type StyleBlock = { name: string; body: string; raw: string };

function parseStyleSheet(stripped: string, raw: string) {
  const header = stripped.match(/const (\w+) = StyleSheet\.create\(\{/);
  if (!header) return null;
  const objectName = header[1]!;

  // A name-based reference check is only sound when the object is never used
  // as a whole. Spread it, index it, or pass it somewhere and a key can be
  // live with its name appearing nowhere.
  const dynamic =
    new RegExp(`\\.\\.\\.${objectName}\\b`).test(stripped) ||
    new RegExp(`${objectName}\\[`).test(stripped) ||
    new RegExp(`[({,=]\\s*${objectName}\\s*[),}]`).test(stripped);
  if (dynamic) return null;

  const body = stripped.slice(header.index! + header[0].length);
  const blocks: StyleBlock[] = [];
  let depth = 1;
  let i = 0;
  let atKey = true;
  while (i < body.length && depth > 0) {
    const ch = body[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 1 && atKey) {
      const km = body.slice(i).match(/^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/);
      if (km) {
        const start = i + km[0].length;
        let d = 1;
        let j = start;
        while (j < body.length && d > 0) {
          if (body[j] === '{') d++;
          else if (body[j] === '}') d--;
          j++;
        }
        const absStart = header.index! + header[0].length + start;
        blocks.push({
          name: km[1]!,
          body: body.slice(start, j - 1),
          raw: raw.slice(absStart, absStart + (j - 1 - start)),
        });
        i = j;
        atKey = false;
        continue;
      }
    }
    if (depth === 1 && ch === ',') atKey = true;
    i++;
  }
  return { objectName, blocks, stripped, raw };
}

test('no StyleSheet key survives the markup that used it', () => {
  const dead: string[] = [];

  for (const app of APPS) {
    for (const file of walk(app)) {
      const raw = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      const parsed = parseStyleSheet(stripComments(raw), raw);
      if (!parsed) continue;

      for (const block of parsed.blocks) {
        const used = new RegExp(`${parsed.objectName}\\.${block.name}\\b`).test(parsed.stripped);
        if (!used) dead.push(`${file.replace(/\\/g, '/')} -> ${block.name}`);
      }
    }
  }

  assert.deepEqual(
    dead,
    [],
    `Style keys nothing reads. Delete them with the markup that used them:\n  ${dead.join('\n  ')}`
  );
});

test(`no touchable style composes below the ${MIN_TAP_TARGET}pt floor`, () => {
  const small: string[] = [];

  for (const app of APPS) {
    for (const file of walk(app)) {
      const raw = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      const stripped = stripComments(raw);
      const parsed = parseStyleSheet(stripped, raw);
      if (!parsed) continue;

      // Only styles actually attached to something pressable.
      const touchable = new Set<string>();
      for (const m of stripped.matchAll(
        /<(?:TouchableOpacity|TouchableHighlight|Pressable|TouchableWithoutFeedback)\b[\s\S]{0,400}?>/g
      )) {
        for (const s of m[0].matchAll(new RegExp(`${parsed.objectName}\\.([A-Za-z0-9_]+)`, 'g'))) {
          touchable.add(s[1]!);
        }
      }

      for (const block of parsed.blocks) {
        if (!touchable.has(block.name)) continue;
        if (block.raw.includes(ALLOW_SMALL)) continue;

        const explicit = block.body.match(/\b(?:minHeight|height): (\d+)/);
        if (explicit) {
          if (Number(explicit[1]) < MIN_TAP_TARGET) {
            small.push(`${file.replace(/\\/g, '/')} -> ${block.name} (height ${explicit[1]})`);
          }
          continue;
        }
        // A token reference (minHeight: MIN_TAP_TARGET) clears the floor by
        // construction; only a literal can be too small.
        if (/\b(?:minHeight|height):/.test(block.body)) continue;

        const padMatch =
          block.body.match(/paddingVertical: (\d+)/) ?? block.body.match(/padding: (\d+)/);
        if (!padMatch) continue;
        const pad = Number(padMatch[1]);
        const borderMatch = block.body.match(/borderWidth: (\d+)/);
        const border = borderMatch ? Number(borderMatch[1]) : 0;

        // The label's line box. Prefer an explicit lineHeight on the sibling
        // text style; fall back to RN's default of roughly fontSize * 1.4.
        let line = Math.round(14 * 1.4);
        for (const other of parsed.blocks) {
          if (other.name === block.name) continue;
          if (!other.name.toLowerCase().startsWith(block.name.toLowerCase())) continue;
          const lh = other.body.match(/lineHeight: (\d+)/);
          const fs2 = other.body.match(/fontSize: (\d+)/);
          if (lh) {
            line = Number(lh[1]);
            break;
          }
          if (fs2) {
            line = Math.round(Number(fs2[1]) * 1.4);
            break;
          }
        }

        const total = pad * 2 + line + border * 2;
        if (total < MIN_TAP_TARGET) {
          small.push(
            `${file.replace(/\\/g, '/')} -> ${block.name} ` +
              `(2*${pad} + ${line}${border ? ` + 2*${border}` : ''} = ${total}pt)`
          );
        }
      }
    }
  }

  assert.deepEqual(
    small,
    [],
    'Touchables whose composed height is under the floor. Add `minHeight: MIN_TAP_TARGET` ' +
      '(plus `justifyContent: "center"`), or grow the box and pull it back with an equal ' +
      `negative margin where the control must keep its drawn size. If a control genuinely ` +
      `must stay small, write "${ALLOW_SMALL}" in its style block with the reason. ` +
      `Do NOT reach for hitSlop: on web, RNW 0.21 reads it only from the legacy Touchable ` +
      `mixin, so it does nothing.\n  ${small.join('\n  ')}`
  );
});

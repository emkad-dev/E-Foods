import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MIN_TAP_TARGET, space } from './space.ts';
import { radius } from './radius.ts';
import { typeScale, fontFamily, REQUIRED_FONT_KEYS } from './type.ts';

const noDuplicates = (values: readonly number[], label: string) => {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} contains duplicate values — each step must be distinct`,
  );
};

describe('spacing scale', () => {
  it('has no duplicate steps', () => {
    noDuplicates(Object.values(space), 'space');
  });

  it('is entirely 4pt-aligned above the hairline', () => {
    for (const [name, value] of Object.entries(space)) {
      if (name === 'hair') continue;
      assert.equal(value % 4, 0, `space.${name} = ${value} breaks the 4pt grid`);
    }
  });

  it('increases monotonically', () => {
    const values = Object.values(space);
    for (let i = 1; i < values.length; i += 1) {
      assert.ok(values[i] > values[i - 1], 'space steps must ascend in declaration order');
    }
  });

  it('keeps the tap target at the accessible floor', () => {
    assert.ok(MIN_TAP_TARGET >= 44);
  });
});

describe('radius scale', () => {
  it('has no duplicate steps', () => {
    noDuplicates(Object.values(radius), 'radius');
  });

  it('replaced the sprawl with a small scale plus a pill', () => {
    // Previously 13 distinct radii were in use across the customer app.
    assert.ok(Object.keys(radius).length <= 6);
    assert.equal(radius.pill, 999);
  });
});

describe('type scale', () => {
  it('collapsed 22 font sizes into 8 roles', () => {
    assert.equal(Object.keys(typeScale).length, 8);
  });

  it('has no duplicate size/family combinations', () => {
    const combos = Object.values(typeScale).map((r) => `${r.fontFamily}@${r.fontSize}`);
    assert.equal(new Set(combos).size, combos.length, 'two roles are visually identical');
  });

  it('never sets fontWeight alongside a per-weight fontFamily', () => {
    // Setting both makes Android synthesize or mis-pick a face.
    for (const [name, role] of Object.entries(typeScale)) {
      assert.equal(
        'fontWeight' in role,
        false,
        `typeScale.${name} must not declare fontWeight`,
      );
    }
  });

  it('restricts the 800 weight to display only', () => {
    for (const [name, role] of Object.entries(typeScale)) {
      if (name === 'display') continue;
      assert.notEqual(
        role.fontFamily,
        fontFamily.displayExtraBold,
        `typeScale.${name} must not use the 800 weight — it is reserved for display`,
      );
    }
  });

  it('keeps line height at a readable ratio for every role', () => {
    for (const [name, role] of Object.entries(typeScale)) {
      const ratio = role.lineHeight / role.fontSize;
      assert.ok(
        ratio >= 1.15 && ratio <= 1.55,
        `typeScale.${name} line-height ratio ${ratio.toFixed(2)} is outside 1.15–1.55`,
      );
    }
  });

  it('only references font faces the apps actually load', () => {
    const loaded = new Set<string>(REQUIRED_FONT_KEYS);
    for (const [name, role] of Object.entries(typeScale)) {
      assert.ok(
        loaded.has(role.fontFamily),
        `typeScale.${name} uses ${role.fontFamily}, which is not in REQUIRED_FONT_KEYS`,
      );
    }
  });
});

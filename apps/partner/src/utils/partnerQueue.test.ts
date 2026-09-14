/**
 * Run with: node --test --experimental-strip-types apps/partner/src/utils/partnerQueue.test.ts
 *
 * Guards the kitchen queue chip: `getKitchenSignalColors` returns the
 * `{ backgroundColor, textColor }` pair a chip renders with, and until this file
 * existed nothing asserted the two halves were legible against each other.
 *
 * The defect class: three of the five branches used to point `textColor` at the
 * saturated status colour and `backgroundColor` at a tint derived from that same
 * colour, so the label and its background moved together. Measured before the
 * fix — orange on `warningSoft` 2.13:1, brand green on `successSoft` 3.81:1, red
 * on `dangerSoft` 3.74:1 — on the three chips a kitchen is meant to read first.
 * Darkening the hue could never have fixed it: the tint darkens with it. The fix
 * was to keep the tint carrying the hue and give the label a plain legible
 * foreground (`warningText`, `dangerText`, `text`), which is the rule `Badge`
 * encodes. These assertions are what stop it silently reverting.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  AA_NORMAL,
  contrastRatio,
} from '../../../../packages/design-system/src/tokens/contrast.ts';
import type { OrderDocument } from '../domain/entities.ts';
import {
  LEGACY_ORDER_STATUS_MAP,
  ORDER_STATUSES,
} from '../../../../packages/domain/src/orders.ts';
import { getKitchenSignal, getKitchenSignalColors } from './partnerQueue.ts';

/**
 * Derived from the function's own signature rather than retyped, so renaming a
 * tone breaks this list at typecheck instead of silently dropping it from the
 * sweep below.
 */
type QueueTone = Parameters<typeof getKitchenSignalColors>[0];

const QUEUE_TONES: QueueTone[] = ['danger', 'warning', 'accent', 'success', 'muted'];

const orderWithStatus = (status: string) => ({ status }) as unknown as OrderDocument;

describe('kitchen queue signal colors', () => {
  it('every tone renders its label legibly on its own chip fill', () => {
    const failures: string[] = [];

    for (const tone of QUEUE_TONES) {
      const { backgroundColor, textColor } = getKitchenSignalColors(tone);
      const ratio = contrastRatio(textColor, backgroundColor);

      if (ratio < AA_NORMAL) {
        failures.push(`${tone}: ${textColor} on ${backgroundColor} = ${ratio.toFixed(2)}:1`);
      }
    }

    assert.deepEqual(
      failures,
      [],
      `A kitchen chip is unreadable. This happens when textColor is pointed back ` +
        `at the saturated status colour the fill is tinted from — the label and its ` +
        `background then move together and darkening the hue cannot open the gap. ` +
        `Use the accessible counterpart (warningText / dangerText / text) instead:\n` +
        `${failures.join('\n')}`,
    );
  });

  /**
   * The sweep above can only measure the tones it is handed. A new tone added to
   * `getKitchenSignalColors` would fall through to `default` here and never be
   * measured, so pin the mapping: every status an order can actually carry must
   * resolve to a tone this file already guards.
   */
  it('no order status can reach a tone outside the guarded set', () => {
    const statuses = [
      ...ORDER_STATUSES,
      ...Object.keys(LEGACY_ORDER_STATUS_MAP),
      'not_a_status',
    ];

    const unguarded = [
      ...new Set(
        statuses
          .map((status) => getKitchenSignal(orderWithStatus(status)).tone)
          .filter((tone) => !QUEUE_TONES.includes(tone)),
      ),
    ];

    assert.deepEqual(
      unguarded,
      [],
      `getKitchenSignal can return tone(s) ${unguarded.join(', ')} that the contrast ` +
        `sweep above never measures. Add them to QUEUE_TONES so the new chip is ` +
        `checked rather than assumed.`,
    );
  });
});

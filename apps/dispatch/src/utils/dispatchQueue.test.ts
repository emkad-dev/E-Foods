/**
 * Run with: node --test --experimental-strip-types apps/dispatch/src/utils/dispatchQueue.test.ts
 *
 * The dispatch half of the same guard as `apps/partner/src/utils/partnerQueue.test.ts`.
 *
 * `getDispatchSignalColors` returns the `{ backgroundColor, textColor }` pair a
 * queue chip renders with. Before the fix, three branches used the saturated
 * status colour as the *label* on a tint derived from that same colour: orange
 * on `warningSoft` measured 2.13:1 — the worst reading in either app, and it
 * carried "New order" and "Pickup risk", the two chips a dispatcher is supposed
 * to spot first — brand green on `successSoft` 3.81:1, and red on `dangerSoft`
 * 3.74:1. Because the fill is a wash of the label colour, darkening the hue
 * moves both and closes nothing; the fix was to give the label a plain legible
 * foreground and let the fill keep the hue.
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
import { getDispatchQueueSignal, getDispatchSignalColors } from './dispatchQueue.ts';

/** Derived from the signature so a renamed tone fails typecheck, not silently. */
type QueueSignalTone = Parameters<typeof getDispatchSignalColors>[0];

const QUEUE_TONES: QueueSignalTone[] = ['danger', 'warning', 'accent', 'success', 'muted'];

const orderWith = (status: string, courierId: string | null) =>
  ({
    status,
    assignment: courierId ? { courierId } : null,
  }) as unknown as OrderDocument;

describe('dispatch queue signal colors', () => {
  it('every tone renders its label legibly on its own chip fill', () => {
    const failures: string[] = [];

    for (const tone of QUEUE_TONES) {
      const { backgroundColor, textColor } = getDispatchSignalColors(tone);
      const ratio = contrastRatio(textColor, backgroundColor);

      if (ratio < AA_NORMAL) {
        failures.push(`${tone}: ${textColor} on ${backgroundColor} = ${ratio.toFixed(2)}:1`);
      }
    }

    assert.deepEqual(
      failures,
      [],
      `A dispatch chip is unreadable. This happens when textColor is pointed back ` +
        `at the saturated status colour the fill is tinted from — the label and its ` +
        `background then move together and darkening the hue cannot open the gap. ` +
        `Use the accessible counterpart (warningText / dangerText / text) instead:\n` +
        `${failures.join('\n')}`,
    );
  });

  /**
   * `getDispatchQueueSignal` branches on courier assignment as well as status,
   * so both are swept. A tone reachable by a real order but absent from
   * QUEUE_TONES would never be measured above.
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
          .flatMap((status) => [orderWith(status, null), orderWith(status, 'courier-1')])
          .map((order) => getDispatchQueueSignal(order).tone)
          .filter((tone) => !QUEUE_TONES.includes(tone)),
      ),
    ];

    assert.deepEqual(
      unguarded,
      [],
      `getDispatchQueueSignal can return tone(s) ${unguarded.join(', ')} that the ` +
        `contrast sweep above never measures. Add them to QUEUE_TONES so the new ` +
        `chip is checked rather than assumed.`,
    );
  });
});

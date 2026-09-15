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
import type { OrderDocument, OrderItemDocument } from '../domain/entities.ts';
import {
  LEGACY_ORDER_STATUS_MAP,
  ORDER_STATUSES,
  isTerminalOrderStatus,
} from '../../../../packages/domain/src/orders.ts';
import {
  KITCHEN_LANES,
  type KitchenLane,
  countModifiedOrderItems,
  formatOrderItemOptions,
  getKitchenLane,
  getKitchenSignal,
  getKitchenSignalColors,
  isUnrenderableLiveStatus,
  sortLiveKitchenOrders,
} from './partnerQueue.ts';

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

/**
 * THE VANISH GUARD.
 *
 * The kitchen board used to decide a ticket's column with an if/else chain over
 * five statuses while `usePartnerOrders` fed it every non-terminal order. Three
 * statuses — `escalated`, `picked_up`, `on_the_way` — matched no branch and were
 * rendered nowhere at all: not in a column, not in a count, not in a warning.
 * An order the kitchen was still responsible for simply left the screen.
 *
 * `getKitchenLane` replaces that chain with an exhaustive `Record<OrderStatus,
 * ...>`, so a status added to `ORDER_STATUSES` breaks the build until somebody
 * places it. These assertions cover what the type cannot: that `null` (no lane)
 * never lines up with a live order, and that a status string this build has
 * never heard of still lands somewhere visible.
 */
describe('kitchen lane routing', () => {
  it('every non-terminal status has a lane, and every terminal status has none', () => {
    const misrouted = [...ORDER_STATUSES, ...Object.keys(LEGACY_ORDER_STATUS_MAP)].filter(
      (status) => isTerminalOrderStatus(status) === (getKitchenLane(status) !== null),
    );

    assert.deepEqual(
      misrouted,
      [],
      `Status(es) ${misrouted.join(', ')} disagree with isTerminalOrderStatus. A live order ` +
        `mapped to null is handed to the kitchen board and rendered NOWHERE — the exact ` +
        `defect that hid escalated/picked_up/on_the_way. Give it a lane in ` +
        `KITCHEN_LANE_BY_STATUS, or make it terminal.`,
    );
  });

  it('no live status is unrenderable', () => {
    const unrenderable = [...ORDER_STATUSES, ...Object.keys(LEGACY_ORDER_STATUS_MAP), 'not_a_status'].filter(
      (status) => isUnrenderableLiveStatus(status),
    );

    assert.deepEqual(unrenderable, [], `Live status(es) with no lane: ${unrenderable.join(', ')}.`);
  });

  it('a status from a newer server than this build surfaces instead of disappearing', () => {
    // normalizeOrderStatus funnels anything unrecognised to 'draft', which is
    // non-terminal — so without a lane for 'draft' the next status the server
    // invents would vanish the same way the last three did.
    assert.equal(getKitchenLane('a_status_invented_after_this_build'), 'attention');
    assert.equal(getKitchenLane(undefined), 'attention');
  });

  it('every lane a status can reach is one the board renders', () => {
    const lanes = [...ORDER_STATUSES, 'not_a_status']
      .map((status) => getKitchenLane(status))
      .filter((lane): lane is KitchenLane => lane !== null);

    const unknown = [...new Set(lanes.filter((lane) => !KITCHEN_LANES.includes(lane)))];

    assert.deepEqual(
      unknown,
      [],
      `Lane(s) ${unknown.join(', ')} are not in KITCHEN_LANES, so the board never renders them.`,
    );
  });
});

/**
 * `escalated` used to share the catch-all priority with unknown statuses, so the
 * one ticket a human had already pulled out of the flow sorted BELOW routine
 * ones. The server has the same defect in `getPartnerKitchenPriority` and the
 * client consumed its order verbatim; this sort is the client-side correction.
 */
describe('live kitchen ordering', () => {
  const orderAt = (status: string, createdAt: string, id: string) =>
    ({ id, status, createdAt }) as unknown as OrderDocument;

  it('an escalated order sorts above every routine one, however old they are', () => {
    const sorted = sortLiveKitchenOrders([
      orderAt('placed', '2026-09-15T10:00:00.000Z', 'old-placed'),
      orderAt('preparing', '2026-09-15T09:00:00.000Z', 'older-preparing'),
      orderAt('escalated', '2026-09-15T11:00:00.000Z', 'new-escalated'),
    ]);

    assert.equal(sorted[0]?.id, 'new-escalated');
  });

  it('the oldest placed ticket leads its group, which is the acceptance-overdue one', () => {
    // The acceptance sweep leaves an overdue order 'placed' and only raises
    // needsAttention, so it needs no priority rule of its own — being the oldest
    // 'placed' ticket already floats it to the top of the New lane.
    const sorted = sortLiveKitchenOrders([
      orderAt('placed', '2026-09-15T10:30:00.000Z', 'recent'),
      orderAt('placed', '2026-09-15T10:00:00.000Z', 'overdue'),
    ]);

    assert.deepEqual(
      sorted.map((order) => order.id),
      ['overdue', 'recent'],
    );
  });

  it('a scheduled order sits below live work rather than level with unknown statuses', () => {
    const sorted = sortLiveKitchenOrders([
      orderAt('scheduled', '2026-09-15T08:00:00.000Z', 'scheduled'),
      orderAt('on_the_way', '2026-09-15T11:00:00.000Z', 'on-the-way'),
      orderAt('placed', '2026-09-15T10:00:00.000Z', 'placed'),
    ]);

    assert.deepEqual(
      sorted.map((order) => order.id),
      ['placed', 'on-the-way', 'scheduled'],
    );
  });

  it('reorders without adding or dropping anything', () => {
    const input = [
      orderAt('escalated', '2026-09-15T11:00:00.000Z', 'a'),
      orderAt('placed', '2026-09-15T10:00:00.000Z', 'b'),
      orderAt('ready_for_pickup', '2026-09-15T09:00:00.000Z', 'c'),
    ];
    const sorted = sortLiveKitchenOrders(input);

    assert.equal(sorted.length, input.length);
    assert.deepEqual(
      sorted.map((order) => order.id).sort(),
      ['a', 'b', 'c'],
    );
    // Pure: the caller's array is untouched, so applying this on top of the
    // server's ordering cannot corrupt the list it was handed.
    assert.equal(input[0]?.id, 'a');
  });
});

/**
 * `selectedOptions` is the only per-item customer instruction that reaches this
 * app, and nothing in apps/partner rendered it — an order placed with modifiers
 * looked identical to one placed plain.
 */
describe('order item options', () => {
  const itemWith = (selectedOptions: unknown) =>
    ({ id: 'i1', name: 'Jollof', selectedOptions }) as unknown as OrderItemDocument;

  it('returns null when there is nothing to say, so callers can omit the line', () => {
    assert.equal(formatOrderItemOptions(itemWith([])), null);
    assert.equal(formatOrderItemOptions(itemWith(null)), null);
    assert.equal(formatOrderItemOptions(itemWith(undefined)), null);
    // Not an array on the wire: still null, never a crash on a kitchen screen.
    assert.equal(formatOrderItemOptions(itemWith('protein: beef')), null);
  });

  it('groups and joins the labels the customer chose', () => {
    assert.equal(
      formatOrderItemOptions(
        itemWith([
          { groupId: 'g1', groupLabel: 'Protein', optionId: 'o1', optionLabel: 'Beef' },
          { groupId: 'g2', groupLabel: 'Extras', optionId: 'o2', optionLabel: 'No onions' },
        ]),
      ),
      'Protein: Beef · Extras: No onions',
    );
  });

  it('falls back to the option id rather than dropping a modifier', () => {
    // Labels are a snapshot taken at order time and can be missing on older
    // rows. A raw id in the kitchen is recoverable; a silently dropped "no
    // onions" is not.
    assert.equal(formatOrderItemOptions(itemWith([{ groupId: 'g1', optionId: 'no_onions' }])), 'no_onions');
  });

  it('counts only the lines that actually carry options', () => {
    const order = {
      items: [
        itemWith([{ groupId: 'g1', optionId: 'o1', optionLabel: 'Beef' }]),
        itemWith([]),
        itemWith([{ groupId: 'g2', optionId: 'o2', optionLabel: 'Extra pepper' }]),
      ],
    } as unknown as OrderDocument;

    assert.equal(countModifiedOrderItems(order), 2);
    assert.equal(countModifiedOrderItems({} as OrderDocument), 0);
  });
});

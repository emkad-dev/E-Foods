import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { resolveDeliveryFeeAmount, resolveSelectedCategory } from './restaurantMenuView.ts';

const menu = (...names: string[]) => names.map((category) => ({ category }));

describe('resolveSelectedCategory', () => {
  it('keeps a selection that still exists in the refreshed menu', () => {
    assert.equal(resolveSelectedCategory('Drinks', menu('Mains', 'Drinks'), null), 'Drinks');
  });

  it('drops a selection the partner renamed or emptied out from under the customer', () => {
    // The defect this exists for: the old `current ?? …` kept "Sides" forever,
    // the menu filtered to nothing, and the screen claimed "Menu coming soon".
    assert.equal(resolveSelectedCategory('Sides', menu('Mains', 'Drinks'), null), 'Mains');
  });

  it('opens the searched-for category on first load', () => {
    assert.equal(resolveSelectedCategory(null, menu('Mains', 'Drinks'), 'Drinks'), 'Drinks');
  });

  it('ignores a highlight whose category is no longer on the menu', () => {
    assert.equal(resolveSelectedCategory(null, menu('Mains'), 'Grill'), 'Mains');
  });

  it('does not let a stale highlight override a live selection', () => {
    assert.equal(resolveSelectedCategory('Drinks', menu('Mains', 'Drinks'), 'Mains'), 'Drinks');
  });

  it('returns null for an empty menu so the empty state is the honest answer', () => {
    assert.equal(resolveSelectedCategory('Mains', menu(), null), null);
    assert.equal(resolveSelectedCategory(null, menu(), 'Mains'), null);
  });
});

describe('resolveDeliveryFeeAmount', () => {
  it('treats a free delivery as a real fee, not as "Pending"', () => {
    // The defect this exists for: `deliveryFee ? … : 'Pending'` printed
    // "Delivery Pending" for ₦0 while the cart charged ₦0.
    assert.equal(resolveDeliveryFeeAmount(0), 0);
  });

  it('passes through a normal fee', () => {
    assert.equal(resolveDeliveryFeeAmount(750), 750);
    assert.equal(resolveDeliveryFeeAmount(1200.5), 1200.5);
  });

  it('parses the numeric strings the read model can return', () => {
    assert.equal(resolveDeliveryFeeAmount('0'), 0);
    assert.equal(resolveDeliveryFeeAmount(' 750 '), 750);
  });

  it('reports an unset or unusable fee as null', () => {
    assert.equal(resolveDeliveryFeeAmount(null), null);
    assert.equal(resolveDeliveryFeeAmount(undefined), null);
    assert.equal(resolveDeliveryFeeAmount(''), null);
    assert.equal(resolveDeliveryFeeAmount('   '), null);
    assert.equal(resolveDeliveryFeeAmount('free'), null);
    assert.equal(resolveDeliveryFeeAmount(Number.NaN), null);
    assert.equal(resolveDeliveryFeeAmount({}), null);
  });
});

/**
 * Pure view logic for the restaurant detail screen, split out so it can be
 * tested under `node --test` without Metro.
 */

export type MenuCategoryLike = { category: string };

/**
 * Picks which menu category the chips should have selected after a menu load.
 *
 * The screen refetches on every realtime restaurant change, and the previous
 * implementation was `current ?? highlighted ?? fallback` — it only ever filled
 * an empty selection and never re-validated one it already had. So when a
 * partner renamed a category, emptied it, or marked its last item unavailable
 * while a customer was standing on the page, the refetch left `selectedCategory`
 * pointing at a category that no longer existed. The screen filters the menu
 * down to that name, gets nothing, and renders "Menu coming soon" on a
 * restaurant that plainly has a menu.
 *
 * Re-validating is safe for the normal case: a selection that still exists is
 * kept, so a customer browsing "Drinks" is not yanked back to the first
 * category every time an unrelated field on the restaurant changes.
 */
export function resolveSelectedCategory(
  current: string | null,
  categories: readonly MenuCategoryLike[],
  highlightedCategory: string | null
): string | null {
  if (current !== null && categories.some((entry) => entry.category === current)) {
    return current;
  }

  if (highlightedCategory !== null && categories.some((entry) => entry.category === highlightedCategory)) {
    return highlightedCategory;
  }

  return categories.length > 0 ? categories[0].category : null;
}

/**
 * Normalises a restaurant's delivery fee to a number, or `null` when the
 * restaurant genuinely has not set one.
 *
 * The screen used to render `restaurant.deliveryFee ? formatMoney(...) :
 * 'Pending'` — a truthiness test on a number, so a restaurant offering FREE
 * delivery (₦0) advertised "Delivery Pending" while the cart and the server
 * both charged ₦0. The read model can also hand the field back as a numeric
 * string, which is why this parses rather than just type-checking.
 */
export function resolveDeliveryFeeAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

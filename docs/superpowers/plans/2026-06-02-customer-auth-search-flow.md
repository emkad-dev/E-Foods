# Customer Auth And Category Search Implementation Plan

> For agentic workers: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. Track progress with checkbox syntax.

## Goal

Let customers browse without repeated login prompts, gate only checkout, and make restaurant search match food category labels as well as names.

## Architecture

Relax the customer app shell so anonymous users can reach browseable routes while authenticated users still restore their session from local storage and Supabase persistence. Keep checkout as the only hard auth gate. Extend restaurant query matching to include cuisine, menu category names, and item category labels so category-based search works consistently.

## Tech Stack

Expo Router, React Native, Supabase Auth, AsyncStorage, TypeScript.

## Task 1: Relax customer app shell auth routing

Files:

- `apps/customer/app/_layout.tsx`

- [ ] Update the route guard to stop forcing guests into login on app open.

```tsx
if (!user) {
  return;
}
```

- [ ] Keep the existing verified-email, policy, and customer-only route handling for signed-in users.

```tsx
if (!user.emailVerified && currentScreen !== 'verify-email') {
  router.replace('/(auth)/verify-email');
  return;
}
```

- [ ] Run customer checks.

```bash
cmd /c npm run lint:customer
cmd /c npx tsc --noEmit -p apps/customer/tsconfig.json
```

## Task 2: Expand customer category-aware search

Files:

- `apps/customer/src/utils/restaurantAvailability.ts`
- `apps/customer/app/(customer)/home/index.tsx`

- [ ] Extend restaurant query matching to cover menu category labels and item labels.

```ts
export const matchesRestaurantQuery = (restaurant: DiscoveryRestaurant, query: string) => {
  const normalizedQuery = normalizeRestaurantQuery(query);

  if (!normalizedQuery) {
    return true;
  }

  const haystacks = [
    restaurant.name,
    restaurant.cuisine ?? "",
    ...(restaurant.menu ?? []).map((category) => category.category ?? ""),
    ...(restaurant.menu ?? []).flatMap((category) =>
      (category.items ?? []).flatMap((item) => [item.name ?? "", item.categoryLabel ?? "", item.categoryId ?? ""])
    ),
  ];

  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
};
```

- [ ] Keep the home category rail and search box using the new matcher.

```tsx
const discoveryResults = useMemo(() => {
  return restaurants
    .filter((restaurant) => matchesRestaurantQuery(restaurant, search))
    .filter((restaurant) => matchesCategory(restaurant, selectedCategory))
    .map((restaurant) => ({
      restaurant,
      availability: getRestaurantAvailability(restaurant, deliveryLocation),
    }));
}, [deliveryLocation, restaurants, search, selectedCategory]);
```

- [ ] Run customer checks.

```bash
cmd /c npm run lint:customer
cmd /c npx tsc --noEmit -p apps/customer/tsconfig.json
```

## Task 3: Keep checkout gated but preserve session persistence

Files:

- `apps/customer/src/contexts/AuthContext.tsx`
- `apps/customer/src/services/session.ts`
- `apps/customer/app/(customer)/cart.tsx`

- [ ] Verify session persistence remains local and automatic.

```ts
const getStoredUserProfile = async <T>() => {
  const serializedUserProfile = await AsyncStorage.getItem(USER_STORAGE_KEY);
  if (!serializedUserProfile) {
    return null;
  }
  return JSON.parse(serializedUserProfile) as T;
};
```

- [ ] Keep the cart auth prompt only at order placement.

```ts
if (!user) {
  promptForAuth({
    title: "Sign in to place your order",
    message: "You can browse freely, but checkout starts after you sign in or create an account.",
  });
  return;
}
```

- [ ] Run customer checks.

```bash
cmd /c npm run lint:customer
cmd /c npx tsc --noEmit -p apps/customer/tsconfig.json
```

# Promo Landing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give promos a real destination — a live Deals hub listing active promos, each opening a rich per-promo detail page — replacing the static `/deals` placeholder.

**Architecture:** Add four nullable rich-content columns to the existing `"Promo"` table. Admin uploads a hero image client-side to a new admin-restricted `promo-assets` Storage bucket (mirroring `restaurantAssetUpload`) and fills detail/terms/CTA fields. The customer reads `Promo` directly via anon RLS (Phase 1 pattern) for both the hub (`/deals`) and detail (`/promo/[id]`). The banner smart-routes: rich promos → detail page, lean promos → straight to `actionUrl` (Phase 1 behavior).

**Tech Stack:** Supabase (Postgres + Storage + Deno app-rpc), Prisma schema (mirror), Expo/React Native (customer), React + Vite (admin), `deno test` for the one pure helper.

## Global Constraints

- Scope is sub-project ② only (richer landing pages). No discount-code redemption, no image gallery/badges, no admin CDN plumbing. From spec.
- All four new `Promo` columns are **nullable/additive** — existing promos and the Phase 1 banner must be unaffected. Verbatim from spec.
- Promo images are **served directly from the Supabase Storage public URL** (CDN rewrite deferred — a documented future optimization, not built here). Plan decision (customer/admin apps have no CDN base env; a few promo images don't warrant the plumbing).
- CTA reuses `actionUrl` with the existing in-app-path / open-redirect guard (`actionUrl` must start with `/`). Verbatim from spec + Phase 1 `validatePromoComposition`.
- Smart banner re-route: open `/promo/[id]` iff the promo has `imageUrl` OR `detailBody` OR `terms`; otherwise navigate straight to `actionUrl`. Verbatim from spec.
- Analytics reuse ① with **no new event types**: `trackPromoClick(promoId)` fires on banner "View deal" and on a Deals-hub card tap. Verbatim from spec.
- `promo-assets` bucket: **admin-insert only** (policy checks `UserRole.role = 'admin'`), public read. From spec.
- Follow existing conventions: PascalCase quoted table names, app-rpc `if (action === '…')` handlers with `ensureRole`/`sanitizeText`/`fail`/`json`, admin CSS classes (`card`/`field`/`btn`), `customerTheme` palette.
- Branch: `feature/promo-landing-pages` (already cut from `main`). Commit frequently.

---

## File Structure

**Database**
- `supabase/migrations/20260716_promo_landing.sql` (create) — 4 nullable columns on `"Promo"`; `promo-assets` bucket + storage policies.
- `functions/prisma/schema.prisma` (modify) — mirror the 4 columns on the `Promo` model.

**Edge (Deno)**
- `supabase/functions/app-rpc/index.ts` (modify) — extend `PromoRow`, `validatePromoComposition`, and `promoCreate` with the 4 fields (`promoList` already `select('*')`, so it returns them once the columns exist).

**Admin app**
- `apps/admin-web/src/services/promos.ts` (modify) — extend `Promo` type + `createPromo` input with the 4 fields.
- `apps/admin-web/src/services/promoAssetUpload.ts` (create) — client-side upload to `promo-assets`, returns the public URL.
- `apps/admin-web/src/pages/PromosPage.tsx` (modify) — new form fields + image upload with preview.

**Customer app**
- `apps/customer/src/domain/promoContent.ts` (create) — pure `promoHasRichContent(promo)` helper.
- `apps/customer/src/domain/promoContent.test.ts` (create) — `deno test` for the helper.
- `apps/customer/app/(customer)/deals.tsx` (replace) — live Deals hub.
- `apps/customer/app/(customer)/promo/[id].tsx` (create) — detail page.
- `apps/customer/app/(customer)/_layout.tsx` (modify) — register `promo/[id]` as a hidden tab screen with a back button.
- `apps/customer/src/components/PromoBanner.tsx` (modify) — select rich fields + smart re-route.

---

## Task 1: Database — rich columns + promo-assets bucket

**Files:**
- Create: `supabase/migrations/20260716_promo_landing.sql`
- Modify: `functions/prisma/schema.prisma` (`Promo` model)

**Interfaces:**
- Produces: columns `Promo."imageUrl"|"detailBody"|"terms"|"ctaLabel"` (all `text` null); Storage bucket `promo-assets` (public) with admin-insert policy.

- [ ] **Step 1: Write the migration**

```sql
-- Promo landing pages (Phase 2 ②): rich content fields + hero-image bucket.

-- Additive rich-content columns. All nullable — existing promos and the Phase 1
-- banner are unaffected; the public-read RLS policy already covers new columns.
alter table public."Promo" add column if not exists "imageUrl"   text;
alter table public."Promo" add column if not exists "detailBody" text;
alter table public."Promo" add column if not exists "terms"      text;
alter table public."Promo" add column if not exists "ctaLabel"   text;

-- Public bucket for promo hero images. Public read (served directly);
-- inserts restricted to admins via the storage.objects policy below.
insert into storage.buckets (id, name, public)
values ('promo-assets', 'promo-assets', true)
on conflict (id) do nothing;

drop policy if exists "Admins upload promo assets" on storage.objects;
create policy "Admins upload promo assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'promo-assets'
    and exists (
      select 1 from public."UserRole" ur
      where ur."userId" = auth.uid()::text and ur."role" = 'admin'
    )
  );

drop policy if exists "Admins update promo assets" on storage.objects;
create policy "Admins update promo assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'promo-assets'
    and exists (
      select 1 from public."UserRole" ur
      where ur."userId" = auth.uid()::text and ur."role" = 'admin'
    )
  );
```

> Note for implementer: confirm `UserRole` column names/types with `\d public."UserRole"` (or the Prisma schema). The app-rpc bootstrap uses `.from('UserRole').eq('role','admin')` with a `userId` column, so `("userId" text, "role" text)` is expected; `auth.uid()` is a uuid, hence the `::text` cast. If `userId` is already uuid, drop the cast.

- [ ] **Step 2: Mirror columns in Prisma**

In `functions/prisma/schema.prisma`, inside `model Promo`, add after the existing `actionUrl` field:

```prisma
  imageUrl   String?
  detailBody String?
  terms      String?
  ctaLabel   String?
```

- [ ] **Step 3: Validate SQL (syntax only, optional)**

Run: `npx supabase db lint --file supabase/migrations/20260716_promo_landing.sql` (if unavailable, skip — applied against the remote in the deploy step).
Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716_promo_landing.sql functions/prisma/schema.prisma
git commit -m "feat(promos): rich-content columns + promo-assets bucket"
```

---

## Task 2: Edge — carry rich fields through app-rpc

**Files:**
- Modify: `supabase/functions/app-rpc/index.ts` (`PromoRow` type, `validatePromoComposition`, `promoCreate`)

**Interfaces:**
- Consumes: `sanitizeText`, `fail`, `ensureRole`, `json`, `serviceClient`, `broadcastPromosChanged` (all present).
- Produces: `promoCreate` accepts `imageUrl`/`detailBody`/`terms`/`ctaLabel`; `PromoRow` carries them; `promoList` returns them (already `select('*')`).

- [ ] **Step 1: Extend the `PromoRow` type**

Find `type PromoRow = {` and add these fields before the closing `};` (after `actionUrl: string | null;`):

```ts
  imageUrl: string | null;
  detailBody: string | null;
  terms: string | null;
  ctaLabel: string | null;
```

- [ ] **Step 2: Extend `validatePromoComposition`**

Change the function's input type and body. Replace the signature block:

```ts
const validatePromoComposition = (input: {
  actionUrl: unknown;
  startsAt: unknown;
  endsAt: unknown;
}) => {
```

with:

```ts
const validatePromoComposition = (input: {
  actionUrl: unknown;
  startsAt: unknown;
  endsAt: unknown;
  imageUrl: unknown;
  detailBody: unknown;
  terms: unknown;
  ctaLabel: unknown;
}) => {
```

Then, immediately before the final `return { actionUrl, startsAt, endsAt };`, add:

```ts
  const imageUrlRaw = sanitizeText(input.imageUrl);
  // Hero image, if present, must be a Supabase Storage public URL (same host we
  // upload to) — never an arbitrary external URL shown to every customer.
  if (imageUrlRaw && !imageUrlRaw.includes('/storage/v1/object/public/promo-assets/')) {
    fail(400, 'imageUrl must be an uploaded promo asset.');
  }
  const imageUrl = imageUrlRaw || null;
  const detailBody = sanitizeText(input.detailBody) || null;
  const terms = sanitizeText(input.terms) || null;
  const ctaLabel = sanitizeText(input.ctaLabel) || null;
```

and change the return to:

```ts
  return { actionUrl, startsAt, endsAt, imageUrl, detailBody, terms, ctaLabel };
```

- [ ] **Step 3: Thread the fields through `promoCreate`**

In the `promoCreate` handler, change the destructure + validate call:

```ts
    const { actionUrl, startsAt, endsAt, imageUrl, detailBody, terms, ctaLabel } =
      validatePromoComposition({
        actionUrl: data.actionUrl,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        imageUrl: data.imageUrl,
        detailBody: data.detailBody,
        terms: data.terms,
        ctaLabel: data.ctaLabel,
      });
```

and add the four fields to the `.insert({...})` object (after `actionUrl,`):

```ts
        imageUrl,
        detailBody,
        terms,
        ctaLabel,
```

- [ ] **Step 4: Type-check the edge function (parity gate)**

Run (bash): `export PATH="/c/Users/emkad/AppData/Local/Microsoft/WinGet/Links:$PATH" && deno check supabase/functions/app-rpc/index.ts`
Expected: the pre-existing baseline error count (210) is unchanged, and none of the errors reference your added lines. Capture the count before and after.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/app-rpc/index.ts
git commit -m "feat(promos): carry rich promo fields through promoCreate/promoList"
```

---

## Task 3: Admin — service types + text form fields

**Files:**
- Modify: `apps/admin-web/src/services/promos.ts`
- Modify: `apps/admin-web/src/pages/PromosPage.tsx`

**Interfaces:**
- Produces: `Promo` type + `createPromo` input carry `imageUrl`/`detailBody`/`terms`/`ctaLabel`.

- [ ] **Step 1: Extend the `Promo` interface**

In `promos.ts`, add to the `Promo` interface (after `actionUrl: string | null;`):

```ts
  imageUrl: string | null;
  detailBody: string | null;
  terms: string | null;
  ctaLabel: string | null;
```

- [ ] **Step 2: Extend the `createPromo` input**

Change `createPromo`'s parameter type to:

```ts
export const createPromo = (input: {
  title: string;
  body: string;
  actionUrl?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  imageUrl?: string | null;
  detailBody?: string | null;
  terms?: string | null;
  ctaLabel?: string | null;
}) => callAdminRpc<{ promo: Promo }>('promoCreate', input);
```

- [ ] **Step 3: Add form state + inputs in PromosPage**

Add state (after `const [endsAt, setEndsAt] = useState('');`):

```tsx
  const [detailBody, setDetailBody] = useState('');
  const [terms, setTerms] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [imageUrl, setImageUrl] = useState('');
```

In `onCreate`, extend the `createPromo({...})` call with:

```tsx
        detailBody: detailBody.trim() || null,
        terms: terms.trim() || null,
        ctaLabel: ctaLabel.trim() || null,
        imageUrl: imageUrl.trim() || null,
```

and add resets in the success block (next to `setActionUrl('')`):

```tsx
      setDetailBody('');
      setTerms('');
      setCtaLabel('');
      setImageUrl('');
```

Add form fields after the "Deep link" field (before the "Starts" field):

```tsx
        <div className="field">
          <label htmlFor="promo-detail">Detail description (optional)</label>
          <textarea
            id="promo-detail"
            rows={4}
            value={detailBody}
            onChange={(event) => setDetailBody(event.target.value)}
            placeholder="Full explanation shown on the promo's landing page."
          />
        </div>
        <div className="field">
          <label htmlFor="promo-terms">Terms / fine print (optional)</label>
          <textarea
            id="promo-terms"
            rows={2}
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            placeholder="Valid 12–2pm · selected restaurants · min order ₦2000"
          />
        </div>
        <div className="field">
          <label htmlFor="promo-cta">CTA label (optional)</label>
          <input
            id="promo-cta"
            value={ctaLabel}
            onChange={(event) => setCtaLabel(event.target.value)}
            placeholder="Order now"
          />
        </div>
```

- [ ] **Step 4: Type-check the admin app**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/services/promos.ts apps/admin-web/src/pages/PromosPage.tsx
git commit -m "feat(promos): admin detail/terms/CTA fields"
```

---

## Task 4: Admin — hero-image upload

**Files:**
- Create: `apps/admin-web/src/services/promoAssetUpload.ts`
- Modify: `apps/admin-web/src/pages/PromosPage.tsx`

**Interfaces:**
- Consumes: the admin `supabase` client (`apps/admin-web/src/services/supabase` — the one `callAdminRpc` uses; confirm the exact import path).
- Produces: `uploadPromoAsset(file: File): Promise<string>` returning the public URL.

- [ ] **Step 1: Write the upload service**

```ts
// apps/admin-web/src/services/promoAssetUpload.ts
import { supabase } from './supabase';

const PROMO_ASSETS_BUCKET = 'promo-assets';

const extensionFor = (type: string): string => {
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
};

export const uploadPromoAsset = async (file: File): Promise<string> => {
  const extension = extensionFor(file.type);
  const filePath = `promos/${Date.now()}.${extension}`;

  const { error } = await supabase.storage
    .from(PROMO_ASSETS_BUCKET)
    .upload(filePath, file, { contentType: file.type || 'image/jpeg', upsert: true });

  if (error) {
    console.warn('Promo asset upload failed:', error.message);
    throw new Error('Unable to upload this image right now. Please try again.');
  }

  const { data } = supabase.storage.from(PROMO_ASSETS_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
};
```

> If the admin `supabase` client is not at `./supabase`, find it (`grep -rn "createClient\|getSharedSupabaseClient" apps/admin-web/src`) and import from there.

- [ ] **Step 2: Wire the file input into PromosPage**

Add an `uploading` state (next to `busy`):

```tsx
  const [uploading, setUploading] = useState(false);
```

Import the service at the top:

```tsx
import { uploadPromoAsset } from '../services/promoAssetUpload';
```

Add an upload handler (near `onCreate`):

```tsx
  const onPickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const url = await uploadPromoAsset(file);
      setImageUrl(url);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };
```

Add the image field after the CTA-label field:

```tsx
        <div className="field">
          <label htmlFor="promo-image">Hero image (optional)</label>
          <input id="promo-image" type="file" accept="image/*" onChange={(event) => void onPickImage(event)} />
          {uploading ? <span className="muted">Uploading…</span> : null}
          {imageUrl ? (
            <img src={imageUrl} alt="Promo hero preview" style={{ marginTop: 8, maxWidth: 240, borderRadius: 8 }} />
          ) : null}
        </div>
```

Include `uploading` in the submit guard:

```tsx
  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !busy && !uploading;
```

- [ ] **Step 3: Type-check the admin app**

Run: `cd apps/admin-web && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-web/src/services/promoAssetUpload.ts apps/admin-web/src/pages/PromosPage.tsx
git commit -m "feat(promos): admin hero-image upload to promo-assets"
```

---

## Task 5: Customer — rich-content helper (pure, tested)

**Files:**
- Create: `apps/customer/src/domain/promoContent.ts`
- Create: `apps/customer/src/domain/promoContent.test.ts`

**Interfaces:**
- Produces: `promoHasRichContent(promo: { imageUrl?: string | null; detailBody?: string | null; terms?: string | null }): boolean` and the shared `PromoContent` type used by the hub/detail/banner.

- [ ] **Step 1: Write the failing test**

```ts
// apps/customer/src/domain/promoContent.test.ts
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { promoHasRichContent } from './promoContent.ts';

Deno.test('rich when an image is present', () => {
  assertEquals(promoHasRichContent({ imageUrl: 'https://x/storage/v1/object/public/promo-assets/a.jpg' }), true);
});

Deno.test('rich when a detail description is present', () => {
  assertEquals(promoHasRichContent({ detailBody: 'Full details here' }), true);
});

Deno.test('rich when terms are present', () => {
  assertEquals(promoHasRichContent({ terms: 'Valid today only' }), true);
});

Deno.test('not rich when all rich fields are empty/absent', () => {
  assertEquals(promoHasRichContent({ imageUrl: null, detailBody: '', terms: undefined }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (bash): `export PATH="/c/Users/emkad/AppData/Local/Microsoft/WinGet/Links:$PATH" && deno test apps/customer/src/domain/promoContent.test.ts`
Expected: FAIL — module `./promoContent.ts` not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/customer/src/domain/promoContent.ts
export type PromoContent = {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  imageUrl: string | null;
  detailBody: string | null;
  terms: string | null;
  ctaLabel: string | null;
};

const hasText = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

// A promo warrants its own landing page only when it carries content beyond the
// one-line banner — an image, a full description, or terms.
export const promoHasRichContent = (
  promo: Pick<Partial<PromoContent>, 'imageUrl' | 'detailBody' | 'terms'>
): boolean => hasText(promo.imageUrl) || hasText(promo.detailBody) || hasText(promo.terms);
```

- [ ] **Step 4: Run test to verify it passes**

Run (bash): `deno test apps/customer/src/domain/promoContent.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 5: Commit**

```bash
git add apps/customer/src/domain/promoContent.ts apps/customer/src/domain/promoContent.test.ts
git commit -m "feat(promos): promoHasRichContent helper + PromoContent type"
```

---

## Task 6: Customer — live Deals hub

**Files:**
- Replace: `apps/customer/app/(customer)/deals.tsx`

**Interfaces:**
- Consumes: `supabase` (`apps/customer/src/services/supabase/config`), `trackPromoClick` (`apps/customer/src/services/promoTracking`), `PromoContent` (`apps/customer/src/domain/promoContent`), `customerTheme` (`apps/customer/src/theme/palette`), `router` from `expo-router`.

- [ ] **Step 1: Replace the placeholder with a live hub**

```tsx
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PromoContent } from '../../src/domain/promoContent';
import { trackPromoClick } from '../../src/services/promoTracking';
import { supabase } from '../../src/services/supabase/config';
import { customerTheme } from '../../src/theme/palette';

const PROMO_SELECT = 'id, title, body, actionUrl, imageUrl, detailBody, terms, ctaLabel';

export default function DealsScreen() {
  const [promos, setPromos] = useState<PromoContent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // RLS returns only active, in-window promos.
    const { data, error } = await supabase
      .from('Promo')
      .select(PROMO_SELECT)
      .order('createdAt', { ascending: false })
      .returns<PromoContent[]>();
    if (!error && data) {
      setPromos(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openPromo = (promo: PromoContent) => {
    trackPromoClick(promo.id);
    router.push(`/promo/${promo.id}` as never);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={customerTheme.accent} />
      </View>
    );
  }

  if (promos.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No deals right now</Text>
        <Text style={styles.emptyBody}>Check back soon — new offers land here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {promos.map((promo) => (
        <Pressable key={promo.id} style={styles.card} onPress={() => openPromo(promo)} accessibilityRole="button">
          {promo.imageUrl ? (
            <Image source={{ uri: promo.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : (
            <View style={[styles.image, styles.imagePlaceholder]} />
          )}
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={1}>{promo.title}</Text>
            <Text style={styles.cardCopy} numberOfLines={2}>{promo.body}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: customerTheme.background, flex: 1 },
  container: { padding: 16, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: customerTheme.background, gap: 6, padding: 24 },
  emptyTitle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: customerTheme.textMuted, fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: customerTheme.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: customerTheme.border },
  image: { width: '100%', height: 150 },
  imagePlaceholder: { backgroundColor: customerTheme.accentSoft },
  cardBody: { padding: 14, gap: 4 },
  cardTitle: { color: customerTheme.text, fontSize: 16, fontWeight: '800' },
  cardCopy: { color: customerTheme.textMuted, fontSize: 13, lineHeight: 18 },
});
```

- [ ] **Step 2: Type-check the customer app**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/customer/app/(customer)/deals.tsx"
git commit -m "feat(promos): live Deals hub replacing the static placeholder"
```

---

## Task 7: Customer — promo detail page + route registration

**Files:**
- Create: `apps/customer/app/(customer)/promo/[id].tsx`
- Modify: `apps/customer/app/(customer)/_layout.tsx`

**Interfaces:**
- Consumes: `useLocalSearchParams`/`router` from `expo-router`, `supabase`, `PromoContent`, `customerTheme`, `CustomerHeaderBackButton` (`apps/customer/src/components/CustomerHeaderBackButton`).

- [ ] **Step 1: Write the detail page**

```tsx
// apps/customer/app/(customer)/promo/[id].tsx
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PromoContent } from '../../../src/domain/promoContent';
import { supabase } from '../../../src/services/supabase/config';
import { customerTheme } from '../../../src/theme/palette';

const PROMO_SELECT = 'id, title, body, actionUrl, imageUrl, detailBody, terms, ctaLabel';

export default function PromoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [promo, setPromo] = useState<PromoContent | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from('Promo')
      .select(PROMO_SELECT)
      .eq('id', id)
      .maybeSingle<PromoContent>();
    setPromo(data ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCta = () => {
    // Same open-redirect guard as the banner: in-app paths only.
    if (promo?.actionUrl && promo.actionUrl.startsWith('/')) {
      router.push(promo.actionUrl as never);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={customerTheme.accent} />
      </View>
    );
  }

  if (!promo) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>This deal has ended</Text>
        <Text style={styles.emptyBody}>It may have expired or been withdrawn.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        {promo.imageUrl ? (
          <Image source={{ uri: promo.imageUrl }} style={styles.hero} resizeMode="cover" />
        ) : (
          <View style={[styles.hero, styles.heroPlaceholder]} />
        )}
        <Text style={styles.title}>{promo.title}</Text>
        <Text style={styles.body}>{promo.detailBody?.trim() || promo.body}</Text>
        {promo.terms ? (
          <View style={styles.terms}>
            <Text style={styles.termsLabel}>Terms</Text>
            <Text style={styles.termsBody}>{promo.terms}</Text>
          </View>
        ) : null}
      </ScrollView>
      {promo.actionUrl ? (
        <Pressable style={styles.cta} onPress={onCta} accessibilityRole="button">
          <Text style={styles.ctaText}>{promo.ctaLabel?.trim() || 'Order now'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: customerTheme.background },
  container: { padding: 16, paddingBottom: 100, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: customerTheme.background, gap: 6, padding: 24 },
  emptyTitle: { color: customerTheme.text, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: customerTheme.textMuted, fontSize: 14, textAlign: 'center' },
  hero: { width: '100%', height: 200, borderRadius: 16 },
  heroPlaceholder: { backgroundColor: customerTheme.accentSoft },
  title: { color: customerTheme.text, fontSize: 22, fontWeight: '800' },
  body: { color: customerTheme.text, fontSize: 15, lineHeight: 22 },
  terms: { backgroundColor: customerTheme.surfaceMuted, borderRadius: 12, padding: 12, gap: 4 },
  termsLabel: { color: customerTheme.textMuted, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  termsBody: { color: customerTheme.textMuted, fontSize: 13, lineHeight: 19 },
  cta: {
    position: 'absolute', left: 16, right: 16, bottom: 20, backgroundColor: customerTheme.accentStrong,
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  ctaText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
});
```

- [ ] **Step 2: Register the route as a hidden tab screen**

In `apps/customer/app/(customer)/_layout.tsx`, add a `<Tabs.Screen>` entry alongside the other hidden screens (e.g. right after the `support` screen), matching the existing hidden-screen + back-button pattern:

```tsx
        <Tabs.Screen
          name="promo/[id]"
          options={{
            href: null,
            headerShown: true,
            title: 'Deal',
            headerLeft: () => <CustomerHeaderBackButton href="/deals" />,
            tabBarStyle: { display: 'none' },
          }}
        />
```

> `CustomerHeaderBackButton` is already imported in this file (used by favorites/cart/support). Confirm before adding.

- [ ] **Step 3: Type-check the customer app**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/customer/app/(customer)/promo/[id].tsx" "apps/customer/app/(customer)/_layout.tsx"
git commit -m "feat(promos): per-promo detail page at /promo/[id]"
```

---

## Task 8: Customer — smart banner re-route

**Files:**
- Modify: `apps/customer/src/components/PromoBanner.tsx`

**Interfaces:**
- Consumes: `promoHasRichContent` + `PromoContent` (`apps/customer/src/domain/promoContent`).

- [ ] **Step 1: Select the rich fields**

Change the banner's local `Promo` type usage to the shared type. At the top, add:

```tsx
import { promoHasRichContent, type PromoContent } from '../domain/promoContent';
```

Delete the local `type Promo = { id; title; body; actionUrl }` block and replace all `Promo` references in this file with `PromoContent`. Update the `refresh()` select string to:

```tsx
      .select('id, title, body, actionUrl, imageUrl, detailBody, terms, ctaLabel')
```

- [ ] **Step 2: Smart-route in `openDeal`**

Replace the `openDeal` callback body with:

```tsx
  const openDeal = useCallback(() => {
    if (!promo) {
      return;
    }
    trackPromoClick(promo.id);
    if (promoHasRichContent(promo)) {
      router.push(`/promo/${promo.id}` as never);
    } else if (promo.actionUrl) {
      router.push(promo.actionUrl as never);
    }
    dismiss();
  }, [promo, dismiss]);
```

Also make the banner tappable whenever there's somewhere to go — change the `Pressable`'s `onPress={promo.actionUrl ? openDeal : undefined}` to:

```tsx
        onPress={promoHasRichContent(promo) || promo.actionUrl ? openDeal : undefined}
        accessibilityRole={promoHasRichContent(promo) || promo.actionUrl ? 'button' : undefined}
```

and the "View deal →" line's `{promo.actionUrl ? ...}` guard to `{promoHasRichContent(promo) || promo.actionUrl ? (`.

- [ ] **Step 3: Type-check the customer app**

Run: `cd apps/customer && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/customer/src/components/PromoBanner.tsx
git commit -m "feat(promos): banner routes rich promos to the detail page"
```

---

## Task 9: Final review, E2E verification, deploy & merge (operator)

- [ ] **Step 1: Whole-branch review** — dispatch the final code reviewer (subagent-driven-development's final review) over `git merge-base main HEAD`..HEAD.
- [ ] **Step 2: Apply the migration** — paste `supabase/migrations/20260716_promo_landing.sql` into the Supabase SQL editor (Frankfurt project `rgfbheorvtolixdcpjhy`) and run. Confirm the 4 columns exist on `"Promo"` and the `promo-assets` bucket exists.
- [ ] **Step 3: Deploy app-rpc** — `powershell -ExecutionPolicy Bypass -File scripts/deploy-app-rpc.ps1 -ProjectRef rgfbheorvtolixdcpjhy` (verify_jwt stays false via config.toml).
- [ ] **Step 4: Merge to main** — `--no-ff` merge of `feature/promo-landing-pages`, push (triggers admin + customer Vercel builds).
- [ ] **Step 5: Manual E2E** — in the admin, create a promo with an uploaded image + detail + terms → confirm it appears in the customer Deals hub → tap → detail page renders image/description/terms → CTA deep-links to `actionUrl` → a click event is recorded (Phase 2 ① stats increment). Verify a lean promo (no rich fields) still routes the banner straight to `actionUrl`.

---

## Self-Review notes

- **Spec coverage:** hub (Task 6), detail (Task 7), 4 fields (Tasks 1–3), upload (Task 4), smart re-route (Task 8), analytics reuse (Tasks 6/8 call `trackPromoClick`), admin form (Tasks 3–4), migration/bucket (Task 1), error/empty states (Tasks 6/7), backward compat (nullable columns, placeholder rendering). All covered.
- **Deviation from spec:** CDN rewrite deferred (Global Constraints) — promo images serve from the Supabase Storage public URL. Flagged to the user at plan handoff.
- **Type consistency:** `PromoContent` (Task 5) is the single shared shape consumed by hub/detail/banner; `promoHasRichContent` signature is stable across Tasks 5/8; edge `PromoRow` and admin `Promo` both gain the same four `string | null` fields.

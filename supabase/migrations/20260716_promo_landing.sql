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

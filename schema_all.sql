-- ============================================================
-- 食べ歩きメモ  Supabase スキーマ【全部入り・冪等】
-- これ1本をSQL Editorに貼ってRunすればOK（何度実行しても安全）
--   restaurants + photos + Storage + 公開(is_public) まで一括
-- ============================================================

-- ---------- restaurants（文字） ----------
create table if not exists public.restaurants (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text, prefecture text, group_id text, genre text, url text, memo text,
  status      text, date text,
  created_at  bigint, updated_at bigint,
  deleted     boolean not null default false
);
alter table public.restaurants add column if not exists is_public boolean not null default false;
alter table public.restaurants add column if not exists rating int not null default 0;
alter table public.restaurants add column if not exists city text;
alter table public.restaurants enable row level security;

drop policy if exists "own_select" on public.restaurants;
drop policy if exists "own_insert" on public.restaurants;
drop policy if exists "own_update" on public.restaurants;
drop policy if exists "own_delete" on public.restaurants;
drop policy if exists "public_r_select" on public.restaurants;
create policy "own_select" on public.restaurants for select using (auth.uid() = user_id);
create policy "own_insert" on public.restaurants for insert with check (auth.uid() = user_id);
create policy "own_update" on public.restaurants for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.restaurants for delete using (auth.uid() = user_id);
create policy "public_r_select" on public.restaurants for select to anon, authenticated
  using (is_public = true and deleted = false);
create index if not exists restaurants_user_updated on public.restaurants (user_id, updated_at);

-- ---------- photos（写真メタ） ----------
create table if not exists public.photos (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  restaurant_id text,
  created_at  bigint, updated_at bigint,
  deleted     boolean not null default false
);
alter table public.photos add column if not exists is_public boolean not null default false;
alter table public.photos enable row level security;

drop policy if exists "own_p_select" on public.photos;
drop policy if exists "own_p_insert" on public.photos;
drop policy if exists "own_p_update" on public.photos;
drop policy if exists "own_p_delete" on public.photos;
drop policy if exists "public_p_select" on public.photos;
create policy "own_p_select" on public.photos for select using (auth.uid() = user_id);
create policy "own_p_insert" on public.photos for insert with check (auth.uid() = user_id);
create policy "own_p_update" on public.photos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_p_delete" on public.photos for delete using (auth.uid() = user_id);
create policy "public_p_select" on public.photos for select to anon, authenticated
  using (is_public = true and deleted = false);
create index if not exists photos_user_updated on public.photos (user_id, updated_at);

-- ---------- Storage（写真の実体） ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists "own_obj_all" on storage.objects;
create policy "own_obj_all" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "public_obj_read" on storage.objects;
create policy "public_obj_read" on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'photos' and exists (
      select 1 from public.photos p
      where p.id = replace(split_part(name, '/', 2), '.jpg', '')
        and p.is_public = true and p.deleted = false
    )
  );

-- API(PostgREST)にスキーマ変更を即反映させる
notify pgrst, 'reload schema';

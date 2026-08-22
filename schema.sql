-- ============================================================
-- 食べ歩きメモ  Supabase スキーマ（Phase 1a：文字＝restaurants）
-- Supabase の SQL Editor に丸ごと貼って Run する
-- 写真(Storage)は 1b で追加。ここでは restaurants テーブルのみ。
-- ============================================================

create table if not exists public.restaurants (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text,
  prefecture  text,
  group_id    text,
  genre       text,
  url         text,
  memo        text,
  status      text,
  date        text,
  created_at  bigint,      -- epoch ms（クライアント発番）
  updated_at  bigint,      -- epoch ms（後勝ちの基準）
  deleted     boolean not null default false
);

-- 本人のデータしか読み書きできない（RLS）
alter table public.restaurants enable row level security;

drop policy if exists "own_select" on public.restaurants;
drop policy if exists "own_insert" on public.restaurants;
drop policy if exists "own_update" on public.restaurants;
drop policy if exists "own_delete" on public.restaurants;

create policy "own_select" on public.restaurants
  for select using (auth.uid() = user_id);
create policy "own_insert" on public.restaurants
  for insert with check (auth.uid() = user_id);
create policy "own_update" on public.restaurants
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_delete" on public.restaurants
  for delete using (auth.uid() = user_id);

-- 差分取得（updated_at で引く）を速く
create index if not exists restaurants_user_updated
  on public.restaurants (user_id, updated_at);

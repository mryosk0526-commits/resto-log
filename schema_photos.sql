-- ============================================================
-- 食べ歩きメモ  Supabase スキーマ（Phase 1b：写真）
-- SQL Editor に貼って Run。restaurants(schema.sql)の後に実行。
--   ・photos テーブル＝写真の「存在/削除」メタ（実体は持たない）
--   ・Storage バケット photos＝実バイト（{uid}/{photoId}.jpg）
-- ============================================================

-- 写真メタデータ（restaurantsと同じ後勝ち＋tombstone方式）
create table if not exists public.photos (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  restaurant_id text,
  created_at  bigint,
  updated_at  bigint,
  deleted     boolean not null default false
);

alter table public.photos enable row level security;
drop policy if exists "own_p_select" on public.photos;
drop policy if exists "own_p_insert" on public.photos;
drop policy if exists "own_p_update" on public.photos;
drop policy if exists "own_p_delete" on public.photos;
create policy "own_p_select" on public.photos for select using (auth.uid() = user_id);
create policy "own_p_insert" on public.photos for insert with check (auth.uid() = user_id);
create policy "own_p_update" on public.photos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_p_delete" on public.photos for delete using (auth.uid() = user_id);
create index if not exists photos_user_updated on public.photos (user_id, updated_at);

-- Storage バケット（非公開）。写真の実体はここに 1枚1ファイルで入る
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

-- Storage ポリシー：自分のフォルダ {uid}/… だけ読み書きできる
drop policy if exists "own_obj_all" on storage.objects;
create policy "own_obj_all" on storage.objects for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

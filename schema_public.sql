-- ============================================================
-- 食べ歩きメモ  Supabase スキーマ（Phase 2：公開ビュー）
-- SQL Editor に貼って Run。schema.sql / schema_photos.sql の後。
--   ・is_public フラグを追加
--   ・匿名(anon)でも is_public な行だけ読める（＝共有ページ用）
--   ・公開写真だけ匿名で落とせる Storage ポリシー
-- 非公開のデータは今まで通り本人しか読めない（既存ポリシーはそのまま）
-- ============================================================

alter table public.restaurants add column if not exists is_public boolean not null default false;
alter table public.photos      add column if not exists is_public boolean not null default false;

-- 匿名＆ログイン中どちらでも、is_public な行は読める（自分の非公開行は従来の own_select で別途読める）
drop policy if exists "public_r_select" on public.restaurants;
create policy "public_r_select" on public.restaurants for select to anon, authenticated
  using (is_public = true and deleted = false);

drop policy if exists "public_p_select" on public.photos;
create policy "public_p_select" on public.photos for select to anon, authenticated
  using (is_public = true and deleted = false);

-- Storage：写真ファイルは、その photos メタが is_public のときだけ匿名で読める
-- name 例: "{uid}/{photoId}.jpg" → split_part(name,'/',2)="{photoId}.jpg"
drop policy if exists "public_obj_read" on storage.objects;
create policy "public_obj_read" on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'photos' and exists (
      select 1 from public.photos p
      where p.id = replace(split_part(name, '/', 2), '.jpg', '')
        and p.is_public = true and p.deleted = false
    )
  );

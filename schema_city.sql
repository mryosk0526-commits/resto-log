-- 市区町村（city）カラム追加。Supabase の SQL Editor で1回 Run するだけ。
-- 既存データは空（未設定）になる。冪等（何度流してもOK）。
alter table public.restaurants add column if not exists city text;

-- PostgREST にスキーマ変更を即反映
notify pgrst, 'reload schema';

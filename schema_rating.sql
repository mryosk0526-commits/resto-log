-- ★評価（rating）カラム追加。Supabase の SQL Editor で1回 Run するだけ。
-- 既存データは 0（未評価）になる。冪等（何度流してもOK）。
alter table public.restaurants add column if not exists rating int not null default 0;

-- PostgREST にスキーマ変更を即反映
notify pgrst, 'reload schema';

# 同期のセットアップ（Phase 0 → 1a → 1b）

このアプリに「Supabase同期」を付けるための一度きりの手順。**あなたがやるのはアカウント作成と値の貼り付けだけ**（コードは実装済み）。所要 15〜20分。

## 1. Supabase プロジェクトを作る（電話番号なし）
1. https://supabase.com/ → **Start your project**
2. サインインは **「Continue with GitHub」**（GitHubアカウントはメール登録・電話不要。無ければ github.com で先に作る）
3. **New project** → 名前は `resto-log` など・DBパスワードは自動生成でOK・リージョンは Tokyo(ap-northeast-1) 推奨 → Create（1〜2分待つ）

## 2. URL と anon key を取る
- 左下 **Project Settings（⚙）> API** を開く
- **Project URL**（`https://xxxxx.supabase.co`）と **Project API keys の `anon` `public`** をコピー
- `config.js` を開いて2行に貼る：
  ```js
  window.SUPABASE_URL = 'https://xxxxx.supabase.co';
  window.SUPABASE_ANON_KEY = 'eyJhbGciOi...（anon public）';
  ```
  ※ anon key は公開前提の鍵。GitHubに上げても大丈夫（RLSでデータは守られる）。

## 3. テーブルを作る
- 左メニュー **SQL Editor** → **New query** → リポジトリの `schema.sql` を丸ごと貼る → **Run**
- 「Success」が出ればOK（`restaurants` テーブル＋本人しか読めないRLSができる）
- 続けて **写真同期（Phase 1b）** も使うなら、同じ SQL Editor で `schema_photos.sql` を貼る → **Run**
  - `photos` テーブル（写真メタ）＋本人限定RLS＋非公開Storageバケット `photos` ができる
  - 写真の実体は Storage の `photos` バケットに `{uid}/{photoId}.jpg` で1枚1ファイル保存される

## 4. メールに「6桁コード」を出す設定（iOS PWA対策の肝）
既定のメールはリンク方式で、PWAだとSafariに飛んで戻れない。**6桁コードに変える**：
- **Authentication > Emails（Email Templates）> Magic Link** を開く
- 本文のどこかに次の1行を足す（リンクはあってもOK、コードが載ればいい）：
  ```
  ログイン用コード： {{ .Token }}
  ```
- Save。これで届いたメールの6桁コードをアプリに打ち込めばログインできる。
- ※ Authentication > Providers の **Email** が有効（既定ON）であることだけ確認。

## 5. 動かす
- ローカル：このフォルダで簡易サーバを立てて開く（例 `python -m http.server 5510` → http://localhost:5510 ）
- 設定（⋯）→ 「☁️ 同期」→ メール入力→「コードを送る」→ 届いた6桁を入力→ログイン
- 店を追加すると自動で上がる。別端末で同じメールでログインすると降りてくる。

## できること（Phase 1a＋1b）
- ✅ 文字（店名・都道府県・ジャンル・メモ・状態・日付・複数訪問・削除）が両端末で同期
- ✅ **写真も同期**（`schema_photos.sql` を Run 済みなら）＝Storageバケット `photos` に実体、`photos` テーブルにメタ。追加は自動アップロード、削除はStorageからも掃除。
- 競合は「後から保存した方が勝ち」。削除は相手にも伝わる（tombstone）。写真も同方式。
- ※ `schema_photos.sql` 未実行だと写真同期だけ効かない（文字同期は動く）。

## トラブル時
- ログインできない：手順4のテンプレに `{{ .Token }}` が入っているか／メール(迷惑メール)確認
- 同期しない：`config.js` の値、`schema.sql` を Run したか、ブラウザのコンソールにエラーが出ていないか

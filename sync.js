'use strict';
/* ============================================================
   食べ歩きメモ — 同期モジュール（Phase 0 spike + 1a 文字同期）
   - 認証：Supabase メールOTP（6桁コード）＝iOS PWAでリンクに飛ばない
   - 同期：restaurants（文字）のみ。写真は 1b で対応
   - 競合：updatedAt(epoch ms)の後勝ち＋deleted=trueのtombstone
   - オフラインファースト：ローカル(IndexedDB)が常に主。失敗しても壊さない
   依存：vendor/supabase.min.js（global `supabase`）, config.js, app.js(window.RestoDB / window.reloadFromDB)
   ============================================================ */
(function () {
  const LS_PULL = 'resto-sync-lastPull';   // restaurants: 最後に取り込んだ updated_at
  const LS_PUSH = 'resto-sync-lastPush';   // restaurants: 最後に送った updated_at
  const LS_PPULL = 'resto-sync-photoPull'; // photos: 最後に取り込んだ updated_at
  const LS_PPUSH = 'resto-sync-photoPush'; // photos: 最後に送った updated_at
  const BUCKET = 'photos';
  const PUSH_DEBOUNCE = 2500;

  let client = null;
  let session = null;
  let pushTimer = null;
  let busy = false;
  let lastStatus = '';

  const getNum = (k) => Number(localStorage.getItem(k) || '0');
  const setNum = (k, v) => localStorage.setItem(k, String(v));

  function configured() {
    const u = window.SUPABASE_URL, k = window.SUPABASE_ANON_KEY;
    return typeof u === 'string' && typeof k === 'string' &&
      u.startsWith('https://') && !u.includes('ここに') && !k.includes('ここに') && k.length > 20;
  }

  function getClient() {
    if (client) return client;
    if (!configured() || typeof supabase === 'undefined') return null;
    client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'resto-auth', detectSessionInUrl: false },
    });
    return client;
  }

  /* ---------- レコード変換（local <-> Supabase行） ---------- */
  function rowToLocal(row) {
    return {
      id: row.id, name: row.name, prefecture: row.prefecture, groupId: row.group_id,
      genre: row.genre, url: row.url, memo: row.memo, status: row.status, date: row.date,
      createdAt: row.created_at, updatedAt: row.updated_at, deleted: !!row.deleted, isPublic: !!row.is_public,
    };
  }
  function localToRow(r, userId) {
    return {
      id: r.id, user_id: userId, name: r.name, prefecture: r.prefecture, group_id: r.groupId || r.id,
      genre: r.genre || '', url: r.url || '', memo: r.memo || '', status: r.status || 'want',
      date: r.date || '', created_at: r.createdAt || Date.now(),
      updated_at: r.updatedAt || r.createdAt || Date.now(), deleted: !!r.deleted, is_public: !!r.isPublic,
    };
  }

  /* ---------- 同期本体 ---------- */
  async function pull() {
    const c = getClient(); if (!c || !session) return 0;
    const last = getNum(LS_PULL);
    const { data, error } = await c.from('restaurants').select('*').gt('updated_at', last).order('updated_at', { ascending: true });
    if (error) throw error;
    let maxSeen = last, applied = 0;
    for (const row of data) {
      maxSeen = Math.max(maxSeen, row.updated_at || 0);
      const rec = rowToLocal(row);
      const localRec = await window.RestoDB.get('restaurants', rec.id);
      if (!localRec || (rec.updatedAt || 0) >= (localRec.updatedAt || 0)) {
        await window.RestoDB.put('restaurants', rec);
        applied++;
        // tombstoneを受け取ったら、この端末のローカル写真も掃除（写真は未同期のため）
        if (rec.deleted) {
          try {
            const ps = await window.RestoDB.getByIndex('photos', 'byRestaurant', rec.id);
            for (const p of ps) await window.RestoDB.delete('photos', p.id);
          } catch (_) {}
        }
      }
    }
    if (data.length) { setNum(LS_PULL, maxSeen); setNum(LS_PUSH, Math.max(getNum(LS_PUSH), maxSeen)); }
    return applied;
  }

  async function push() {
    const c = getClient(); if (!c || !session) return 0;
    const last = getNum(LS_PUSH);
    const all = await window.RestoDB.getAll('restaurants'); // deleted(tombstone)も含めて全部
    const changed = all.filter((r) => (r.updatedAt || r.createdAt || 0) > last);
    if (!changed.length) return 0;
    const rows = changed.map((r) => localToRow(r, session.user.id));
    const { error } = await c.from('restaurants').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    const maxPushed = changed.reduce((m, r) => Math.max(m, r.updatedAt || r.createdAt || 0), last);
    setNum(LS_PUSH, maxPushed);
    return changed.length;
  }

  /* ---------- 写真の同期（メタ=テーブル / 実体=Storage・1枚1ファイル） ---------- */
  const photoPath = (uid, id) => `${uid}/${id}.jpg`;

  async function pushPhotos() {
    const c = getClient(); if (!c || !session) return 0;
    const uid = session.user.id;
    const last = getNum(LS_PPUSH);
    const all = await window.RestoDB.getAll('photos');
    // 1) 未アップロードのblobをStorageへ（メタより先に上げる＝順序で穴を作らない）
    for (const p of all) {
      if (!p.deleted && !p.uploaded && p.blob) {
        const { error } = await c.storage.from(BUCKET).upload(photoPath(uid, p.id), p.blob, { upsert: true, contentType: 'image/jpeg' });
        if (!error) { p.uploaded = true; await window.RestoDB.put('photos', p); }
        else { console.warn('[sync] photo upload', error); }
      }
    }
    // 2) 削除済みはStorageから掃除
    for (const p of all) {
      if (p.deleted && p.uploaded) {
        try { await c.storage.from(BUCKET).remove([photoPath(uid, p.id)]); } catch (_) {}
        p.uploaded = false; await window.RestoDB.put('photos', p);
      }
    }
    // 3) メタ更新（updatedAt>last かつ アップ済 or 削除済）
    const changed = all.filter((p) => (p.updatedAt || p.createdAt || 0) > last && (p.uploaded || p.deleted));
    if (!changed.length) return 0;
    const rows = changed.map((p) => ({
      id: p.id, user_id: uid, restaurant_id: p.restaurantId,
      created_at: p.createdAt || Date.now(), updated_at: p.updatedAt || p.createdAt || Date.now(),
      deleted: !!p.deleted, is_public: !!p.isPublic,
    }));
    const { error } = await c.from('photos').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    setNum(LS_PPUSH, changed.reduce((m, p) => Math.max(m, p.updatedAt || p.createdAt || 0), last));
    return changed.length;
  }

  async function pullPhotos() {
    const c = getClient(); if (!c || !session) return 0;
    const last = getNum(LS_PPULL);
    const { data, error } = await c.from('photos').select('*').gt('updated_at', last).order('updated_at', { ascending: true });
    if (error) throw error;
    let maxSeen = last, applied = 0;
    for (const row of data) {
      maxSeen = Math.max(maxSeen, row.updated_at || 0);
      const local = await window.RestoDB.get('photos', row.id);
      if (row.deleted) {
        if (!local || !local.deleted) {
          await window.RestoDB.put('photos', { id: row.id, restaurantId: row.restaurant_id, createdAt: row.created_at, updatedAt: row.updated_at, deleted: true, uploaded: true });
          applied++;
        }
      } else if (!local || (!local.blob && !local.deleted)) {
        // Storageからblobを落とす
        const { data: blob, error: dlErr } = await c.storage.from(BUCKET).download(photoPath(row.user_id, row.id));
        if (!dlErr && blob) {
          await window.RestoDB.put('photos', { id: row.id, restaurantId: row.restaurant_id, blob, createdAt: row.created_at, updatedAt: row.updated_at, deleted: false, uploaded: true, isPublic: !!row.is_public });
          applied++;
        } else if (dlErr) { console.warn('[sync] photo download', dlErr); }
      }
    }
    if (data.length) { setNum(LS_PPULL, maxSeen); setNum(LS_PPUSH, Math.max(getNum(LS_PPUSH), maxSeen)); }
    return applied;
  }

  async function fullSync() {
    if (busy || !session) return;
    busy = true; setStatus('同期中…');
    try {
      const gotR = await pull();
      const gotP = await pullPhotos();
      const sentR = await push();
      const sentP = await pushPhotos();
      const got = gotR + gotP, sent = sentR + sentP;
      if (got) { await window.reloadFromDB(); }
      setStatus('同期済み ' + nowHM() + (sent ? `（↑${sent}）` : '') + (got ? `（↓${got}）` : ''));
    } catch (e) {
      console.warn('[sync] fullSync失敗', e);
      setStatus('同期できず（オフライン？）');
    } finally { busy = false; }
  }

  // ローカル変更後：少し待ってから送る（連続保存をまとめる）
  function scheduleSync() {
    if (!session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (busy) { scheduleSync(); return; }
      busy = true; setStatus('保存を同期中…');
      try { const sent = (await push()) + (await pushPhotos()); setStatus('同期済み ' + nowHM() + (sent ? `（↑${sent}）` : '')); }
      catch (e) { console.warn('[sync] push失敗', e); setStatus('同期待ち（オフライン？）'); }
      finally { busy = false; }
    }, PUSH_DEBOUNCE);
  }

  /* ---------- 認証 ---------- */
  async function sendCode(email) {
    const c = getClient(); if (!c) throw new Error('Supabase未設定');
    const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
  }
  async function verifyCode(email, token) {
    const c = getClient(); if (!c) throw new Error('Supabase未設定');
    const { data, error } = await c.auth.verifyOtp({ email, token: token.trim(), type: 'email' });
    if (error) throw error;
    session = data.session;
    return data.user;
  }
  // spike用：メール＋パスワード（custom SMTP不要）。本番はOTPに戻す想定
  async function signInPassword(email, password) {
    const c = getClient(); if (!c) throw new Error('Supabase未設定');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session;
    return data.user;
  }
  async function restoreSession() {
    const c = getClient(); if (!c) return null;
    const { data } = await c.auth.getSession();
    session = data.session || null;
    return session;
  }
  async function signOut() {
    const c = getClient(); if (c) { try { await c.auth.signOut(); } catch (_) {} }
    session = null;
  }

  /* ---------- UI（設定モーダル内の #syncPanel に描画） ---------- */
  const ui = { email: '' };
  function nowHM() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function setStatus(s) { lastStatus = s; const el = document.getElementById('syncStatus'); if (el) el.textContent = s; }

  function render() {
    const host = document.getElementById('syncPanel');
    if (!host) return;
    host.innerHTML = '';

    if (!configured()) {
      const box = document.createElement('div'); box.className = 'sync-box';
      box.innerHTML = `<div class="sync-title">☁️ 同期：未設定</div>
        <div class="sync-note">config.js に Supabase の URL とキーを貼ると、両端末で同期できます（SETUP.md 参照）</div>`;
      host.appendChild(box);
      return;
    }
    if (!session) {
      // spike：メール＋パスワード（Supabaseダッシュボードで作ったユーザーでログイン）
      const box = document.createElement('div'); box.className = 'sync-box';
      box.innerHTML = `
        <div class="sync-title">☁️ 同期（ログイン）</div>
        <input id="syncEmail" class="sync-input" type="email" inputmode="email" autocomplete="username" placeholder="メールアドレス" value="${ui.email || ''}" />
        <input id="syncPass" class="sync-input" type="password" autocomplete="current-password" placeholder="パスワード" />
        <button id="syncLogin" class="btn small primary">ログイン</button>
        <div class="sync-note" id="syncStatus">${lastStatus || ''}</div>`;
      host.appendChild(box);
      box.querySelector('#syncLogin').addEventListener('click', async () => {
        const email = (box.querySelector('#syncEmail').value || '').trim();
        const pass = box.querySelector('#syncPass').value || '';
        if (!email || !pass) { setStatus('メールとパスワードを入れてね'); return; }
        ui.email = email; setStatus('ログイン中…');
        try {
          await signInPassword(email, pass);
          setStatus('ログインしました'); render(); await fullSync();
        } catch (e) { console.warn(e); setStatus('ログイン失敗：' + (e.message || e)); }
      });
      return;
    }
    // ログイン済み
    const box = document.createElement('div'); box.className = 'sync-box';
    box.innerHTML = `
      <div class="sync-title">☁️ 同期：オン</div>
      <div class="sync-note">${session.user.email}</div>
      <div class="sync-row">
        <button id="syncNow" class="btn small primary">今すぐ同期</button>
        <button id="syncOut" class="btn small ghost">サインアウト</button>
      </div>
      <button id="syncShare" class="btn small ghost">🌐 公開ページのURLをコピー</button>
      <div class="sync-note" id="syncStatus">${lastStatus || ''}</div>`;
    host.appendChild(box);
    box.querySelector('#syncNow').addEventListener('click', fullSync);
    box.querySelector('#syncOut').addEventListener('click', async () => { await signOut(); setStatus(''); render(); });
    box.querySelector('#syncShare').addEventListener('click', async () => {
      const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
      const url = base + 'view.html?u=' + session.user.id;
      try { await navigator.clipboard.writeText(url); setStatus('公開URLをコピーしました'); }
      catch (_) { setStatus(url); }
    });
  }

  /* ---------- 公開API ---------- */
  window.RestoSync = {
    scheduleSync,
    renderPanel: render,
    async init() {
      if (!configured()) { return; }
      try {
        await restoreSession();
        if (session) { setStatus('自動ログイン'); await fullSync(); }
      } catch (e) { console.warn('[sync] init', e); }
    },
  };
})();

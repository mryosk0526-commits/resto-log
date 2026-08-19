'use strict';

/* =========================================================
   食べ歩きメモ  v1
   - ログイン不要 / 全データは端末内(IndexedDB)に保存
   - 写真は「店を追加/編集」フォームの中で付ける
   - 取り込み時に自動リサイズ＋EXIF回転補正して保存
   ========================================================= */

const PREFECTURES = [
  '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
  '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
  '新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県',
  '静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県',
  '奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県',
  '徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県',
  '熊本県','大分県','宮崎県','鹿児島県','沖縄県'
];

const MAX_PHOTOS = 10;
const MAX_EDGE = 1200;      // 写真の長辺(px) — これ以上は縮小
const JPEG_QUALITY = 0.8;

/* ---------- IndexedDB ラッパ ---------- */
const DB_NAME = 'resto-log';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('restaurants')) {
        db.createObjectStore('restaurants', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('photos')) {
        const s = db.createObjectStore('photos', { keyPath: 'id' });
        s.createIndex('byRestaurant', 'restaurantId', { unique: false });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}
function reqToPromise(request) {
  return new Promise((res, rej) => { request.onsuccess = () => res(request.result); request.onerror = () => rej(request.error); });
}

const dbGetAll = (store) => tx(store).then((s) => reqToPromise(s.getAll()));
const dbPut = (store, val) => tx(store, 'readwrite').then((s) => reqToPromise(s.put(val)));
const dbDelete = (store, key) => tx(store, 'readwrite').then((s) => reqToPromise(s.delete(key)));
const dbGetByIndex = (store, index, key) =>
  tx(store).then((s) => reqToPromise(s.index(index).getAll(key)));

/* ---------- ユーティリティ ---------- */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ObjectURL 管理：一覧用と表示(詳細/フォーム)用を分離して安全に解放する */
const _listUrls = new Set();
const _viewUrls = new Set();
const listURL = (b) => { const u = URL.createObjectURL(b); _listUrls.add(u); return u; };
const viewURL = (b) => { const u = URL.createObjectURL(b); _viewUrls.add(u); return u; };
const revokeListURLs = () => { _listUrls.forEach((u) => URL.revokeObjectURL(u)); _listUrls.clear(); };
const revokeViewURLs = () => { _viewUrls.forEach((u) => URL.revokeObjectURL(u)); _viewUrls.clear(); };

/* ---------- 写真：デコード → リサイズ ---------- */
// iPhone対応: createImageBitmap(回転補正付き) を優先し、失敗時は <img> にフォールバック
async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) { /* フォールバックへ */ }
  }
  return await new Promise((res, rej) => {
    const img = new Image();
    const u = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode failed')); };
    img.src = u;
  });
}

async function resizeImage(file) {
  const src = await decodeImage(file);
  let w = src.width, h = src.height;
  if (!w || !h) throw new Error('empty image');
  if (w > MAX_EDGE || h > MAX_EDGE) {
    const r = Math.min(MAX_EDGE / w, MAX_EDGE / h);
    w = Math.round(w * r); h = Math.round(h * r);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();
  const blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => b ? res(b) : rej(new Error('encode failed')), 'image/jpeg', JPEG_QUALITY)
  );
  return blob;
}

/* ---------- 状態 ---------- */
const state = {
  restaurants: [],
  photoCounts: {},   // restaurantId -> 枚数
  firstPhoto: {},    // restaurantId -> Blob(先頭写真・サムネ用)
  filterStatus: 'all',
  filterPref: '',
  currentId: null,   // 詳細表示中の店id
  // 編集フォームの写真ステージング
  form: { photos: [], removed: [] }, // photos: {key, blob, dbId|null}
};

/* ---------- 読み込み & 一覧描画 ---------- */
async function loadAll() {
  state.restaurants = await dbGetAll('restaurants');
  const photos = await dbGetAll('photos');
  state.photoCounts = {};
  state.firstPhoto = {};
  photos
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((p) => {
      state.photoCounts[p.restaurantId] = (state.photoCounts[p.restaurantId] || 0) + 1;
      if (!state.firstPhoto[p.restaurantId]) state.firstPhoto[p.restaurantId] = p.blob;
    });
  render();
}

function render() {
  revokeListURLs();
  const list = $('#list');
  list.innerHTML = '';

  let items = state.restaurants.slice();
  if (state.filterStatus !== 'all') items = items.filter((r) => r.status === state.filterStatus);
  if (state.filterPref) items = items.filter((r) => r.prefecture === state.filterPref);
  items.sort((a, b) => b.createdAt - a.createdAt);

  $('#emptyState').hidden = items.length !== 0;

  for (const r of items) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = r.id;

    const thumb = document.createElement('div');
    thumb.className = 'card-thumb';
    const blob = state.firstPhoto[r.id];
    if (blob) {
      const im = document.createElement('img');
      im.src = listURL(blob); im.alt = '';
      thumb.appendChild(im);
    } else {
      thumb.textContent = r.status === 'visited' ? '🍽️' : '📍';
    }

    const body = document.createElement('div');
    body.className = 'card-body';

    const name = document.createElement('h3');
    name.className = 'card-name';
    name.textContent = r.name;

    const sub = document.createElement('div');
    sub.className = 'card-sub';
    sub.appendChild(statusBadge(r.status));
    if (r.prefecture) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = r.prefecture;
      sub.appendChild(chip);
    }
    const cnt = state.photoCounts[r.id];
    if (cnt) {
      const pc = document.createElement('span');
      pc.className = 'chip';
      pc.textContent = '📷 ' + cnt;
      sub.appendChild(pc);
    }

    body.appendChild(name);
    body.appendChild(sub);
    if (r.memo) {
      const m = document.createElement('p');
      m.className = 'card-memo';
      m.textContent = r.memo;
      body.appendChild(m);
    }

    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener('click', () => openDetail(r.id));
    list.appendChild(card);
  }
}

function statusBadge(status) {
  const b = document.createElement('span');
  b.className = 'badge ' + status;
  b.textContent = status === 'visited' ? '行った' : '行きたい';
  return b;
}

/* ---------- 追加/編集フォーム（写真もここで管理） ---------- */
async function openEdit(r) {
  $('#editTitle').textContent = r ? '店を編集' : '店を追加';
  $('#f_id').value = r ? r.id : '';
  $('#f_name').value = r ? r.name : '';
  $('#f_pref').value = r ? (r.prefecture || '') : '';
  $('#f_url').value = r ? (r.url || '') : '';
  $('#f_memo').value = r ? (r.memo || '') : '';
  const st = r ? r.status : 'want';
  document.querySelector(`input[name=f_status][value=${st}]`).checked = true;
  $('#deleteBtn').hidden = !r;

  // 写真ステージングを初期化（既存店なら現在の写真を読み込む）
  state.form.photos = [];
  state.form.removed = [];
  if (r) {
    const existing = (await dbGetByIndex('photos', 'byRestaurant', r.id)).sort((a, b) => a.createdAt - b.createdAt);
    state.form.photos = existing.map((p) => ({ key: p.id, blob: p.blob, dbId: p.id }));
  }
  renderFormPhotos();

  showModal('#editModal');
  if (!r) setTimeout(() => $('#f_name').focus(), 100);
}

function renderFormPhotos() {
  const oldUrls = [..._viewUrls]; _viewUrls.clear();
  const grid = $('#f_photoGrid');
  grid.innerHTML = '';               // 先に古い<img>を外してから
  state.form.photos.forEach((p, idx) => {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    const im = document.createElement('img');
    im.src = viewURL(p.blob); im.alt = '';
    im.addEventListener('click', () => openLightbox(p.blob));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'photo-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '写真を外す');
    del.addEventListener('click', (ev) => { ev.stopPropagation(); removeFormPhoto(idx); });
    cell.appendChild(im);
    cell.appendChild(del);
    grid.appendChild(cell);
  });
  const n = state.form.photos.length;
  $('#f_photocount').textContent = `(${n}/${MAX_PHOTOS})`;
  const addBtn = $('.photo-add');
  addBtn.style.display = n >= MAX_PHOTOS ? 'none' : '';
  oldUrls.forEach((u) => URL.revokeObjectURL(u)); // 差し替え後に旧URLを解放
}

function removeFormPhoto(idx) {
  const p = state.form.photos[idx];
  if (!p) return;
  if (p.dbId) state.form.removed.push(p.dbId); // 既存写真は保存時に削除
  state.form.photos.splice(idx, 1);
  renderFormPhotos();
}

async function addFormPhotos(files) {
  const room = MAX_PHOTOS - state.form.photos.length;
  if (room <= 0) { toast(`写真は${MAX_PHOTOS}枚までです`); return; }
  const picked = Array.from(files).slice(0, room);
  if (files.length > room) toast(`残り${room}枚だけ追加できます`);

  const label = $('#f_photoAddLabel');
  const original = label.textContent;
  label.textContent = '処理中…';
  $('.photo-add').classList.add('busy');

  let ok = 0, fail = 0;
  for (const file of picked) {
    try {
      const blob = await resizeImage(file);
      state.form.photos.push({ key: uid(), blob, dbId: null });
      ok++;
    } catch (err) {
      console.error('写真の処理に失敗', file && file.name, err);
      fail++;
    }
  }

  label.textContent = original;
  $('.photo-add').classList.remove('busy');
  renderFormPhotos();

  if (ok && !fail) toast(`${ok}枚 追加しました`);
  else if (ok && fail) toast(`${ok}枚追加・${fail}枚は取り込めませんでした`);
  else if (fail) toast(`写真を取り込めませんでした（形式かサイズを確認）`);
}

async function saveFromForm(e) {
  e.preventDefault();
  const name = $('#f_name').value.trim();
  if (!name) { toast('店名を入力してね'); return; }
  const id = $('#f_id').value || uid();
  const existing = state.restaurants.find((r) => r.id === id);
  const rec = {
    id,
    name,
    prefecture: $('#f_pref').value,
    url: $('#f_url').value.trim(),
    memo: $('#f_memo').value.trim(),
    status: document.querySelector('input[name=f_status]:checked').value,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  await dbPut('restaurants', rec);

  // 写真の反映：削除 → 追加
  for (const delId of state.form.removed) await dbDelete('photos', delId);
  for (const p of state.form.photos) {
    if (!p.dbId) {
      await dbPut('photos', { id: p.key, restaurantId: id, blob: p.blob, createdAt: Date.now() });
    }
  }
  state.form.photos = [];
  state.form.removed = [];

  hideModal('#editModal');
  await loadAll();
  toast(existing ? '保存しました' : '追加しました');
}

async function deleteCurrent() {
  const id = $('#f_id').value;
  if (!id) return;
  const r = state.restaurants.find((x) => x.id === id);
  if (!confirm(`「${r ? r.name : 'この店'}」を写真ごと削除します。よろしい？`)) return;
  const photos = await dbGetByIndex('photos', 'byRestaurant', id);
  await Promise.all(photos.map((p) => dbDelete('photos', p.id)));
  await dbDelete('restaurants', id);
  hideModal('#editModal');
  await loadAll();
  toast('削除しました');
}

/* ---------- 詳細（見るだけ） ---------- */
async function openDetail(id) {
  const r = state.restaurants.find((x) => x.id === id);
  if (!r) return;
  state.currentId = id;
  $('#d_name').textContent = r.name;
  const badge = $('#d_status');
  badge.className = 'badge ' + r.status;
  badge.textContent = r.status === 'visited' ? '行った' : '行きたい';
  const pref = $('#d_pref');
  pref.textContent = r.prefecture || '未設定';
  const urlEl = $('#d_url');
  if (r.url) { urlEl.href = r.url; urlEl.hidden = false; } else { urlEl.hidden = true; }
  $('#d_memo').textContent = r.memo || '';
  $('#toggleStatusBtn').textContent = r.status === 'visited' ? '「行きたい」に戻す' : '「行った」にする';
  await renderDetailPhotos(id);
  showModal('#detailModal');
}

async function renderDetailPhotos(id) {
  const oldUrls = [..._viewUrls]; _viewUrls.clear();
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  const photos = (await dbGetByIndex('photos', 'byRestaurant', id)).sort((a, b) => a.createdAt - b.createdAt);
  $('#d_photocount').textContent = photos.length ? `(${photos.length})` : '（なし）';
  for (const p of photos) {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    const im = document.createElement('img');
    im.src = viewURL(p.blob); im.alt = '';
    im.addEventListener('click', () => openLightbox(p.blob));
    cell.appendChild(im);
    grid.appendChild(cell);
  }
  oldUrls.forEach((u) => URL.revokeObjectURL(u));
}

async function toggleStatus() {
  const r = state.restaurants.find((x) => x.id === state.currentId);
  if (!r) return;
  r.status = r.status === 'visited' ? 'want' : 'visited';
  r.updatedAt = Date.now();
  await dbPut('restaurants', r);
  await loadAll();
  await openDetail(r.id);
}

/* ---------- 写真の拡大表示（ピンチ/パン/ダブルタップ） ---------- */
const lb = {
  scale: 1, tx: 0, ty: 0, url: null,
  startDist: 0, startScale: 1, startTx: 0, startTy: 0,
  panX: 0, panY: 0, lastTap: 0, moved: false, downOnImage: false,
};

function applyLb() {
  $('#lightboxImg').style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.scale})`;
}

function openLightbox(blob) {
  const box = $('#lightbox');
  const img = $('#lightboxImg');
  if (lb.url) URL.revokeObjectURL(lb.url);
  lb.url = URL.createObjectURL(blob);
  img.src = lb.url;
  lb.scale = 1; lb.tx = 0; lb.ty = 0;
  applyLb();
  box.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const box = $('#lightbox');
  const img = $('#lightboxImg');
  box.hidden = true;
  img.src = '';
  if (lb.url) { URL.revokeObjectURL(lb.url); lb.url = null; }
  // 背後にモーダルがある場合は overflow:hidden を維持
  if ($('#detailModal').hidden && $('#editModal').hidden && $('#menuModal').hidden) {
    document.body.style.overflow = '';
  }
}

function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function bindLightbox() {
  const box = $('#lightbox');
  $('#lightboxClose').addEventListener('click', closeLightbox);

  box.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lb.startDist = touchDist(e.touches);
      lb.startScale = lb.scale;
      lb.moved = true;
    } else if (e.touches.length === 1) {
      lb.moved = false;
      lb.downOnImage = (e.target && e.target.id === 'lightboxImg');
      lb.panX = e.touches[0].clientX; lb.panY = e.touches[0].clientY;
      lb.startTx = lb.tx; lb.startTy = lb.ty;
    }
  }, { passive: false });

  box.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const d = touchDist(e.touches);
      if (lb.startDist > 0) lb.scale = Math.min(5, Math.max(1, lb.startScale * (d / lb.startDist)));
      applyLb();
    } else if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - lb.panX;
      const dy = e.touches[0].clientY - lb.panY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) lb.moved = true;
      if (lb.scale > 1) { lb.tx = lb.startTx + dx; lb.ty = lb.startTy + dy; applyLb(); }
    }
  }, { passive: false });

  box.addEventListener('touchend', (e) => {
    if (e.touches.length > 0) return;
    if (lb.scale <= 1.02) { lb.scale = 1; lb.tx = 0; lb.ty = 0; applyLb(); }
    if (lb.moved) return;
    const now = Date.now();
    if (now - lb.lastTap < 300 && lb.downOnImage) {
      // 画像をダブルタップ → ズーム切替
      if (lb.scale > 1) { lb.scale = 1; lb.tx = 0; lb.ty = 0; } else { lb.scale = 2.5; }
      applyLb();
      lb.lastTap = 0;
    } else {
      lb.lastTap = now;
      // 画像の外（空いた所）を単タップ → 閉じる
      if (!lb.downOnImage) closeLightbox();
    }
  });

  // PC（マウス）：背景クリックで閉じる
  box.addEventListener('mousedown', (e) => { if (e.target === box) closeLightbox(); });
}

/* ---------- エクスポート / インポート ---------- */
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
function dataURLtoBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportData() {
  const restaurants = await dbGetAll('restaurants');
  const photosRaw = await dbGetAll('photos');
  const photos = [];
  for (const p of photosRaw) {
    photos.push({ id: p.id, restaurantId: p.restaurantId, createdAt: p.createdAt, dataURL: await blobToDataURL(p.blob) });
  }
  const payload = { app: 'resto-log', version: 1, exportedAt: new Date().toISOString(), restaurants, photos };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = URL.createObjectURL(blob);
  a.download = `tabearuki-memo_${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('バックアップを書き出しました');
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { toast('ファイルを読めませんでした'); return; }
  if (!data || data.app !== 'resto-log' || !Array.isArray(data.restaurants)) {
    toast('このアプリのバックアップではないようです'); return;
  }
  if (!confirm('読み込むと、同じ店・写真は上書き/追加されます。続けますか？')) return;
  for (const r of data.restaurants) await dbPut('restaurants', r);
  for (const p of (data.photos || [])) {
    await dbPut('photos', { id: p.id, restaurantId: p.restaurantId, createdAt: p.createdAt, blob: dataURLtoBlob(p.dataURL) });
  }
  hideModal('#menuModal');
  await loadAll();
  toast(`復元しました（店 ${data.restaurants.length} 件）`);
}

async function updateMenuStat() {
  const r = await dbGetAll('restaurants');
  const p = await dbGetAll('photos');
  $('#menuStat').textContent = `保存中：店 ${r.length} 件 ・ 写真 ${p.length} 枚（すべてこの端末内）`;
}

/* ---------- モーダル制御 ---------- */
function showModal(sel) { $(sel).hidden = false; document.body.style.overflow = 'hidden'; }
function hideModal(sel) {
  $(sel).hidden = true;
  document.body.style.overflow = '';
  if (sel === '#editModal' || sel === '#detailModal') revokeViewURLs();
}

/* ---------- 初期化 ---------- */
function initPrefOptions() {
  const filter = $('#prefFilter');
  const formSel = $('#f_pref');
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '未設定';
  formSel.appendChild(blank);
  for (const p of PREFECTURES) {
    const o1 = document.createElement('option'); o1.value = p; o1.textContent = p; filter.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = p; o2.textContent = p; formSel.appendChild(o2);
  }
}

function bindEvents() {
  bindLightbox();
  $('#fab').addEventListener('click', () => openEdit(null));
  $('#editForm').addEventListener('submit', saveFromForm);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#f_photoInput').addEventListener('change', (e) => { addFormPhotos(e.target.files); e.target.value = ''; });

  $('#statusTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab'); if (!btn) return;
    document.querySelectorAll('#statusTabs .tab').forEach((t) => t.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.filterStatus = btn.dataset.status;
    render();
  });
  $('#prefFilter').addEventListener('change', (e) => { state.filterPref = e.target.value; render(); });

  $('#toggleStatusBtn').addEventListener('click', toggleStatus);
  $('#editFromDetailBtn').addEventListener('click', () => {
    const r = state.restaurants.find((x) => x.id === state.currentId);
    hideModal('#detailModal');
    openEdit(r);
  });

  $('#menuBtn').addEventListener('click', () => { updateMenuStat(); showModal('#menuModal'); });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', (e) => hideModal('#' + e.target.closest('.modal').id))
  );
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => { if (e.target === m) hideModal('#' + m.id); })
  );
}

async function init() {
  initPrefOptions();
  bindEvents();
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast('データの読み込みに失敗しました');
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW登録失敗', e));
  }
}

document.addEventListener('DOMContentLoaded', init);

'use strict';

/* =========================================================
   食べ歩きメモ  v1
   - ログイン不要 / 全データは端末内(IndexedDB)に保存
   - 写真は取り込み時に自動リサイズして保存
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
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

// ObjectURL を使い回さず都度作り、解放も管理する
const _urls = new Set();
function objURL(blob) { const u = URL.createObjectURL(blob); _urls.add(u); return u; }
function revokeAllURLs() { _urls.forEach((u) => URL.revokeObjectURL(u)); _urls.clear(); }

/* ---------- 写真リサイズ ---------- */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        const r = Math.min(MAX_EDGE / width, MAX_EDGE / height);
        width = Math.round(width * r);
        height = Math.round(height * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('encode failed')),
        'image/jpeg',
        JPEG_QUALITY
      );
    };
    img.onerror = () => reject(new Error('load failed'));
    img.src = URL.createObjectURL(file);
  });
}

/* ---------- 状態 ---------- */
const state = {
  restaurants: [],
  photoCounts: {},   // restaurantId -> 枚数
  firstPhoto: {},    // restaurantId -> Blob(先頭写真・サムネ用)
  filterStatus: 'all',
  filterPref: '',
  currentId: null,   // 詳細表示中の店id
};

/* ---------- 読み込み & 描画 ---------- */
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
  revokeAllURLs();
  const list = $('#list');
  list.innerHTML = '';

  let items = state.restaurants.slice();
  if (state.filterStatus !== 'all') items = items.filter((r) => r.status === state.filterStatus);
  if (state.filterPref) items = items.filter((r) => r.prefecture === state.filterPref);
  // 新しく追加した順（作成日時 降順）
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
      im.src = objURL(blob); im.alt = '';
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

/* ---------- 追加/編集モーダル ---------- */
function openEdit(r) {
  $('#editTitle').textContent = r ? '店を編集' : '店を追加';
  $('#f_id').value = r ? r.id : '';
  $('#f_name').value = r ? r.name : '';
  $('#f_pref').value = r ? (r.prefecture || '') : '';
  $('#f_url').value = r ? (r.url || '') : '';
  $('#f_memo').value = r ? (r.memo || '') : '';
  const st = r ? r.status : 'want';
  document.querySelector(`input[name=f_status][value=${st}]`).checked = true;
  $('#deleteBtn').hidden = !r;
  showModal('#editModal');
  if (!r) setTimeout(() => $('#f_name').focus(), 100);
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

/* ---------- 詳細モーダル ---------- */
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
  pref.hidden = false;
  const urlEl = $('#d_url');
  if (r.url) { urlEl.href = r.url; urlEl.hidden = false; } else { urlEl.hidden = true; }
  $('#d_memo').textContent = r.memo || '';
  $('#toggleStatusBtn').textContent = r.status === 'visited' ? '「行きたい」に戻す' : '「行った」にする';
  await renderPhotos(id);
  showModal('#detailModal');
}

async function renderPhotos(id) {
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  const photos = (await dbGetByIndex('photos', 'byRestaurant', id)).sort((a, b) => a.createdAt - b.createdAt);
  $('#d_photocount').textContent = `(${photos.length}/${MAX_PHOTOS})`;
  for (const p of photos) {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    const im = document.createElement('img');
    im.src = objURL(p.blob); im.alt = '';
    im.loading = 'lazy';
    const del = document.createElement('button');
    del.className = 'photo-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '写真を削除');
    del.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await dbDelete('photos', p.id);
      await renderPhotos(id);
      await refreshCountsFor(id);
      toast('写真を削除しました');
    });
    cell.appendChild(im);
    cell.appendChild(del);
    grid.appendChild(cell);
  }
}

async function refreshCountsFor() {
  // 一覧のサムネ/枚数を最新化（詳細から戻る前提で全体再読込）
  await loadAll();
}

async function addPhotos(files) {
  const id = state.currentId;
  if (!id) return;
  const current = (await dbGetByIndex('photos', 'byRestaurant', id)).length;
  const room = MAX_PHOTOS - current;
  if (room <= 0) { toast(`写真は${MAX_PHOTOS}枚までです`); return; }
  const list = Array.from(files).slice(0, room);
  if (files.length > room) toast(`残り${room}枚だけ追加しました`);
  let ok = 0;
  for (const file of list) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const blob = await resizeImage(file);
      await dbPut('photos', { id: uid(), restaurantId: id, blob, createdAt: Date.now() });
      ok++;
    } catch (err) {
      console.error('写真の処理に失敗', err);
    }
  }
  await renderPhotos(id);
  await refreshCountsFor(id);
  if (ok) toast(`${ok}枚 追加しました`);
}

async function toggleStatus() {
  const r = state.restaurants.find((x) => x.id === state.currentId);
  if (!r) return;
  r.status = r.status === 'visited' ? 'want' : 'visited';
  r.updatedAt = Date.now();
  await dbPut('restaurants', r);
  await openDetail(r.id);
  await loadAll();
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
function hideModal(sel) { $(sel).hidden = true; document.body.style.overflow = ''; }

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
  $('#fab').addEventListener('click', () => openEdit(null));
  $('#editForm').addEventListener('submit', saveFromForm);
  $('#deleteBtn').addEventListener('click', deleteCurrent);

  $('#statusTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab'); if (!btn) return;
    document.querySelectorAll('#statusTabs .tab').forEach((t) => t.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.filterStatus = btn.dataset.status;
    render();
  });
  $('#prefFilter').addEventListener('change', (e) => { state.filterPref = e.target.value; render(); });

  $('#photoInput').addEventListener('change', (e) => { addPhotos(e.target.files); e.target.value = ''; });
  $('#toggleStatusBtn').addEventListener('click', toggleStatus);
  $('#editFromDetailBtn').addEventListener('click', () => {
    const r = state.restaurants.find((x) => x.id === state.currentId);
    hideModal('#detailModal');
    openEdit(r);
  });

  $('#menuBtn').addEventListener('click', () => { updateMenuStat(); showModal('#menuModal'); });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  // 閉じるボタン & 背景タップ
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

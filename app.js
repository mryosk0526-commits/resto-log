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
const MAX_STORES = 300;     // 登録上限（重複＝別訪問も1件として数える）
const GENRES = [
  'ラーメン', '寿司', '焼肉・肉', '居酒屋', 'カフェ・喫茶', '定食・食堂',
  'そば・うどん', 'イタリアン', 'フレンチ', '中華', 'カレー',
  'ファストフード', 'スイーツ', 'バー', 'その他',
];

// 全国制覇: 都道府県タイルの配置（[列,行]・日本の形を模した並び／北陸も穴なし）と地方区分
// [x, y, w, h]（w,h省略時1）— 都道府県ごとに大きさ可変のモザイク配置
const TILE_POS = {
  '北海道': [12, 0, 3, 2],
  '青森県': [10, 3, 3, 1],
  '秋田県': [10, 4, 1, 2], '岩手県': [11, 4, 2, 2],
  '山形県': [10, 6, 1, 2], '宮城県': [11, 6, 2, 2],
  '福島県': [10, 8, 3, 1],
  '新潟県': [9, 7, 1, 3],
  '富山県': [8, 7, 1, 1], '石川県': [7, 7, 1, 2], '福井県': [7, 9, 1, 1],
  '岐阜県': [8, 8, 1, 3], '長野県': [9, 10, 1, 2],
  '群馬県': [10, 9, 1, 1], '栃木県': [11, 9, 1, 1], '茨城県': [12, 9, 1, 2],
  '埼玉県': [10, 10, 2, 1], '東京都': [11, 11, 1, 1], '千葉県': [12, 11, 1, 2],
  '山梨県': [10, 11, 1, 1], '神奈川県': [10, 12, 2, 1],
  '愛知県': [8, 11, 1, 1], '静岡県': [8, 12, 2, 1],
  '京都府': [6, 9, 1, 2], '滋賀県': [7, 10, 1, 1], '三重県': [7, 12, 1, 1],
  '兵庫県': [5, 9, 1, 2], '大阪府': [6, 11, 1, 1], '奈良県': [7, 11, 1, 1], '和歌山県': [7, 13, 1, 1],
  '島根県': [3, 9, 1, 1], '鳥取県': [4, 9, 1, 1],
  '山口県': [2, 10, 1, 1], '広島県': [3, 10, 1, 1], '岡山県': [4, 10, 1, 1],
  '愛媛県': [4, 12, 1, 1], '香川県': [5, 12, 1, 1], '高知県': [4, 13, 1, 1], '徳島県': [5, 13, 1, 1],
  '福岡県': [1, 11, 1, 1], '佐賀県': [0, 11, 1, 1], '大分県': [2, 12, 1, 1], '熊本県': [1, 12, 1, 1], '長崎県': [0, 12, 1, 1],
  '宮崎県': [2, 13, 1, 1], '鹿児島県': [1, 13, 1, 1],
  '沖縄県': [0, 15, 1, 1],
};
const REGIONS = {
  '北海道・東北': ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  '関東': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
  '中部': ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
  '近畿': ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '中国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
  '四国': ['徳島県', '香川県', '愛媛県', '高知県'],
  '九州沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'],
};
const SVG_NS = 'http://www.w3.org/2000/svg';

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
const dbGet = (store, key) => tx(store).then((s) => reqToPromise(s.get(key)));

// 同期モジュール(sync.js)から使う最小API
window.RestoDB = { get: dbGet, put: dbPut, getAll: dbGetAll, delete: dbDelete, getByIndex: dbGetByIndex };
window.reloadFromDB = async () => { await loadAll(); };

// 写真の削除：アップ済みは同期用tombstone（blob捨てる）、未アップはローカル完結で即削除
async function removePhoto(id) {
  const p = await dbGet('photos', id);
  if (!p) return;
  if (p.uploaded) { p.deleted = true; p.updatedAt = Date.now(); p.blob = undefined; await dbPut('photos', p); }
  else { await dbDelete('photos', id); }
}

/* ---------- ユーティリティ ---------- */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = '';
  el.appendChild(document.createTextNode(msg));
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.hidden = true; clearTimeout(toast._t); action.fn(); });
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2600);
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

/* ---------- 日付ユーティリティ ---------- */
function dateToStr(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const todayStr = () => dateToStr(Date.now());
// 表示用: 'YYYY-MM-DD' -> 'YYYY/MM/DD'（無ければ登録日から）
function displayDate(r) {
  const s = (r && r.date) || (r && dateToStr(r.createdAt)) || '';
  return s ? s.replace(/-/g, '/') : '';
}
// 並び替え用の訪問時刻（日付→無ければ登録日時）
function visitTime(r) {
  if (r && r.date) { const t = new Date(r.date + 'T00:00:00').getTime(); if (!isNaN(t)) return t; }
  return (r && r.createdAt) || 0;
}
// 同一店の判定キー（店名を正規化 ＋ 都道府県）
const normName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const groupKeyOf = (name, pref) => normName(name) + '|' + (pref || '');

/* ---------- EXIF: 写真の撮影日を読む（元ファイルから・ベストエフォート） ----------
   ※アプリ内で圧縮するとEXIFは消えるので、取り込み時に"元ファイル"から読む。
     スクショや一部の経路の写真は撮影日を持たない＝取れないこともある（その時はnull）。 */
async function readExifDate(file) {
  try {
    if (!file || !file.type || file.type.indexOf('jpeg') === -1) {
      // JPEG以外（HEIC/PNG等）はこの簡易パーサでは非対応
      return null;
    }
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    const len = view.byteLength;
    if (len < 4 || view.getUint16(0) !== 0xFFD8) return null; // JPEGでない

    let offset = 2;
    while (offset + 4 < len) {
      const marker = view.getUint16(offset);
      if ((marker & 0xFF00) !== 0xFF00) break;
      const size = view.getUint16(offset + 2);
      if (marker === 0xFFE1) { // APP1
        // "Exif\0\0" ?
        if (offset + 10 <= len && view.getUint32(offset + 4) === 0x45786966) {
          return parseExifDate(view, offset + 10, len);
        }
      }
      if (marker === 0xFFDA) break; // 画像データ開始＝これ以降にEXIFは無い
      offset += 2 + size;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function parseExifDate(view, tiff, len) {
  try {
    const le = view.getUint16(tiff) === 0x4949; // 'II'=little / 'MM'=big
    const g16 = (o) => view.getUint16(o, le);
    const g32 = (o) => view.getUint32(o, le);
    const readAscii = (o, n) => {
      let s = '';
      for (let i = 0; i < n && o + i < len; i++) {
        const c = view.getUint8(o + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    };
    const scanIFD = (ifd) => {
      const out = { exifPtr: 0, dt0132: '', dt9003: '' };
      if (ifd + 2 > len) return out;
      const n = g16(ifd);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > len) break;
        const tag = g16(e);
        if (tag === 0x8769) out.exifPtr = tiff + g32(e + 8);           // Exif sub-IFD
        else if (tag === 0x0132) out.dt0132 = readAscii(tiff + g32(e + 8), 19); // DateTime
        else if (tag === 0x9003) out.dt9003 = readAscii(tiff + g32(e + 8), 19); // DateTimeOriginal
      }
      return out;
    };
    const ifd0 = tiff + g32(tiff + 4);
    const a = scanIFD(ifd0);
    let dt = a.dt9003;
    if (a.exifPtr) { const b = scanIFD(a.exifPtr); if (b.dt9003) dt = b.dt9003; }
    if (!dt) dt = a.dt0132;
    const m = dt && dt.match(/^(\d{4}):(\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  } catch (_) {
    return null;
  }
}

/* ---------- 状態 ---------- */
const state = {
  restaurants: [],
  photoCounts: {},   // restaurantId -> 枚数
  firstPhoto: {},    // restaurantId -> Blob(先頭写真・サムネ用)
  regNumbers: {},    // restaurantId -> 登録順番号(1..N・動的)
  filterStatus: 'all',
  filterPref: '',
  filterGenre: '',
  filterRegion: '',  // 地方でまとめて絞り込み（全国制覇から）
  sortMode: 'reg',   // reg / date_desc / date_asc / pref / genre
  currentGroupId: null, // 詳細表示中のグループid
  filterBeforeConquest: null, // 制覇画面に入る前のフィルタ（閉じたら戻す）
  cal: { y: null, m: null, sel: null }, // カレンダー: 表示中の年/月(0-11)・選択中の日付(YYYY-MM-DD)
  viewMode: 'card',  // 表示モード: list / card / gallery
  view: { groups: [], rendered: 0 }, // 一覧の段階描画（無限スクロール）
  // 編集フォームの写真ステージング
  form: { photos: [], removed: [], dateManual: false }, // photos: {key, blob, dbId|null}
};

/* ---------- 読み込み ---------- */
async function loadAll() {
  // deleted(tombstone)は表示から除外。tombstone自体は同期のためIndexedDBに残す
  state.restaurants = (await dbGetAll('restaurants')).filter((r) => !r.deleted);

  // 移行: groupId が無いレコードに付与（店名+都道府県で束ねる／既存の重複も自動でまとまる）
  const missing = state.restaurants.filter((r) => !r.groupId);
  if (missing.length) {
    const keyToGid = {};
    state.restaurants.forEach((r) => {
      if (r.groupId) { const k = groupKeyOf(r.name, r.prefecture); if (!keyToGid[k]) keyToGid[k] = r.groupId; }
    });
    missing.sort((a, b) => a.createdAt - b.createdAt).forEach((r) => {
      const k = groupKeyOf(r.name, r.prefecture);
      if (!keyToGid[k]) keyToGid[k] = r.id;
      r.groupId = keyToGid[k];
    });
    for (const r of missing) await dbPut('restaurants', r);
  }

  // 登録順ナンバリング（createdAt昇順・動的・欠番なし）
  state.regNumbers = {};
  state.restaurants.slice().sort((a, b) => a.createdAt - b.createdAt)
    .forEach((r, i) => { state.regNumbers[r.id] = i + 1; });

  // 写真: レコードごとの枚数と先頭写真
  const photos = (await dbGetAll('photos')).filter((p) => !p.deleted && p.blob);
  state.photoCounts = {};
  state.firstPhoto = {};
  photos.sort((a, b) => a.createdAt - b.createdAt).forEach((p) => {
    state.photoCounts[p.restaurantId] = (state.photoCounts[p.restaurantId] || 0) + 1;
    if (!state.firstPhoto[p.restaurantId]) state.firstPhoto[p.restaurantId] = p.blob;
  });

  render();
}

/* ---------- グループ化（同じ店の複数訪問を束ねる） ---------- */
function groupMembers(gid) {
  return state.restaurants
    .filter((r) => (r.groupId || r.id) === gid)
    .sort((a, b) => visitTime(b) - visitTime(a)); // 新しい訪問が先頭
}

function buildGroups() {
  const map = new Map();
  for (const r of state.restaurants) {
    const gid = r.groupId || r.id;
    if (!map.has(gid)) map.set(gid, []);
    map.get(gid).push(r);
  }
  const groups = [];
  for (const [gid, members] of map) {
    members.sort((a, b) => visitTime(b) - visitTime(a));
    const latest = members[0];
    const rep = members.find((m) => m.genre) || latest;
    const totalPhotos = members.reduce((s, m) => s + (state.photoCounts[m.id] || 0), 0);
    const number = Math.min(...members.map((m) => state.regNumbers[m.id] || 1e9));
    let thumb = null;
    for (const m of members) { if (state.firstPhoto[m.id]) { thumb = state.firstPhoto[m.id]; break; } }
    groups.push({
      gid, members,
      name: latest.name, prefecture: latest.prefecture || '', genre: rep.genre || '',
      count: members.length, number,
      latestDate: displayDate(latest), latestSort: visitTime(latest),
      status: members.some((m) => m.status === 'visited') ? 'visited' : 'want',
      totalPhotos, thumb, memo: latest.memo || '',
    });
  }
  return groups;
}

function sortGroups(groups) {
  switch (state.sortMode) {
    case 'date_desc': groups.sort((a, b) => b.latestSort - a.latestSort); break;
    case 'date_asc':  groups.sort((a, b) => a.latestSort - b.latestSort); break;
    case 'pref':      groups.sort((a, b) => (a.prefecture || '￿').localeCompare(b.prefecture || '￿', 'ja') || b.number - a.number); break;
    case 'genre':     groups.sort((a, b) => (a.genre || '￿').localeCompare(b.genre || '￿', 'ja') || b.number - a.number); break;
    case 'reg':
    default:          groups.sort((a, b) => b.number - a.number); break; // 登録が新しい順（番号の大きい方が上）
  }
}

/* ---------- 一覧描画 ---------- */
function chip(text) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = text; return c; }

function statusBadge(status) {
  const b = document.createElement('span');
  b.className = 'badge ' + status;
  b.textContent = status === 'visited' ? '行った' : '行きたい';
  return b;
}

const RENDER_BATCH = 24; // 一度に描画する件数（残りはスクロールで追加）

function render() {
  const oldUrls = [..._listUrls]; _listUrls.clear();
  const list = $('#list');
  list.innerHTML = '';               // 先に古い<img>を外す

  let groups = buildGroups();
  if (state.filterStatus !== 'all') groups = groups.filter((g) => g.status === state.filterStatus);
  if (state.filterRegion && REGIONS[state.filterRegion]) {
    const set = REGIONS[state.filterRegion];
    groups = groups.filter((g) => set.includes(g.prefecture));
  } else if (state.filterPref) {
    groups = groups.filter((g) => g.prefecture === state.filterPref);
  }
  if (state.filterGenre) groups = groups.filter((g) => g.genre === state.filterGenre);
  sortGroups(groups);
  updateActiveFilterBar();

  $('#emptyState').hidden = groups.length !== 0;

  // 段階描画：まず先頭バッチだけ描き、残りはスクロールで追加（画像も遅延）
  state.view.groups = groups;
  state.view.rendered = 0;
  renderNextBatch();
  maybeLoadMore();

  // 旧URLは少し遅らせて解放（差し替え中の読み込み中断＝404ノイズを防ぐ）
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 1500);
}

function renderNextBatch() {
  const list = $('#list');
  const groups = state.view.groups;
  const end = Math.min(state.view.rendered + RENDER_BATCH, groups.length);
  const frag = document.createDocumentFragment();
  for (let i = state.view.rendered; i < end; i++) frag.appendChild(buildCard(groups[i]));
  list.appendChild(frag);
  state.view.rendered = end;
}

// 番兵がまだ画面近くにある間、残りをバッチで描き足す（初期表示・スクロール・モード切替で使用）
function maybeLoadMore() {
  const s = $('#listSentinel');
  if (!s) return;
  let guard = 0;
  while (state.view.rendered < state.view.groups.length) {
    if (s.getBoundingClientRect().top > window.innerHeight + 600) break;
    renderNextBatch();
    if (++guard > 25) break;
  }
}

function buildCard(g) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.gid = g.gid;

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';
  if (g.thumb) { const im = document.createElement('img'); im.decoding = 'async'; im.src = listURL(g.thumb); im.alt = ''; thumb.appendChild(im); }
  else thumb.textContent = g.status === 'visited' ? '🍽️' : '📍';

  const body = document.createElement('div');
  body.className = 'card-body';

  const name = document.createElement('h3');
  name.className = 'card-name';
  const num = document.createElement('span');
  num.className = 'card-num';
  num.textContent = '#' + g.number;
  name.appendChild(num);
  name.appendChild(document.createTextNode(' ' + g.name));
  if (g.count > 1) {
    const vb = document.createElement('span');
    vb.className = 'visit-badge';
    vb.textContent = g.count + '回';
    name.appendChild(vb);
  }

  const sub = document.createElement('div');
  sub.className = 'card-sub';
  sub.appendChild(statusBadge(g.status));
  if (g.genre) sub.appendChild(chip(g.genre));
  if (g.prefecture) sub.appendChild(chip(g.prefecture));
  if (g.latestDate) sub.appendChild(chip('📅 ' + g.latestDate));
  if (g.totalPhotos) sub.appendChild(chip('📷 ' + g.totalPhotos));

  body.appendChild(name);
  body.appendChild(sub);
  if (g.memo) { const m = document.createElement('p'); m.className = 'card-memo'; m.textContent = g.memo; body.appendChild(m); }

  card.appendChild(thumb);
  card.appendChild(body);
  card.addEventListener('click', () => openDetail(g.gid));
  return card;
}

/* ---------- 追加/編集フォーム（写真もここで管理） ---------- */
// r=編集対象レコード（新規はnull） / prefill={name,prefecture,genre}（「もう1回来た」用）
async function openEdit(r, prefill) {
  // 新規登録（＝訪問の追加も含む）は300件上限でブロック
  if (!r && state.restaurants.length >= MAX_STORES) {
    toast(`登録は${MAX_STORES}件までです。古い店を整理してね`);
    return;
  }
  $('#editTitle').textContent = r ? '店を編集' : (prefill ? 'もう1回来た（訪問を追加）' : '店を追加');
  $('#f_id').value = r ? r.id : '';
  $('#f_name').value = r ? r.name : (prefill ? prefill.name : '');
  $('#f_pref').value = r ? (r.prefecture || '') : (prefill ? (prefill.prefecture || '') : '');
  $('#f_genre').value = r ? (r.genre || '') : (prefill ? (prefill.genre || '') : '');
  $('#f_url').value = r ? (r.url || '') : '';
  $('#f_memo').value = r ? (r.memo || '') : '';
  const st = r ? r.status : (prefill ? 'visited' : 'want'); // 訪問追加なら"行った"を既定に
  document.querySelector(`input[name=f_status][value=${st}]`).checked = true;
  $('#deleteBtn').hidden = !r;

  // 日付: 既存店はその日付（無ければ登録日）、新規は今日
  $('#f_date').value = r ? ((r.date) || dateToStr(r.createdAt)) : todayStr();
  $('#f_dateNote').textContent = '';
  // 手入力があるまでは、写真を足したら撮影日で上書きしてよい（既存店でも）
  state.form.dateManual = false;

  // 写真ステージングを初期化（既存店なら現在の写真を読み込む）
  state.form.photos = [];
  state.form.removed = [];
  if (r) {
    const existing = (await dbGetByIndex('photos', 'byRestaurant', r.id)).sort((a, b) => a.createdAt - b.createdAt);
    state.form.photos = existing.map((p) => ({ key: p.id, blob: p.blob, dbId: p.id }));
  }
  renderFormPhotos();
  updatePhotoFieldVisibility();

  showModal('#editModal');
  if (!r) setTimeout(() => $('#f_name').focus(), 100);
}

// 写真欄は「行った」のときだけ表示（行きたい＝写真なし）
function updatePhotoFieldVisibility() {
  const status = document.querySelector('input[name=f_status]:checked').value;
  $('#photoField').hidden = status !== 'visited';
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
    im.addEventListener('click', () => openLightbox(state.form.photos.map((x) => x.blob), idx));
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
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 1500);
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

  // 追加した写真から撮影日を読み取り（手入力していなければ、最も古い撮影日を日付にセット）
  let exifDate = null;
  if (!state.form.dateManual) {
    for (const f of picked) {
      const d = await readExifDate(f);
      if (d && (!exifDate || d < exifDate)) exifDate = d;
    }
  }

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

  if (exifDate && !state.form.dateManual) {
    $('#f_date').value = exifDate;
    $('#f_dateNote').textContent = '📷 写真の撮影日';
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
  if (!existing && state.restaurants.length >= MAX_STORES) {
    toast(`登録は${MAX_STORES}件までです。古い店を整理してね`); return;
  }
  const prefecture = $('#f_pref').value;
  const status = document.querySelector('input[name=f_status]:checked').value;

  // 「行きたい」は写真なし。写真がある状態で行きたいにするなら削除確認
  const dropPhotos = (status === 'want') && state.form.photos.length > 0;
  if (dropPhotos && !confirm('「行きたい」に戻すと、この店のアプリ内の写真は削除されます（スマホの元の写真は消えません）。よろしいですか？')) {
    return;
  }

  // グループ判定: 既存編集は現状維持 / 新規は同名+同県があれば重ねる
  let groupId, mergedInto = null;
  if (existing) {
    groupId = existing.groupId || id;
  } else {
    const key = groupKeyOf(name, prefecture);
    const match = state.restaurants.find((r) => groupKeyOf(r.name, r.prefecture) === key);
    if (match) { groupId = match.groupId || match.id; mergedInto = match; }
    else groupId = id;
  }

  const rec = {
    id, name, prefecture, groupId,
    genre: $('#f_genre').value,
    url: $('#f_url').value.trim(),
    memo: $('#f_memo').value.trim(),
    status,
    date: $('#f_date').value || (existing && existing.date) || todayStr(),
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };
  await dbPut('restaurants', rec);

  if (status === 'want') {
    // 行きたい＝写真なし: この店の写真を全削除（ステージ中の新規は保存しない）
    const existingPhotos = await dbGetByIndex('photos', 'byRestaurant', id);
    for (const p of existingPhotos) await removePhoto(p.id);
  } else {
    // 写真の反映：削除 → 追加
    for (const delId of state.form.removed) await removePhoto(delId);
    for (const p of state.form.photos) {
      if (!p.dbId) {
        await dbPut('photos', { id: p.key, restaurantId: id, blob: p.blob, createdAt: Date.now(), updatedAt: Date.now(), deleted: false, uploaded: false });
      }
    }
  }
  state.form.photos = [];
  state.form.removed = [];

  hideModal('#editModal');
  await loadAll();
  if (window.RestoSync) RestoSync.scheduleSync();

  if (mergedInto) {
    const cnt = state.restaurants.filter((r) => (r.groupId || r.id) === groupId).length;
    toast(`「${name}」の${cnt}回目として記録`, { label: '別の店に分ける', fn: () => unstack(id) });
  } else {
    toast(existing ? '保存しました' : '追加しました');
  }
}

// 重なった訪問を別の店として切り離す（groupIdを自分だけに）
async function unstack(recordId) {
  const r = state.restaurants.find((x) => x.id === recordId);
  if (!r) return;
  r.groupId = r.id;
  r.updatedAt = Date.now();
  await dbPut('restaurants', r);
  hideModal('#detailModal');
  await loadAll();
  if (window.RestoSync) RestoSync.scheduleSync();
  toast('別の店として分けました');
}

async function deleteCurrent() {
  const id = $('#f_id').value;
  if (!id) return;
  const r = state.restaurants.find((x) => x.id === id);
  if (!confirm(`「${r ? r.name : 'この店'}」を写真ごと削除します。よろしい？`)) return;
  const photos = await dbGetByIndex('photos', 'byRestaurant', id);
  await Promise.all(photos.map((p) => removePhoto(p.id)));
  // 論理削除：レコードは残して deleted=true（＝相手端末へ削除を伝えるtombstone）
  if (r) { r.deleted = true; r.updatedAt = Date.now(); await dbPut('restaurants', r); }
  else { await dbDelete('restaurants', id); }
  hideModal('#editModal');
  await loadAll();
  if (window.RestoSync) RestoSync.scheduleSync();
  toast('削除しました');
}

/* ---------- 詳細（グループ＝複数訪問をまとめて表示） ---------- */
async function openDetail(gid) {
  const members = groupMembers(gid);
  if (!members.length) return;
  state.currentGroupId = gid;
  const rep = members.find((m) => m.genre) || members[0];

  $('#d_name').textContent = members[0].name;
  const anyVisited = members.some((m) => m.status === 'visited');
  const badge = $('#d_status');
  badge.className = 'badge ' + (anyVisited ? 'visited' : 'want');
  badge.textContent = anyVisited ? '行った' : '行きたい';

  const gEl = $('#d_genre');
  if (rep.genre) { gEl.textContent = rep.genre; gEl.hidden = false; } else gEl.hidden = true;
  $('#d_pref').textContent = members[0].prefecture || '未設定';
  const cEl = $('#d_count');
  if (members.length > 1) { cEl.textContent = members.length + '回訪問'; cEl.hidden = false; } else cEl.hidden = true;

  // 公開トグル（"行った"店だけ対象）
  const pubRow = $('#d_publishRow');
  if (anyVisited) { pubRow.hidden = false; $('#d_public').checked = members.some((m) => m.isPublic); }
  else pubRow.hidden = true;

  await renderVisits(members);
  showModal('#detailModal');
}

// 店(グループ)の公開/非公開を切り替え（写真も合わせる）→ 同期
async function setGroupPublic(gid, on) {
  if (!gid) return;
  const members = state.restaurants.filter((r) => (r.groupId || r.id) === gid);
  for (const r of members) {
    r.isPublic = on; r.updatedAt = Date.now();
    await dbPut('restaurants', r);
    const photos = await dbGetByIndex('photos', 'byRestaurant', r.id);
    for (const p of photos) { if (!p.deleted) { p.isPublic = on; p.updatedAt = Date.now(); await dbPut('photos', p); } }
  }
  if (window.RestoSync) RestoSync.scheduleSync();
  toast(on ? '公開しました（⋯から共有URLをコピーできます）' : '非公開にしました');
}

async function renderVisits(members) {
  const oldUrls = [..._viewUrls]; _viewUrls.clear();
  const wrap = $('#d_visits');
  wrap.innerHTML = '';
  const multi = members.length > 1;

  for (const r of members) {
    const photos = (await dbGetByIndex('photos', 'byRestaurant', r.id)).sort((a, b) => a.createdAt - b.createdAt);
    const blobs = photos.map((p) => p.blob);

    const block = document.createElement('div');
    block.className = 'visit';

    const head = document.createElement('div');
    head.className = 'visit-head';
    const left = document.createElement('div');
    left.className = 'visit-head-left';
    left.appendChild(chip('#' + (state.regNumbers[r.id] || '?')));
    left.appendChild(statusBadge(r.status));
    const ds = displayDate(r);
    if (ds) { const d = document.createElement('span'); d.className = 'visit-date'; d.textContent = '📅 ' + ds; left.appendChild(d); }
    head.appendChild(left);

    const actions = document.createElement('div');
    actions.className = 'visit-actions';
    const editB = document.createElement('button');
    editB.className = 'btn tiny';
    editB.textContent = '編集';
    editB.addEventListener('click', () => { hideModal('#detailModal'); openEdit(r); });
    actions.appendChild(editB);
    if (multi) {
      const sep = document.createElement('button');
      sep.className = 'btn tiny ghost';
      sep.textContent = '別の店に分ける';
      sep.addEventListener('click', () => unstack(r.id));
      actions.appendChild(sep);
    }
    head.appendChild(actions);
    block.appendChild(head);

    if (r.url) {
      const a = document.createElement('a');
      a.className = 'detail-url';
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = '🔗 リンクを開く';
      block.appendChild(a);
    }
    if (r.memo) { const m = document.createElement('p'); m.className = 'detail-memo'; m.textContent = r.memo; block.appendChild(m); }

    if (photos.length) {
      const grid = document.createElement('div');
      grid.className = 'photo-grid view';
      photos.forEach((p, i) => {
        const cell = document.createElement('div');
        cell.className = 'photo-cell';
        const im = document.createElement('img');
        im.src = viewURL(p.blob); im.alt = '';
        im.addEventListener('click', () => openLightbox(blobs, i));
        cell.appendChild(im);
        grid.appendChild(cell);
      });
      block.appendChild(grid);
    }

    wrap.appendChild(block);
  }
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 1500);
}

// 詳細で開いている店に「もう1回来た」を追加（同名+同県で自動的に重なる）
function addVisitToCurrentGroup() {
  const members = groupMembers(state.currentGroupId);
  if (!members.length) return;
  const base = members[0];
  hideModal('#detailModal');
  openEdit(null, { name: base.name, prefecture: base.prefecture || '', genre: base.genre || '' });
}

/* ---------- 写真の拡大表示（スワイプ移動/ピンチ/パン/ダブルタップ） ---------- */
const SWIPE_THRESHOLD = 55; // これ以上の横移動で次/前へ
const lb = {
  photos: [], index: 0, url: null,
  scale: 1, tx: 0, ty: 0,
  startDist: 0, startScale: 1, startTx: 0, startTy: 0,
  startX: 0, startY: 0, dragDX: 0, dragDY: 0,
  lastTap: 0, moved: false, downOnImage: false,
  closedAt: 0, // 拡大表示を閉じた時刻（ゴーストクリック対策）
};

function applyLb() {
  $('#lightboxImg').style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.scale})`;
}
function animateLb(on) {
  $('#lightboxImg').classList.toggle('animating', !!on);
}

function loadLbPhoto(i) {
  lb.index = i;
  const img = $('#lightboxImg');
  if (lb.url) URL.revokeObjectURL(lb.url);
  lb.url = URL.createObjectURL(lb.photos[i]);
  img.src = lb.url;
  lb.scale = 1; lb.tx = 0; lb.ty = 0;
  applyLb();
  const n = lb.photos.length;
  $('#lightboxCount').textContent = n > 1 ? `${i + 1} / ${n}` : '';
}

// blobs: この店の全写真, index: 開始位置
function openLightbox(blobs, index) {
  lb.photos = blobs.slice();
  animateLb(false);
  loadLbPhoto(index || 0);
  $('#lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const box = $('#lightbox');
  if (box.hidden) return;
  lb.closedAt = Date.now(); // 直後の背景タップ貫通で下のモーダルを閉じさせない
  box.hidden = true;
  $('#lightboxImg').src = '';
  if (lb.url) { URL.revokeObjectURL(lb.url); lb.url = null; }
  lb.photos = [];
  if ($('#detailModal').hidden && $('#editModal').hidden && $('#menuModal').hidden) {
    document.body.style.overflow = '';
  }
}

// dir: +1 次へ / -1 前へ。端なら弾んで戻る
function lbNav(dir) {
  const n = lb.photos.length;
  const i = lb.index + dir;
  animateLb(true);
  if (i < 0 || i >= n) { lb.tx = 0; applyLb(); return; }
  loadLbPhoto(i);
}

function touchDist(t) {
  return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
}

function bindLightbox() {
  const box = $('#lightbox');
  $('#lightboxClose').addEventListener('click', closeLightbox);

  box.addEventListener('touchstart', (e) => {
    animateLb(false);
    if (e.touches.length === 2) {
      lb.startDist = touchDist(e.touches);
      lb.startScale = lb.scale;
      lb.moved = true;
    } else if (e.touches.length === 1) {
      lb.moved = false;
      lb.downOnImage = (e.target && e.target.id === 'lightboxImg');
      lb.startX = e.touches[0].clientX; lb.startY = e.touches[0].clientY;
      lb.startTx = lb.tx; lb.startTy = lb.ty;
      lb.dragDX = 0; lb.dragDY = 0;
    }
  }, { passive: false });

  box.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const d = touchDist(e.touches);
      if (lb.startDist > 0) lb.scale = Math.min(5, Math.max(1, lb.startScale * (d / lb.startDist)));
      applyLb();
      return;
    }
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - lb.startX;
    const dy = e.touches[0].clientY - lb.startY;
    lb.dragDX = dx; lb.dragDY = dy;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) lb.moved = true;
    if (lb.scale > 1) {
      // 拡大中は1本指でパン
      lb.tx = lb.startTx + dx; lb.ty = lb.startTy + dy; applyLb();
    } else {
      // 等倍のときは横スワイプでめくる（指に画像を追従させる）
      lb.tx = dx; lb.ty = 0; applyLb();
    }
  }, { passive: false });

  box.addEventListener('touchend', (e) => {
    if (e.touches.length > 0) return;

    // 拡大中：パン確定のみ、ナビはしない
    if (lb.scale > 1) {
      if (!lb.moved) handleTap();
      return;
    }
    // 等倍：スワイプ or タップ
    if (lb.moved) {
      const horizontal = Math.abs(lb.dragDX) > Math.abs(lb.dragDY);
      if (horizontal && Math.abs(lb.dragDX) > SWIPE_THRESHOLD) {
        lbNav(lb.dragDX < 0 ? 1 : -1);   // 左スワイプ=次 / 右スワイプ=前
      } else {
        animateLb(true); lb.tx = 0; lb.ty = 0; applyLb(); // 戻す
      }
      return;
    }
    handleTap();
  });

  function handleTap() {
    const now = Date.now();
    if (now - lb.lastTap < 300 && lb.downOnImage) {
      if (lb.scale > 1) { lb.scale = 1; lb.tx = 0; lb.ty = 0; } else { lb.scale = 2.5; }
      animateLb(true); applyLb();
      lb.lastTap = 0;
    } else {
      lb.lastTap = now;
      if (!lb.downOnImage) closeLightbox(); // 画像の外を単タップ→閉じる
    }
  }

  // PC（マウス）：背景クリックで閉じる、左右端クリックでめくる補助はナシ（スワイプ主体）
  box.addEventListener('mousedown', (e) => { if (e.target === box) closeLightbox(); });
}

/* ---------- 全国制覇 ---------- */
function conquestByPref() {
  const m = {};
  for (const p of PREFECTURES) m[p] = { visited: false, want: false, count: 0 };
  for (const r of state.restaurants) {
    if (!r.prefecture || !m[r.prefecture]) continue;
    m[r.prefecture].count++;
    if (r.status === 'visited') m[r.prefecture].visited = true;
    else m[r.prefecture].want = true;
  }
  return m;
}
const prefState = (info) => (info.visited ? 'visited' : (info.want ? 'want' : 'none'));

function openConquest() {
  // 制覇に入る前のフィルタを覚えておく（閉じたら戻すため・初回のみ）
  if (!state.filterBeforeConquest) {
    state.filterBeforeConquest = {
      pref: state.filterPref, region: state.filterRegion,
      genre: state.filterGenre, status: state.filterStatus, sort: state.sortMode,
    };
  }
  const info = conquestByPref();
  const conquered = PREFECTURES.filter((p) => info[p].visited).length;
  $('#cq_count').textContent = conquered;
  $('#cq_pct').textContent = `（${Math.round(conquered / 47 * 100)}%）`;
  $('#cq_barfill').style.width = (conquered / 47 * 100) + '%';

  const CELL = 28;
  const svg = $('#cq_map');
  svg.innerHTML = '';
  // 可変サイズ [x,y,w,h] からビューポートを決める
  let maxX = 0, maxY = 0;
  for (const p of PREFECTURES) {
    const t = TILE_POS[p]; if (!t) continue;
    maxX = Math.max(maxX, t[0] + (t[2] || 1)); maxY = Math.max(maxY, t[1] + (t[3] || 1));
  }
  svg.setAttribute('viewBox', `0 0 ${maxX * CELL} ${maxY * CELL}`);

  for (const p of PREFECTURES) {
    const pos = TILE_POS[p];
    if (!pos) continue;
    const [x, y, w = 1, h = 1] = pos;
    const st = prefState(info[p]);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'tile tile-' + st);
    g.setAttribute('transform', `translate(${x * CELL}, ${y * CELL})`);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', 1); rect.setAttribute('y', 1);
    rect.setAttribute('width', w * CELL - 2); rect.setAttribute('height', h * CELL - 2);
    rect.setAttribute('rx', 4);

    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', w * CELL / 2); t.setAttribute('y', h * CELL / 2);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.textContent = (p === '北海道') ? '北海道' : p.slice(0, 2);

    g.appendChild(rect); g.appendChild(t);
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${p}（${st === 'visited' ? '制覇' : st === 'want' ? '狙い中' : '未開拓'}・${info[p].count}件）`;
    g.appendChild(title);
    g.addEventListener('click', () => filterToPref(p));
    svg.appendChild(g);
  }

  const rc = $('#cq_regions');
  rc.innerHTML = '';
  for (const [region, prefs] of Object.entries(REGIONS)) {
    const done = prefs.filter((p) => info[p].visited).length;
    const row = document.createElement('div');
    row.className = 'cq-region' + (done === prefs.length ? ' complete' : '');
    const nm = document.createElement('span'); nm.className = 'cq-region-name'; nm.textContent = region;
    const sc = document.createElement('span'); sc.className = 'cq-region-score'; sc.textContent = `${done}/${prefs.length}`;
    row.appendChild(nm); row.appendChild(sc);
    row.addEventListener('click', () => filterToRegion(region));
    rc.appendChild(row);
  }

  showModal('#conquestModal');
}

/* 全国制覇モードの表示ON/OFF（端末ごとの設定・localStorage） */
const CONQUEST_KEY = 'resto-log-conquest';
const conquestEnabled = () => localStorage.getItem(CONQUEST_KEY) !== '0'; // 既定ON
function applyConquestVisibility() {
  const on = conquestEnabled();
  $('#conquestBtn').hidden = !on;
  const toggle = $('#conquestToggle');
  if (toggle) toggle.checked = on;
}
function setConquestEnabled(on) {
  localStorage.setItem(CONQUEST_KEY, on ? '1' : '0');
  applyConquestVisibility();
}

/* ---------- カレンダー ---------- */
// 「行った」記録を日付(YYYY-MM-DD・無ければ登録日)ごとにまとめる
function visitsByDate() {
  const map = {};
  for (const r of state.restaurants) {
    if (r.status !== 'visited') continue;
    const ds = r.date || dateToStr(r.createdAt);
    if (!ds) continue;
    (map[ds] = map[ds] || []).push(r);
  }
  return map;
}

function openCalendar() {
  if (state.cal.y == null) {
    const now = new Date();
    state.cal.y = now.getFullYear();
    state.cal.m = now.getMonth();
  }
  state.cal.sel = null;
  renderCalendar();
  showModal('#calendarModal');
}

function shiftCalMonth(delta) {
  let { y, m } = state.cal;
  m += delta;
  if (m < 0) { m = 11; y--; }
  else if (m > 11) { m = 0; y++; }
  state.cal.y = y; state.cal.m = m; state.cal.sel = null;
  renderCalendar();
}

function selectCalDay(ds) {
  state.cal.sel = (state.cal.sel === ds) ? null : ds;
  renderCalendar();
}

function renderCalendar() {
  const { y, m } = state.cal;
  const byDate = visitsByDate();
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;

  $('#cal_title').textContent = `${y}年${m + 1}月`;
  let monthCount = 0;
  for (const ds in byDate) if (ds.startsWith(prefix + '-')) monthCount += byDate[ds].length;
  $('#cal_monthcount').textContent = monthCount ? `この月 ${monthCount}件の記録` : 'この月は記録なし';

  const grid = $('#cal_grid');
  grid.innerHTML = '';
  for (const w of ['日', '月', '火', '水', '木', '金', '土']) {
    const c = document.createElement('div'); c.className = 'cal-wd'; c.textContent = w; grid.appendChild(c);
  }
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  for (let i = 0; i < first; i++) {
    const c = document.createElement('div'); c.className = 'cal-cell cal-empty'; grid.appendChild(c);
  }
  for (let d = 1; d <= days; d++) {
    const ds = `${prefix}-${String(d).padStart(2, '0')}`;
    const items = byDate[ds] || [];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell' + (items.length ? ' has' : '') + (ds === today ? ' today' : '') + (ds === state.cal.sel ? ' sel' : '');
    const dn = document.createElement('span'); dn.className = 'cal-daynum'; dn.textContent = d;
    cell.appendChild(dn);
    if (items.length) {
      const dot = document.createElement('span'); dot.className = 'cal-dot';
      dot.textContent = items.length > 1 ? items.length : '';
      cell.appendChild(dot);
      cell.addEventListener('click', () => selectCalDay(ds));
    } else {
      cell.disabled = true;
    }
    grid.appendChild(cell);
  }
  renderCalDay(byDate);
}

function renderCalDay(byDate) {
  byDate = byDate || visitsByDate();
  const panel = $('#cal_day');
  panel.innerHTML = '';
  const ds = state.cal.sel;
  if (!ds) {
    const p = document.createElement('p'); p.className = 'cal-hint';
    p.textContent = '日付をタップすると、その日に行ったお店が出ます';
    panel.appendChild(p);
    return;
  }
  const items = (byDate[ds] || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
  const head = document.createElement('div'); head.className = 'cal-day-head';
  head.textContent = `${ds.replace(/-/g, '/')}（${items.length}件）`;
  panel.appendChild(head);
  for (const r of items) {
    const gid = r.groupId || r.id;
    const row = document.createElement('button'); row.type = 'button'; row.className = 'cal-day-item';
    const em = document.createElement('span'); em.className = 'cal-day-emoji'; em.textContent = '🍽️';
    const nm = document.createElement('span'); nm.className = 'cal-day-name'; nm.textContent = r.name;
    const wrap = document.createElement('span');
    wrap.appendChild(nm);
    if (r.prefecture) { const pf = document.createElement('span'); pf.className = 'cal-day-pref'; pf.textContent = r.prefecture; wrap.appendChild(pf); }
    row.appendChild(em); row.appendChild(wrap);
    row.addEventListener('click', () => { hideModal('#calendarModal'); openDetail(gid); });
    panel.appendChild(row);
  }
}

/* ---------- ダークモード（システム連動＋手動トグル） ---------- */
const THEME_KEY = 'resto-log-theme';
function storedTheme() { try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; } }
function systemDark() { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
function effectiveDark() { const t = storedTheme(); return t ? t === 'dark' : systemDark(); }
function applyTheme() {
  const t = storedTheme(); const root = document.documentElement;
  if (t) root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
}
function setDark(on) {
  try { localStorage.setItem(THEME_KEY, on ? 'dark' : 'light'); } catch (_) {}
  applyTheme();
  const tg = $('#darkToggle'); if (tg) tg.checked = on;
}
function applyThemeToggleState() { const tg = $('#darkToggle'); if (tg) tg.checked = effectiveDark(); }

/* ---------- 表示モード（リスト/カード/ギャラリー） ---------- */
const VIEW_KEY = 'resto-log-view';
const VIEW_MODES = ['list', 'card', 'gallery'];
function applyViewMode() {
  const m = VIEW_MODES.includes(state.viewMode) ? state.viewMode : 'card';
  const list = $('#list');
  list.classList.remove('mode-list', 'mode-card', 'mode-gallery');
  list.classList.add('mode-' + m);
  document.querySelectorAll('#viewModes .vm').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === m));
}
function setViewMode(m) {
  if (!VIEW_MODES.includes(m)) return;
  state.viewMode = m;
  try { localStorage.setItem(VIEW_KEY, m); } catch (_) {}
  applyViewMode();
  maybeLoadMore(); // モードで密度が変わるので、足りなければ描き足す
}
function initViewMode() {
  let saved = 'card';
  try { saved = localStorage.getItem(VIEW_KEY) || 'card'; } catch (_) {}
  state.viewMode = VIEW_MODES.includes(saved) ? saved : 'card';
  applyViewMode();
}

function resetStatusTabTo(status) {
  state.filterStatus = status;
  document.querySelectorAll('#statusTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.status === status));
}

function filterToPref(p) {
  state.filterRegion = '';
  state.filterPref = p;
  $('#prefFilter').value = p;
  resetStatusTabTo('all');
  render();
  hideModal('#conquestModal');
  toast(p + ' でしぼり込み');
}

function filterToRegion(region) {
  state.filterRegion = region;
  state.filterPref = '';
  $('#prefFilter').value = '';
  resetStatusTabTo('all');
  render();
  hideModal('#conquestModal');
  toast(region + ' でしぼり込み');
}

function updateActiveFilterBar() {
  const bar = $('#activeFilterBar');
  if (state.filterRegion) {
    $('#activeFilterLabel').textContent = '🗾 ' + state.filterRegion + ' で表示中';
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
}

// 制覇画面を閉じたら、入る前のフィルタに戻す
function restoreFromConquest() {
  const s = state.filterBeforeConquest;
  if (s) {
    state.filterPref = s.pref; state.filterRegion = s.region;
    state.filterGenre = s.genre; state.sortMode = s.sort;
    $('#prefFilter').value = s.pref; $('#genreFilter').value = s.genre; $('#sortSelect').value = s.sort;
    resetStatusTabTo(s.status);
    render();
  }
  state.filterBeforeConquest = null;
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
  const photosRaw = (await dbGetAll('photos')).filter((p) => !p.deleted && p.blob);
  const photos = [];
  for (const p of photosRaw) {
    photos.push({ id: p.id, restaurantId: p.restaurantId, createdAt: p.createdAt, dataURL: await blobToDataURL(p.blob) });
  }
  const payload = { app: 'resto-log', version: 2, exportedAt: new Date().toISOString(), restaurants, photos };
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
    await dbPut('photos', { id: p.id, restaurantId: p.restaurantId, createdAt: p.createdAt, updatedAt: p.createdAt || Date.now(), deleted: false, uploaded: false, blob: dataURLtoBlob(p.dataURL) });
  }
  hideModal('#menuModal');
  await loadAll();
  if (window.RestoSync) RestoSync.scheduleSync();
  toast(`復元しました（店 ${data.restaurants.length} 件）`);
}

async function updateMenuStat() {
  const r = await dbGetAll('restaurants');
  const p = (await dbGetAll('photos')).filter((x) => !x.deleted);
  let usage = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const mb = (est.usage || 0) / 1048576;
      usage = ` ・ 使用中 約${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
    }
  } catch (_) { /* 取れない環境は表示しない */ }
  $('#menuStat').textContent = `店 ${r.length}/${MAX_STORES} 件 ・ 写真 ${p.length} 枚${usage}（すべてこの端末内）`;
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

function initGenreOptions() {
  const filter = $('#genreFilter');
  const formSel = $('#f_genre');
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '未設定';
  formSel.appendChild(blank);
  for (const g of GENRES) {
    const o1 = document.createElement('option'); o1.value = g; o1.textContent = g; filter.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = g; o2.textContent = g; formSel.appendChild(o2);
  }
}

function bindEvents() {
  bindLightbox();
  $('#fab').addEventListener('click', () => openEdit(null));
  $('#editForm').addEventListener('submit', saveFromForm);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#f_photoInput').addEventListener('change', (e) => { addFormPhotos(e.target.files); e.target.value = ''; });
  $('#f_date').addEventListener('input', () => { state.form.dateManual = true; $('#f_dateNote').textContent = ''; });
  document.querySelectorAll('input[name=f_status]').forEach((el) =>
    el.addEventListener('change', updatePhotoFieldVisibility));

  $('#statusTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab'); if (!btn) return;
    document.querySelectorAll('#statusTabs .tab').forEach((t) => t.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.filterStatus = btn.dataset.status;
    state.filterBeforeConquest = null; // 手動操作で"戻す"予約は解除
    render();
  });
  $('#prefFilter').addEventListener('change', (e) => {
    state.filterPref = e.target.value; state.filterRegion = ''; // 県指定は地方指定と排他
    state.filterBeforeConquest = null; render();
  });
  $('#genreFilter').addEventListener('change', (e) => { state.filterGenre = e.target.value; state.filterBeforeConquest = null; render(); });
  $('#sortSelect').addEventListener('change', (e) => { state.sortMode = e.target.value; state.filterBeforeConquest = null; render(); });
  $('#activeFilterClear').addEventListener('click', () => {
    state.filterRegion = ''; state.filterBeforeConquest = null; render();
  });

  $('#addVisitBtn').addEventListener('click', addVisitToCurrentGroup);
  $('#d_public').addEventListener('change', (e) => setGroupPublic(state.currentGroupId, e.target.checked));

  $('#conquestBtn').addEventListener('click', openConquest);
  $('#conquestToggle').addEventListener('change', (e) => setConquestEnabled(e.target.checked));
  $('#calendarBtn').addEventListener('click', openCalendar);
  $('#cal_prev').addEventListener('click', () => shiftCalMonth(-1));
  $('#cal_next').addEventListener('click', () => shiftCalMonth(1));
  $('#darkToggle').addEventListener('change', (e) => setDark(e.target.checked));
  $('#viewModes').addEventListener('click', (e) => { const b = e.target.closest('.vm'); if (b) setViewMode(b.dataset.mode); });

  // 無限スクロール：番兵が画面に近づいたら次のバッチを描く
  const sentinel = $('#listSentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => { if (entries.some((en) => en.isIntersecting)) maybeLoadMore(); }, { rootMargin: '500px' });
    io.observe(sentinel);
  } else {
    window.addEventListener('scroll', () => maybeLoadMore(), { passive: true });
  }
  $('#menuBtn').addEventListener('click', () => { updateMenuStat(); applyConquestVisibility(); applyThemeToggleState(); if (window.RestoSync) RestoSync.renderPanel(); showModal('#menuModal'); });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', (e) => {
      const id = e.target.closest('.modal').id;
      if (id === 'conquestModal') restoreFromConquest(); // 制覇を閉じたら元のフィルタに戻す
      hideModal('#' + id);
    })
  );
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      // 拡大表示を閉じた直後のタップ貫通では閉じない（保存前の入力を守る）
      if (Date.now() - lb.closedAt < 500) return;
      if (e.target === m) {
        if (m.id === 'conquestModal') restoreFromConquest();
        hideModal('#' + m.id);
      }
    })
  );
}

async function init() {
  applyTheme();
  initPrefOptions();
  initGenreOptions();
  bindEvents();
  applyConquestVisibility();
  applyThemeToggleState();
  initViewMode();
  try {
    await loadAll();
  } catch (err) {
    console.error(err);
    toast('データの読み込みに失敗しました');
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW登録失敗', e));
  }
  if (window.RestoSync) { RestoSync.renderPanel(); RestoSync.init(); }
}

document.addEventListener('DOMContentLoaded', init);

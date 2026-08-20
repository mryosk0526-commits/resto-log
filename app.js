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

// 全国制覇: 都道府県タイルの配置（[列,行]・日本の形を模した並び）と地方区分
const TILE_POS = {
  '北海道': [12, 0],
  '青森県': [11, 2], '秋田県': [10, 3], '岩手県': [11, 3], '山形県': [10, 4], '宮城県': [11, 4], '福島県': [11, 5],
  '新潟県': [10, 5], '富山県': [9, 5], '石川県': [8, 5], '福井県': [8, 6],
  '群馬県': [10, 6], '栃木県': [11, 6], '茨城県': [12, 6],
  '長野県': [10, 7], '岐阜県': [9, 7], '埼玉県': [11, 7], '千葉県': [12, 7],
  '愛知県': [9, 8], '山梨県': [10, 8], '東京都': [11, 8],
  '静岡県': [10, 9], '神奈川県': [11, 9],
  '滋賀県': [8, 7], '京都府': [7, 7], '兵庫県': [6, 7],
  '大阪府': [7, 8], '奈良県': [8, 8], '三重県': [9, 9],
  '和歌山県': [7, 9],
  '鳥取県': [6, 6], '島根県': [5, 6], '岡山県': [5, 7], '広島県': [4, 7], '山口県': [3, 7],
  '香川県': [6, 8], '徳島県': [6, 9], '愛媛県': [5, 8], '高知県': [5, 9],
  '福岡県': [3, 8], '佐賀県': [2, 8], '長崎県': [1, 8], '熊本県': [2, 9], '大分県': [3, 9], '宮崎県': [3, 10], '鹿児島県': [2, 10],
  '沖縄県': [0, 11],
};
const REGIONS = {
  '北海道': ['北海道'],
  '東北': ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
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
  sortMode: 'reg',   // reg / date_desc / date_asc / pref / genre
  currentGroupId: null, // 詳細表示中のグループid
  // 編集フォームの写真ステージング
  form: { photos: [], removed: [], dateManual: false }, // photos: {key, blob, dbId|null}
};

/* ---------- 読み込み ---------- */
async function loadAll() {
  state.restaurants = await dbGetAll('restaurants');

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
  const photos = await dbGetAll('photos');
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

function render() {
  const oldUrls = [..._listUrls]; _listUrls.clear();
  const list = $('#list');
  list.innerHTML = '';               // 先に古い<img>を外す

  let groups = buildGroups();
  if (state.filterStatus !== 'all') groups = groups.filter((g) => g.status === state.filterStatus);
  if (state.filterPref) groups = groups.filter((g) => g.prefecture === state.filterPref);
  if (state.filterGenre) groups = groups.filter((g) => g.genre === state.filterGenre);
  sortGroups(groups);

  $('#emptyState').hidden = groups.length !== 0;
  for (const g of groups) list.appendChild(buildCard(g));

  // 旧URLは少し遅らせて解放（差し替え中の読み込み中断＝404ノイズを防ぐ）
  setTimeout(() => oldUrls.forEach((u) => URL.revokeObjectURL(u)), 1500);
}

function buildCard(g) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.gid = g.gid;

  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';
  if (g.thumb) { const im = document.createElement('img'); im.src = listURL(g.thumb); im.alt = ''; thumb.appendChild(im); }
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
    for (const p of existingPhotos) await dbDelete('photos', p.id);
  } else {
    // 写真の反映：削除 → 追加
    for (const delId of state.form.removed) await dbDelete('photos', delId);
    for (const p of state.form.photos) {
      if (!p.dbId) {
        await dbPut('photos', { id: p.key, restaurantId: id, blob: p.blob, createdAt: Date.now() });
      }
    }
  }
  state.form.photos = [];
  state.form.removed = [];

  hideModal('#editModal');
  await loadAll();

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
  toast('別の店として分けました');
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

  await renderVisits(members);
  showModal('#detailModal');
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
  const info = conquestByPref();
  const conquered = PREFECTURES.filter((p) => info[p].visited).length;
  $('#cq_count').textContent = conquered;
  $('#cq_pct').textContent = `（${Math.round(conquered / 47 * 100)}%）`;
  $('#cq_barfill').style.width = (conquered / 47 * 100) + '%';

  const CELL = 30;
  const svg = $('#cq_map');
  svg.innerHTML = '';
  for (const p of PREFECTURES) {
    const pos = TILE_POS[p];
    if (!pos) continue;
    const st = prefState(info[p]);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'tile tile-' + st);
    g.setAttribute('transform', `translate(${pos[0] * CELL}, ${pos[1] * CELL})`);

    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', 1); rect.setAttribute('y', 1);
    rect.setAttribute('width', CELL - 2); rect.setAttribute('height', CELL - 2);
    rect.setAttribute('rx', 4);

    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', CELL / 2); t.setAttribute('y', CELL / 2);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dominant-baseline', 'central');
    t.textContent = p.slice(0, 2);

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
    rc.appendChild(row);
  }

  showModal('#conquestModal');
}

function filterToPref(p) {
  state.filterPref = p;
  $('#prefFilter').value = p;
  state.filterStatus = 'all';
  document.querySelectorAll('#statusTabs .tab').forEach((t) => t.classList.toggle('is-active', t.dataset.status === 'all'));
  render();
  hideModal('#conquestModal');
  toast(p + ' でしぼり込み');
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
    await dbPut('photos', { id: p.id, restaurantId: p.restaurantId, createdAt: p.createdAt, blob: dataURLtoBlob(p.dataURL) });
  }
  hideModal('#menuModal');
  await loadAll();
  toast(`復元しました（店 ${data.restaurants.length} 件）`);
}

async function updateMenuStat() {
  const r = await dbGetAll('restaurants');
  const p = await dbGetAll('photos');
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
    render();
  });
  $('#prefFilter').addEventListener('change', (e) => { state.filterPref = e.target.value; render(); });
  $('#genreFilter').addEventListener('change', (e) => { state.filterGenre = e.target.value; render(); });
  $('#sortSelect').addEventListener('change', (e) => { state.sortMode = e.target.value; render(); });

  $('#addVisitBtn').addEventListener('click', addVisitToCurrentGroup);

  $('#conquestBtn').addEventListener('click', openConquest);
  $('#menuBtn').addEventListener('click', () => { updateMenuStat(); showModal('#menuModal'); });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', (e) => hideModal('#' + e.target.closest('.modal').id))
  );
  document.querySelectorAll('.modal').forEach((m) =>
    m.addEventListener('click', (e) => {
      // 拡大表示を閉じた直後のタップ貫通では閉じない（保存前の入力を守る）
      if (Date.now() - lb.closedAt < 500) return;
      if (e.target === m) hideModal('#' + m.id);
    })
  );
}

async function init() {
  initPrefOptions();
  initGenreOptions();
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

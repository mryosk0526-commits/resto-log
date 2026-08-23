'use strict';
/* 公開ビュー（読み取り専用）。?u={userId} の公開店を匿名で表示する。
   ・ログイン不要（anonクライアント）／is_public な行だけRLSで読める
   ・本体アプリと同じカードUI（リスト/カード/ギャラリー切替）＋写真の拡大表示
   ・写真は公開フラグのある物だけStorageから匿名で落とせる */
(async function () {
  const app = document.getElementById('app');
  const tools = document.getElementById('viewTools');
  const sub = document.getElementById('vsub');
  const bad = (m) => { app.innerHTML = '<p class="msg">' + m + '</p>'; };

  const uid = new URLSearchParams(location.search).get('u');
  if (!uid) return bad('共有リンクが正しくありません。');
  if (typeof supabase === 'undefined' || !(window.SUPABASE_URL || '').startsWith('https://')) return bad('設定エラーです。');

  const c = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  let rests, pmeta = [];
  try {
    const r = await c.from('restaurants').select('*').eq('user_id', uid).eq('is_public', true).eq('deleted', false);
    if (r.error) throw r.error;
    rests = r.data;
    const p = await c.from('photos').select('*').eq('user_id', uid).eq('is_public', true).eq('deleted', false);
    pmeta = p.error ? [] : p.data;
  } catch (e) { console.warn(e); return bad('読み込みに失敗しました。'); }

  if (!rests.length) return bad('公開されているお店がありません。');

  // グループ化（複数訪問を束ねる）
  const groups = new Map();
  for (const r of rests) { const g = r.group_id || r.id; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
  const photosByRest = {};
  for (const pm of pmeta) (photosByRest[pm.restaurant_id] = photosByRest[pm.restaurant_id] || []).push(pm);

  sub.textContent = `公開中のお店 ${groups.size} 軒`;

  // 表示用グループ（写真は撮影順で id を集める）
  const view = [];
  for (const [gid, members] of groups) {
    members.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const rep = members.find((m) => m.genre) || members[0];
    const latest = members[0];
    const photoIds = [];
    for (const m of members.slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0))) {
      for (const pm of (photosByRest[m.id] || []).sort((a, b) => (a.created_at || 0) - (b.created_at || 0))) photoIds.push(pm.id);
    }
    view.push({
      gid, name: latest.name, prefecture: rep.prefecture || '', genre: rep.genre || '',
      date: rep.date || '', memo: latest.memo || '', count: members.length, photoIds,
    });
  }

  // ---- Storage ダウンロード（idごとにキャッシュ） ----
  const urlCache = {};
  async function getPhotoURL(pid) {
    if (urlCache[pid]) return urlCache[pid];
    try {
      const { data: blob, error } = await c.storage.from('photos').download(`${uid}/${pid}.jpg`);
      if (!error && blob) { const u = URL.createObjectURL(blob); urlCache[pid] = u; return u; }
    } catch (_) {}
    return null;
  }

  // ---- 表示モード（本体と同じ localStorage キー） ----
  const VIEW_KEY = 'resto-log-view', MODES = ['list', 'card', 'gallery'];
  let mode = 'card';
  try { const s = localStorage.getItem(VIEW_KEY); if (MODES.includes(s)) mode = s; } catch (_) {}
  const list = document.createElement('div');
  app.innerHTML = ''; app.appendChild(list);
  tools.hidden = false;
  function applyMode(m) {
    mode = m; try { localStorage.setItem(VIEW_KEY, m); } catch (_) {}
    list.className = 'list mode-' + m;
    document.querySelectorAll('#viewModes .vm').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === m));
  }
  document.getElementById('viewModes').addEventListener('click', (e) => { const b = e.target.closest('.vm'); if (b) applyMode(b.dataset.mode); });
  applyMode(mode);

  // ---- カード描画（本体 buildCard と同じ構造） ----
  function chip(t) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = t; return s; }
  const thumbJobs = [];
  for (const g of view) {
    const card = document.createElement('article'); card.className = 'card'; card.dataset.gid = g.gid;

    const thumb = document.createElement('div'); thumb.className = 'card-thumb';
    if (g.photoIds.length) { const im = document.createElement('img'); im.decoding = 'async'; im.alt = ''; thumb.appendChild(im); thumbJobs.push({ im, pid: g.photoIds[0] }); }
    else thumb.textContent = '🍽️';

    const body = document.createElement('div'); body.className = 'card-body';
    const name = document.createElement('h3'); name.className = 'card-name'; name.textContent = g.name;
    if (g.count > 1) { const vb = document.createElement('span'); vb.className = 'visit-badge'; vb.textContent = g.count + '回'; name.appendChild(document.createTextNode(' ')); name.appendChild(vb); }

    const subEl = document.createElement('div'); subEl.className = 'card-sub';
    const badge = document.createElement('span'); badge.className = 'badge visited'; badge.textContent = '行った'; subEl.appendChild(badge);
    if (g.genre) subEl.appendChild(chip(g.genre));
    if (g.prefecture) subEl.appendChild(chip(g.prefecture));
    if (g.date) subEl.appendChild(chip('📅 ' + g.date.replace(/-/g, '/')));
    if (g.photoIds.length) subEl.appendChild(chip('📷 ' + g.photoIds.length));

    body.appendChild(name); body.appendChild(subEl);
    if (g.memo) { const m = document.createElement('p'); m.className = 'card-memo'; m.textContent = g.memo; body.appendChild(m); }

    card.appendChild(thumb); card.appendChild(body);
    if (g.photoIds.length) card.addEventListener('click', () => openLightbox(g.photoIds));
    list.appendChild(card);
  }

  // サムネ（各店の先頭写真）を順次ダウンロードして差し込む
  for (const j of thumbJobs) getPhotoURL(j.pid).then((u) => { if (u) j.im.src = u; });

  // ---- ライトボックス（タップで拡大・スワイプ/矢印で送る） ----
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightboxImg');
  const lbCount = document.getElementById('lightboxCount');
  let lbList = [], lbIdx = 0;
  async function showLb() {
    lbCount.textContent = (lbIdx + 1) + ' / ' + lbList.length;
    lbImg.removeAttribute('src');
    const u = await getPhotoURL(lbList[lbIdx]);
    if (u && lb && !lb.hidden) lbImg.src = u;
  }
  const lbPrev = document.getElementById('lightboxPrev');
  const lbNext = document.getElementById('lightboxNext');
  async function openLightbox(ids) {
    lbList = ids; lbIdx = 0; lb.hidden = false; document.body.style.overflow = 'hidden';
    const multi = lbList.length > 1;
    lbPrev.hidden = !multi; lbNext.hidden = !multi;
    await showLb();
  }
  function closeLb() { lb.hidden = true; document.body.style.overflow = ''; }
  function nav(d) { if (lbList.length < 2) return; lbIdx = (lbIdx + d + lbList.length) % lbList.length; showLb(); }
  document.getElementById('lightboxClose').addEventListener('click', closeLb);
  lbPrev.addEventListener('click', (e) => { e.stopPropagation(); nav(-1); });
  lbNext.addEventListener('click', (e) => { e.stopPropagation(); nav(1); });
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLb(); });
  let sx = null;
  lb.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 40) nav(dx < 0 ? 1 : -1); }, { passive: true });
  document.addEventListener('keydown', (e) => { if (lb.hidden) return; if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowRight') nav(1); else if (e.key === 'ArrowLeft') nav(-1); });
})();

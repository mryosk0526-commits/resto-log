'use strict';
/* 公開ビュー（読み取り専用）。?u={userId} の公開店を匿名で表示する。
   ・ログイン不要（anonクライアント）／is_public な行だけRLSで読める
   ・写真は公開フラグのある物だけStorageから匿名で落とせる */
(async function () {
  const root = document.getElementById('app');
  const sub = document.getElementById('vsub');
  const bad = (m) => { root.innerHTML = '<p class="msg">' + m + '</p>'; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

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
  for (const pm of pmeta) { (photosByRest[pm.restaurant_id] = photosByRest[pm.restaurant_id] || []).push(pm); }

  sub.textContent = `公開中のお店 ${groups.size} 軒`;
  root.innerHTML = '';
  const frag = document.createDocumentFragment();
  const toDownload = [];

  for (const [, members] of groups) {
    members.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    const rep = members.find((m) => m.genre) || members[0];
    const times = members.length > 1 ? `（${members.length}回）` : '';
    const card = document.createElement('div'); card.className = 'vcard';
    card.innerHTML =
      `<h3>${esc(members[0].name)}${times}</h3>
       <div class="vmeta">
         <span class="badge visited">行った</span>
         ${rep.prefecture ? `<span class="chip">${esc(rep.prefecture)}</span>` : ''}
         ${rep.genre ? `<span class="chip">${esc(rep.genre)}</span>` : ''}
         ${rep.date ? `<span class="chip">🗓 ${esc(rep.date)}</span>` : ''}
       </div>
       <div class="vphotos"></div>
       ${rep.memo ? `<p class="vmemo">${esc(rep.memo)}</p>` : ''}`;
    const ph = card.querySelector('.vphotos');
    for (const m of members) {
      for (const pm of (photosByRest[m.id] || [])) {
        const img = document.createElement('img'); img.alt = ''; ph.appendChild(img);
        toDownload.push({ img, path: `${uid}/${pm.id}.jpg` });
      }
    }
    if (!ph.children.length) ph.remove();
    frag.appendChild(card);
  }
  root.appendChild(frag);

  // 写真を落として差し込む（公開分だけ匿名で取得可）
  for (const t of toDownload) {
    try { const { data: blob, error } = await c.storage.from('photos').download(t.path); if (!error && blob) t.img.src = URL.createObjectURL(blob); }
    catch (_) {}
  }
})();

/* PMC Yellow Pages – web app. Uses the same /api/mobile/ endpoints as the Android app. */
(() => {
'use strict';

const API = '/api/mobile/';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const deviceId = (() => {
  let d = ls.get('pmc_device');
  if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : 'w' + Date.now() + Math.random().toString(16).slice(2)); ls.set('pmc_device', d); }
  return d;
})();
let token = ls.get('pmc_token');
let profile = (() => { try { return JSON.parse(ls.get('pmc_profile') || 'null'); } catch { return null; } })();

function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 3500);
}
const initials = n => (n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const abs = u => !u ? '' : /^https?:/.test(u) ? u : 'https://pmcyellowpages.com/' + u.replace(/^(\.\.\/|\/)+/, '');
const tel = p => String(p).replace(/[^\d+]/g, '');
const waNum = p => { const d = String(p).replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };
const fmtDate = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
const stars = n => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
const rupee = p => '₹' + (p / 100).toLocaleString('en-IN');

/* sanitise HTML coming from CMS / WordPress */
function clean(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach(n => n.remove());
  doc.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) el.removeAttribute(a.name);
    });
    if (el.tagName === 'IMG') el.src = abs(el.getAttribute('src')), el.loading = 'lazy';
    if (el.tagName === 'A') { el.target = '_blank'; el.rel = 'noopener'; }
  });
  return doc.body.innerHTML;
}

/* ---------- API ---------- */
let rid = 0;
async function api(path, { params = {}, body = null, files = null, shared = false } = {}) {
  const my = rid;
  const url = new URL(API + path, location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });
  const opt = { headers: { Accept: 'application/json' } };
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  if (body || files) {
    opt.method = 'POST';
    const fd = new FormData();
    Object.entries(body || {}).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(x => fd.append(k + '[]', x)); else if (v != null) fd.append(k, v);
    });
    fd.append('device_id', deviceId);
    Object.entries(files || {}).forEach(([k, f]) => f && fd.append(k, f, f.name));
    opt.body = fd;
  }
  let res, json;
  try { res = await fetch(url, opt); } catch { throw new Error('No internet connection. Please try again.'); }
  if (!shared && my !== rid) { const st = new Error('stale'); st.stale = true; throw st; }
  try { json = await res.json(); } catch { throw new Error('Unexpected server response (' + res.status + ').'); }
  if (!json.success) {
    if (res.status === 401 && token) logout(true);
    const e = new Error(json.message || 'Something went wrong.'); e.status = res.status; throw e;
  }
  return json.data || {};
}
const cache = {};
const cached = (k, fn) => cache[k] || (cache[k] = fn().catch(e => { delete cache[k]; throw e; }));
const boot = () => cached('boot', () => api('bootstrap', { shared: true }));

/* ---------- auth state ---------- */
function setAuth(t, p) {
  token = t; profile = p; ls.set('pmc_token', t); ls.set('pmc_profile', JSON.stringify(p)); renderAcct();
}
function logout(silent) {
  token = null; profile = null; ls.del('pmc_token'); ls.del('pmc_profile'); renderAcct();
  if (!silent) toast('Logged out'); else toast('Session expired. Please log in again.', true);
  if (location.hash.startsWith('#/account')) location.hash = '#/login';
}
function renderAcct() {
  const b = $('#acctBtn');
  b.textContent = token ? (profile?.name ? profile.name.split(' ')[0] : 'My Account') : 'Login';
  b.href = token ? '#/account' : '#/login';
}


const BADGE = 'https://pmcyellowpages.com/assets/frontend/images/';
/* original site badges: premium listings carry VERIFIED + TRUSTED, verified-only carries VERIFIED */
const badgeImgs = l => (l.is_verified || l.is_premium ? `<span class="vb"><img src="${BADGE}verified.webp" alt="PMC Verified" loading="lazy"></span>` : '') + (l.is_premium ? `<span class="vb"><img src="${BADGE}trusted.webp" alt="PMC Trusted" loading="lazy"></span>` : '');

/* ---------- components ---------- */
const loader = () => '<div class="wrap"><div class="spin" aria-label="Loading"></div></div>';
const errBox = (m, retry = true) => `<div class="wrap sec"><div class="empty"><b>Couldn't load this</b>${esc(m)}${retry ? '<br><br><button class="btn btn-navy" onclick="location.reload()">Try again</button>' : ''}</div></div>`;

function pageHead(title, sub, crumbs) {
  return `<section class="ph"><div class="wrap">${crumbs ? `<div class="crumb">${crumbs}</div>` : ''}<h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></section>`;
}

const IC = {
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 11 7.6-4M8.2 13l7.6 4"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></svg>',
};
const shareUrl = slug => location.origin + location.pathname + '#/b/' + encodeURIComponent(slug);
function listingCard(l) {
  const name = l.name || 'Unnamed listing';
  const href = `#/b/${encodeURIComponent(l.slug)}`;
  const phones = (l.phones || []);
  const upd = l.updated_at ? fmtDate(String(l.updated_at).replace(' ', 'T')) : '';
  return `<article class="bc ${l.is_premium ? 'prem' : ''}">
    <div class="bc-head">
      <a class="bc-img ${l.image ? '' : 'ph'}" href="${href}" aria-label="${esc(name)}">${l.image ? `<img loading="lazy" src="${esc(l.image)}" alt="">` : '<img class="emb" src="https://pmcyellowpages.com/assets/frontend/images/pwa/icon-512.png" alt="">'}</a>
      <div class="bc-t">
        <h3><a href="${href}">${esc(name)}</a></h3>
        <div class="cats">${esc(l.categories)}</div>
        ${(l.is_verified || l.is_premium) ? `<div class="badges bc-badges">${badgeImgs(l)}</div>` : ''}
      </div>
    </div>
    <ul class="bc-rows">
      ${l.address ? `<li><i>${IC.pin}</i><span>${esc(l.address)}${l.location ? ' — ' + esc(l.location) : ''}</span></li>` : ''}
      ${phones.length ? `<li><i>${IC.phone}</i><span>${phones.slice(0, 2).map(p => `<a href="tel:${tel(p)}">${esc(p)}</a>`).join(', ')}</span></li>` : ''}
      ${l.contact_name ? `<li><i>${IC.user}</i><span>${esc(l.contact_name)}</span></li>` : ''}
      ${upd ? `<li class="mut"><i>${IC.clock}</i><span>Updated ${esc(upd)}</span></li>` : ''}
    </ul>
    <div class="bc-act">
      ${phones[0] ? `<a class="a-call" href="tel:${tel(phones[0])}">${IC.phone}<span>Call</span></a>` : '<span class="a-call off">' + IC.phone + '<span>Call</span></span>'}
      ${l.whatsapp ? `<a class="a-wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(l.whatsapp)}">${IC.chat}<span>WhatsApp</span></a>` : '<span class="a-wa off">' + IC.chat + '<span>WhatsApp</span></span>'}
      <button class="a-sh" type="button" data-share="${esc(l.slug)}" data-name="${esc(name)}">${IC.share}<span>Share</span></button>
    </div></article>`;
}

function slider(el, imgs) {
  if (!imgs.length) { el.remove(); return; }
  const s = $('.slides', el), d = $('.dots', el); let i = 0, timer;
  d.innerHTML = imgs.map((_, k) => `<button aria-label="Slide ${k + 1}"></button>`).join('');
  const go = n => { i = (n + imgs.length) % imgs.length; s.style.transform = `translateX(-${i * 100}%)`; $$('button', d).forEach((b, k) => b.classList.toggle('on', k === i)); };
  $$('button', d).forEach((b, k) => b.onclick = () => { go(k); reset(); });
  const reset = () => { clearInterval(timer); if (imgs.length > 1) timer = setInterval(() => document.body.contains(el) ? go(i + 1) : clearInterval(timer), 4500); };
  go(0); reset();
}
const sliderHtml = (imgs, ar) => imgs.length ? `<div class="slider"${ar ? ` style="--ar:${ar}"` : ''}><div class="slides">${imgs.map(b => `<div class="sl"><i style="background-image:url('${esc(b.image)}')"></i><img loading="lazy" src="${esc(b.image)}" alt="Advertisement"></div>`).join('')}</div><div class="dots"></div></div>` : '';

function pager(hasMore, page, onMore) {
  return hasMore ? `<div class="more"><button class="btn btn-ghost" id="moreBtn">Load more</button></div>` : '';
}

/* ---------- search box (with autocomplete) ---------- */
const curCity = b => +(ls.get('pmc_city') || b.default_city || 61);
const areasCache = {};
async function areasFor(b, id) {
  if (id === b.default_city) return b.locations || [];
  if (!areasCache[id]) areasCache[id] = api('locations', { params: { city_id: id }, shared: true }).then(d => d.locations || []).catch(() => []);
  return areasCache[id];
}
const optsHtml = (list, sel, first) => (first ? `<option value="">${first}</option>` : '') + list.map(x => `<option value="${esc(x.name)}" ${x.name === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
function searchBox(b, q = '', loc = '') {
  const cid = curCity(b);
  return `<form class="searchbox" id="sf" role="search" autocomplete="off">
    <div class="f sel"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V8l6-3v16M10 21V3l10 4v14M7 11h0M7 15h0M14 9h2M14 13h2M14 17h2"/></svg></span><select id="sc" aria-label="City">${(b.cities || []).map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="f sel"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></span><select id="sl" aria-label="Area">${optsHtml(cid === b.default_city ? (b.locations || []) : [], loc, 'All areas')}</select></div>
    <div class="f grow"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span><input id="sq" name="q" value="${esc(q)}" placeholder="Search business, doctor, service…" aria-label="Search">
      <button type="button" class="mic" id="mic" aria-label="Search by voice" title="Search by voice" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
      <div class="sugg" id="sugg"></div></div>
    <button class="btn btn-yellow btn-lg" type="submit">Search</button></form>`;
}
/* highlight the typed words in a suggestion: bold + yellow underline (as on the original site) */
const reEsc = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hlText(t, q) {
  const words = String(q || '').split(/\s+/).filter(Boolean).map(reEsc);
  if (!words.length) return esc(t);
  return String(t).split(new RegExp('(' + words.join('|') + ')', 'gi')).map((x, i) => i % 2 ? `<mark class="eac-hl">${esc(x)}</mark>` : esc(x)).join('');
}
function bindSearch() {
  const f = $('#sf'); if (!f) return;
  const q = $('#sq'), sg = $('#sugg'); let tm, idx = -1;
  const sc = $('#sc');
  boot().then(b => { if (+sc.value !== b.default_city) areasFor(b, +sc.value).then(l => { $('#sl').innerHTML = optsHtml(l, '', 'All areas'); }); });
  sc.onchange = async () => { ls.set('pmc_city', sc.value); const b = await boot(); const sl = $('#sl'); sl.innerHTML = '<option value="">Loading…</option>'; sl.innerHTML = optsHtml(await areasFor(b, +sc.value), '', 'All areas'); };
  f.onsubmit = e => { e.preventDefault(); const v = q.value.trim(); if (!v) { q.focus(); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); q.placeholder = 'Type what you are looking for…'; return; } location.hash = `#/search?q=${encodeURIComponent(v)}&loc=${encodeURIComponent($('#sl').value)}`; };
  q.oninput = () => {
    clearTimeout(tm); const v = q.value.trim();
    if (v.length < 2) { sg.classList.remove('open'); return; }
    tm = setTimeout(async () => {
      try {
        const d = await api('suggest', { params: { q: v } });
        const it = d.items || [];
        sg.innerHTML = it.length ? it.map(s => `<a href="${s.type === 'C' ? '#/c/' : '#/b/'}${encodeURIComponent(s.slug)}"><span class="eac-item-text">${hlText(s.name, v)}</span><small class="eac-badge ${s.type === 'C' ? 'eac-badge-cat' : 'eac-badge-dir'}">${s.type === 'C' ? 'Category' : 'Business'}</small></a>`).join('') : '';
        sg.classList.toggle('open', it.length > 0); idx = -1;
      } catch {}
    }, 220);
  };
  q.onkeydown = e => {
    const a = $$('a', sg); if (!a.length || !sg.classList.contains('open')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + a.length) % a.length;
      a.forEach((x, k) => x.classList.toggle('act', k === idx));
    } else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); location.hash = a[idx].getAttribute('href'); }
    else if (e.key === 'Escape') sg.classList.remove('open');
  };
  document.addEventListener('click', e => { if (!f.contains(e.target)) sg.classList.remove('open'); });
  const mic = $('#mic'), SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (mic && SR) {
    mic.hidden = false; let rec = null;
    mic.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.maxAlternatives = 1;
      mic.classList.add('on'); q.placeholder = 'Listening…';
      rec.onresult = e => { q.value = Array.from(e.results).map(r => r[0].transcript).join(' '); q.dispatchEvent(new Event('input')); };
      rec.onerror = ev => { if (ev.error === 'not-allowed') toast('Allow microphone access to search by voice', true); };
      rec.onend = () => { mic.classList.remove('on'); q.placeholder = 'Search business, doctor, service…'; const done = rec; rec = null; if (q.value.trim() && done) f.requestSubmit(); };
      try { rec.start(); } catch { rec = null; mic.classList.remove('on'); }
    };
  }
}


const POP_SLUGS = ['doctor-dental', 'hospitals', 'hotels', 'restaurant', 'school', 'gym', 'beauty-parlour-spa', 'electronics'];
async function popular(b) {
  const have = new Set((b.categories || []).map(c => c.slug));
  const res = await Promise.all(POP_SLUGS.filter(x => have.has(x)).map(slug =>
    api('category', { params: { slug, page: 1 }, shared: true }).then(d => (d.items || []).map(i => ({ ...i, _cat: d.category?.name || '' }))).catch(() => [])));
  const seen = new Set(); const out = [];
  const ranked = res.map(r => r.filter(i => i.name && (i.is_premium || i.is_verified || i.image)).sort((a, b) => (b.is_premium - a.is_premium) || (b.is_verified - a.is_verified) || (!!b.image - !!a.image)));
  for (let k = 0; out.length < 8 && k < 6; k++) ranked.forEach(r => { const i = r[k]; if (i && !seen.has(i.id) && out.length < 8) { seen.add(i.id); out.push(i); } });
  return out;
}
const popCard = l => {
  const ph = (l.phones || [])[0];
  return `<article class="pc"><a class="pi" href="#/b/${encodeURIComponent(l.slug)}">${l.image ? `<img loading="lazy" src="${esc(l.image)}" alt="${esc(l.name)}">` : `<span>${esc(initials(l.name))}</span>`}</a>
    <div class="pb"><small>${esc(l._cat || l.categories)}</small><h3><a href="#/b/${encodeURIComponent(l.slug)}">${esc(l.name)}</a></h3>
    <p>📍 ${esc(l.location || l.city || '')}</p>
    ${(l.is_premium || l.is_verified) ? `<div class="badges pbadges">${badgeImgs(l)}</div>` : ''}
    <div class="row">${ph ? `<a class="btn btn-yellow btn-sm" href="tel:${tel(ph)}">📞 Call</a>` : ''}<a class="btn btn-ghost btn-sm" href="#/b/${encodeURIComponent(l.slug)}">View</a></div></div></article>`;
};
const plain = h => { const d = document.createElement('div'); d.innerHTML = h || ''; return (d.textContent || '').replace(/\s+/g, ' ').trim(); };
const readMin = h => Math.max(1, Math.round(plain(h).split(' ').length / 200));
const postBits = p => ({ title: plain(p.title), ex: plain(p.html).slice(0, 140) });
function blogFeature(posts) {
  const [f, ...rest] = posts; const fb = postBits(f);
  return `<div class="bf"><a class="bfm" href="#/news/${encodeURIComponent(f.slug)}">${f.image ? `<img loading="lazy" src="${esc(f.image)}" alt="">` : ''}<span class="tagp">Featured</span></a>
    <div class="bft"><div class="meta"><span class="tagc">News</span><small>${esc(fmtDate(f.date))} · ${readMin(f.html)} min read</small></div>
    <h3><a href="#/news/${encodeURIComponent(f.slug)}">${esc(fb.title)}</a></h3><p>${esc(fb.ex)}…</p><a class="btn btn-navy" href="#/news/${encodeURIComponent(f.slug)}">Read story →</a></div></div>
    <div class="bl">${rest.slice(0, 3).map(p => { const b = postBits(p); return `<a class="bli" href="#/news/${encodeURIComponent(p.slug)}"><div class="th">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}</div><div><small>${esc(fmtDate(p.date))}</small><h4>${esc(b.title)}</h4><span>Read more →</span></div></a>`; }).join('')}</div>`;
}

/* ---------- pages ---------- */
async function home() {
  main.innerHTML = loader();
  const b = await boot();
  const pop = (b.categories || []).filter(c => c.name.length < 20 && c.name !== c.name.toUpperCase()).slice(0, 6);
  const tiles = [['#/account/listing','<svg viewBox="0 0 24 24"><path d="M4 4h16l1 5a3 3 0 0 1-5.5 1.7A3 3 0 0 1 12 12a3 3 0 0 1-3.5-1.3A3 3 0 0 1 3 9zM5 13v7h6v-5h2v5h6v-7" /></svg>','Free<br>Listing'],['#/account/listing','<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6"/><path d="m12 6 1 2 2 .3-1.5 1.5.4 2.2L12 11l-1.9 1 .4-2.2L9 8.3l2-.3zM8.5 14 7 22l5-3 5 3-1.5-8"/></svg>','Premium<br>Listing'],['#/directory','<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8 17c.8-2 2.2-3 4-3s3.2 1 4 3M3 8h2M3 12h2M3 16h2"/></svg>','Important<br>Directory'],['#/advertise','<svg viewBox="0 0 24 24"><path d="M3 10v4h3l7 4V6L6 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>','Advertise<br>With Us']];
  main.innerHTML = `
  <section class="hero2"><div class="wrap hero2-g">
    <div class="hl">
      <span class="eyebrow">Rourkela's #1 business directory</span>
      <h1>Find <em>verified</em> local businesses near you</h1>
      <p class="lead">Doctors, shops, services and important numbers across Rourkela &amp; Odisha. Call or WhatsApp them directly — free.</p>
      ${searchBox(b)}
      <div class="chips">${pop.map(c => `<a class="chip" href="#/c/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>`).join('')}</div>
    </div>
    <div id="hb" class="hr">${sliderHtml(b.home_banners || [])}</div>
  </div></section>
  <section class="trust"><div class="wrap trust-g">
    <div><b>${(b.categories || []).length}+</b><span>Business categories</span></div>
    <div><b>Free</b><span>Listing for every business</span></div>
    <div><b>Direct</b><span>Call &amp; WhatsApp, no middleman</span></div>
    <div><b>Verified</b><span>PMC Verified &amp; Trusted badge</span></div>
  </div></section>
  <section class="wrap quickwrap"><div class="quick">${tiles.map(t => `<a href="${t[0]}"><i>${t[1]}</i><span>${t[2]}</span></a>`).join('')}</div></section>
  <section class="sec"><div class="wrap">
    <div class="sec-h"><h2 class="navyh">Browse all categories <small class="cnt">${(b.categories || []).length}</small></h2><input class="inp catf" id="hcf" placeholder="Filter categories…" aria-label="Filter categories"></div>
    <div class="cat-grid" id="hcg">${(b.categories || []).map(catTile).join('')}</div>
    <div class="more" id="hmore"><button class="btn btn-ghost btn-lg" id="hmoreBtn"></button></div>
  </div></section>
  <section class="sec alt"><div class="wrap"><div class="sec-h"><div><h2 class="navyh">Popular businesses</h2><p>Premium &amp; verified businesses people are calling right now</p></div></div><div class="pop" id="pop">${'<div class="sk" style="height:300px"></div>'.repeat(4)}</div></div></section>
  <section class="sec"><div class="wrap"><div class="band">
    <div><h2>Get more customers with a Premium Listing</h2><p>Stand out from the crowd and get discovered first when people search.</p>
      <a class="btn btn-yellow btn-lg" href="#/premium-listing">Get Premium Listing</a></div>
    <div><div class="price">${esc(b.config?.premium_price_label || '₹1499')} <small>/ lifetime</small></div><br>
      <ul><li>Photo gallery up to 30 images</li><li>PMC Verified &amp; Premium badges</li><li>Priority placement in search</li><li>Business hours, FAQs &amp; social links</li></ul></div>
  </div></div></section>
  <section class="sec alt"><div class="wrap"><div class="sec-h"><div><h2 class="navyh">Latest from our blog</h2><p>News, guides and stories from PMC News</p></div><a class="seeall" href="#/news">View all posts →</a></div><div id="hn" class="sk" style="height:380px"></div></div></section>`;
  const all = b.categories || []; let expanded = false, query = '';
  const drawCats = () => {
    const g = $('#hcg'); if (!g) return;
    const cols = Math.max(1, getComputedStyle(g).gridTemplateColumns.split(' ').length), limit = cols * 8;
    const r = all.filter(c => c.name.toLowerCase().includes(query));
    const show = (expanded || query) ? r : r.slice(0, limit);
    g.innerHTML = show.map(catTile).join('') || '<div class="empty" style="grid-column:1/-1"><b>No category found</b>Try a different word.</div>';
    const btn = $('#hmoreBtn'); $('#hmore').style.display = (query || r.length <= limit) ? 'none' : '';
    btn.textContent = expanded ? 'Show fewer categories' : `See more categories (${r.length - limit} more)`;
  };
  $('#hcf').oninput = e => { query = e.target.value.trim().toLowerCase(); drawCats(); };
  $('#hmoreBtn').onclick = () => { expanded = !expanded; drawCats(); if (!expanded) $('#hcg').scrollIntoView({ block: 'start' }); };
  window.addEventListener('resize', () => { clearTimeout(drawCats.t); drawCats.t = setTimeout(drawCats, 150); });
  drawCats();
  bindSearch(); slider($('#hb .slider') || document.createElement('div'), b.home_banners || []);
  popular(b).then(l => { const n = $('#pop'); if (!n) return; if (!l.length) { n.closest('section').remove(); return; } n.innerHTML = l.map(popCard).join(''); }).catch(() => { const n = $('#pop'); if (n) n.closest('section').remove(); });
  blog(b).then(p => { const n = $('#hn'); if (!n) return; n.className = ''; n.removeAttribute('style'); n.innerHTML = p.length ? blogFeature(p) : '<p>No posts right now.</p>'; }).catch(() => { const n = $('#hn'); if (n) n.closest('section').remove(); });
}
const catTile = c => `<a class="cat" href="#/c/${encodeURIComponent(c.slug)}"><div class="im">${c.image ? `<img loading="lazy" src="${esc(c.image)}" alt="">` : ''}</div><span>${esc(c.name)}</span></a>`;

async function categories() {
  main.innerHTML = loader();
  const b = await boot(); const all = b.categories || [];
  main.innerHTML = pageHead('All categories', `${all.length} categories of local businesses`) + `<section class="sec"><div class="wrap">
    <div class="cat-tools"><input class="inp" id="cf" placeholder="Filter categories…" style="max-width:420px"></div>
    <div class="letters" id="lt"></div><div class="cat-grid" id="cg"></div></div></section>`;
  const letters = [...new Set(all.map(c => c.name[0].toUpperCase()))].sort(); let L = '';
  const draw = () => {
    const q = $('#cf').value.trim().toLowerCase();
    const r = all.filter(c => (!L || c.name[0].toUpperCase() === L) && (!q || c.name.toLowerCase().includes(q)));
    $('#cg').innerHTML = r.map(catTile).join('') || '<div class="empty" style="grid-column:1/-1"><b>No category found</b>Try a different word.</div>';
    $('#lt').innerHTML = `<button class="${L ? '' : 'on'}" data-l="">All</button>` + letters.map(x => `<button class="${L === x ? 'on' : ''}" data-l="${x}">${x}</button>`).join('');
    $$('#lt button').forEach(bt => bt.onclick = () => { L = bt.dataset.l; draw(); });
  };
  $('#cf').oninput = draw; draw();
}

async function listPage({ title, fetcher, crumbs, withSide, sub, q }) {
  main.innerHTML = loader();
  const b = await boot(); const areas = await areasFor(b, curCity(b));
  const loc = new URLSearchParams(location.hash.split('?')[1] || '').get('loc') || '';
  const first = await fetcher(1, loc);
  const cityName = ((b.cities || []).find(c => c.id === curCity(b)) || {}).name || 'Rourkela';
  const ttl = typeof title === 'function' ? title(first) : title;
  const ads = (first.banners?.right || []).map(r => `<img loading="lazy" src="${esc(r.image)}" alt="Advertisement">`).join('');
  main.innerHTML = `<section class="listband"><div class="wrap">${searchBox(b, q || '', loc)}</div></section>
    <section class="lpage"><div class="wrap">
      <nav class="bcrumb" aria-label="Breadcrumb">${crumbs}<span>${esc(ttl)}</span></nav>
      <div class="lhead"><div><h1>${esc(ttl)}</h1></div>
        <button class="btn btn-ghost fbtn" id="fbtn" type="button">☰ Filters</button></div>
      <div class="lcols">
        <aside class="lfilters" id="lf"><div class="fcount"><b id="fcn">0</b><div><span>businesses</span><small id="fcs"></small></div></div><div class="fcard">
          <div class="fhead"><b>Filters</b><button type="button" class="linkbtn" id="freset">Reset</button></div>
          <div class="fgrp"><label for="fl">Area</label><select class="inp" id="fl">${optsHtml(areas, loc, 'All areas')}</select></div>
          <div class="fgrp"><label for="fq">Find in results</label><input class="inp" id="fq" placeholder="Name or address…"></div>
          <div class="fgrp"><label>Show only</label>
            <label class="opt-c"><input type="checkbox" id="fv"> PMC Verified</label>
            <label class="opt-c"><input type="checkbox" id="fp"> Premium</label>
            <label class="opt-c"><input type="checkbox" id="fw"> Has WhatsApp</label>
            <label class="opt-c"><input type="checkbox" id="fs"> Has website</label></div>
        </div>${withSide && ads ? `<div class="fads">${ads}</div>` : ''}</aside>
        <div class="lmain"><div class="grid2" id="ls"></div><div id="sentinel" aria-hidden="true"></div></div>
      </div>
    </div></section>`;
  bindSearch();
  const sl = $('.slider'); if (sl) slider(sl, first.banners.top);
  let page = 1, all = [], hasMore = false, total = first.total || 0;
  const area = () => $('#fl').value;
  const draw = () => {
    const f = { v: $('#fv').checked, p: $('#fp').checked, w: $('#fw').checked, s: $('#fs').checked, q: $('#fq').value.trim().toLowerCase() };
    const r = all.filter(i => (!f.v || i.is_verified || i.is_premium) && (!f.p || i.is_premium) && (!f.w || i.whatsapp) && (!f.s || i.website)
      && (!f.q || (i.name + ' ' + (i.address || '') + ' ' + (i.contact_name || '')).toLowerCase().includes(f.q)));
    const filtered = f.v || f.p || f.w || f.s || f.q;
    const shown = total || all.length;
    $('#fcn').textContent = shown; $('#fcs').textContent = filtered ? `${r.length} matching of ${all.length} loaded` : `in ${cityName}${area() ? ' · ' + area() : ''} · showing ${Math.min(all.length, shown)}`;
    const pct = Math.min(100, Math.round(all.length / Math.max(shown, all.length, 1) * 100));
    $('#ls').innerHTML = (r.map(listingCard).join('') || '<div class="empty" style="grid-column:1/-1"><b>No businesses found</b>Try another area or clear a filter.</div>')
      + (hasMore ? `<div class="morecard"><div><b>Showing ${all.length} of ${shown}</b><span>${filtered ? 'Filters apply to the businesses loaded so far.' : 'Keep going to see every business in this list.'}</span><div class="bar"><i style="width:${pct}%"></i></div></div><button class="btn btn-navy btn-lg" id="moreBtn" type="button">Load more businesses</button></div>` : '');
    const m = $('#moreBtn'); if (m) m.onclick = loadMore;
    $$('[data-share]').forEach(x => x.onclick = async () => {
      const u = shareUrl(x.dataset.share);
      if (navigator.share) { try { await navigator.share({ title: x.dataset.name, url: u }); } catch {} }
      else { try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { toast(u); } }
    });
  };
  const set = (d, append) => { const n = (d.items || []).filter(i => i.name); all = append ? all.concat(n) : n; hasMore = !!(d.hasMore ?? d.has_more); if (d.total) total = d.total; draw(); };
  let loading = false, io = null;
  const watch = () => { const se = $('#sentinel'); if (io && se) { io.unobserve(se); io.observe(se); } };
  const loadMore = async () => {
    if (loading || !hasMore) return; loading = true;
    const m = $('#moreBtn'); if (m) { m.disabled = true; m.textContent = 'Loading…'; }
    try { page++; set(await fetcher(page, area()), true); } catch (e) { toast(e.message, true); page--; draw(); }
    loading = false; watch();
  };
  const reload = async v => {
    $('#fl').value = v; const s2 = $('#sl'); if (s2) s2.value = v;
    $('#ls').innerHTML = '<div class="sk" style="height:280px"></div><div class="sk" style="height:280px"></div>'; page = 1;
    try { total = 0; set(await fetcher(1, v), false); } catch (er) { toast(er.message, true); }
  };
  set(first, false);
  if ('IntersectionObserver' in window) { io = new IntersectionObserver(es => { if (es[0].isIntersecting) loadMore(); }, { rootMargin: '600px 0px' }); watch(); }
  ['fv', 'fp', 'fw', 'fs'].forEach(id => $('#' + id).onchange = draw);
  $('#fq').oninput = draw;
  $('#fl').onchange = e => reload(e.target.value);
  $('#sl').onchange = e => reload(e.target.value);
  $('#freset').onclick = () => { ['fv', 'fp', 'fw', 'fs'].forEach(id => $('#' + id).checked = false); $('#fq').value = ''; if (area()) reload(''); else draw(); };
  $('#fbtn').onclick = () => $('#lf').classList.toggle('open');
}
const search = q => listPage({
  title: () => `Results for “${q.get('q')}”`, sub: d => '', crumbs: '<a href="#/">Home</a><i>/</i>', withSide: false, q: q.get('q'),
  fetcher: (p, loc) => api('search', { params: { q: q.get('q'), location: loc, page: p } }),
});
const category = (slug) => listPage({
  title: d => d.category?.name || 'Category', sub: d => d.total ? d.total + ' businesses' : '',
  crumbs: '<a href="#/">Home</a><i>/</i>', withSide: true,
  fetcher: (p, loc) => api('category', { params: { slug, location: loc, page: p } }),
});

Object.assign(IC, {
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 5.8-8 11-8 11z"/></svg>',
  dir: '<svg viewBox="0 0 24 24"><path d="M12 3 4 20l8-4 8 4z"/></svg>',
});
const GENERAL_FAQS = name => [
  { question: `How can I contact ${name}?`, answer: 'Use the Call or WhatsApp buttons on this page. Phone numbers, address and business hours are listed in the details section.' },
  { question: 'What does the PMC Verified & Trusted badge mean?', answer: 'Businesses with the PMC Verified and Trusted badges have been checked by the PMC Yellow Pages team, so you can contact them with more confidence.' },
  { question: 'How do I get a business listed on PMC Yellow Pages?', answer: 'Adding a business is free. Choose Free Listing from the menu, log in with your mobile number and submit your details. Our team reviews and publishes it. Premium Listing adds a photo gallery, badges and priority placement.' },
  { question: 'The information on this page is wrong. What should I do?', answer: 'If you own this business, log in and edit your listing from My Listings Dashboard. Otherwise call us on 9437404000, 9437505000 or 9437606000 and we will correct it.' },
  { question: 'Can I leave a review for this business?', answer: 'Yes. Scroll to Write a review, give a star rating and share your experience. Reviews are published after admin approval.' },
];
async function detail(slug) {
  main.innerHTML = loader();
  const { listing: l } = await api('listing', { params: { slug } });
  document.title = `${l.name} – PMC Yellow Pages`;
  const phones = l.phones || [];
  const photos = [...new Set([l.cover, ...(l.gallery || []).map(g => g.url)].filter(Boolean))];
  const site = l.website ? (/^https?:/.test(l.website) ? l.website : 'https://' + l.website) : '';
  const fullAddr = [l.address, l.location, l.pincode].filter(Boolean).join(', ');
  const mapQ = encodeURIComponent([l.name, l.address, l.city].filter(Boolean).join(', '));
  const upd = l.updated_at ? fmtDate(String(l.updated_at).replace(' ', 'T')) : '';
  const liked = ls.get('pmc_like_' + l.id) === '1';
  const ownFaq = !!(l.faqs && l.faqs.length);
  const faqs = ownFaq ? l.faqs : GENERAL_FAQS(l.name);
  const soc = l.social && typeof l.social === 'object' ? Object.entries(l.social).filter(([, v]) => v) : [];
  const cats = (l.categories || []).map(c => `<a class="tag" href="#/c/${encodeURIComponent(c.slug)}">${esc(c.name)}</a>`).join('');
  const row = (ico, label, val) => val ? `<li><i>${IC[ico]}</i><div><small>${label}</small><span>${val}</span></div></li>` : '';
  const emblem = 'https://pmcyellowpages.com/assets/frontend/images/pwa/icon-512.png';

  main.innerHTML = `
  <div class="dx-crumb"><div class="wrap"><nav class="bcrumb"><a href="#/">Home</a><i>/</i>${(l.categories || [])[0] ? `<a href="#/c/${encodeURIComponent(l.categories[0].slug)}">${esc(l.categories[0].name)}</a><i>/</i>` : ''}<span>${esc(l.name)}</span></nav></div></div>
  <section class="dx-top"><div class="wrap dx-grid">
    <div class="dx-media">
      ${photos.length ? `<div class="gcar" id="gcar"><div class="gtrack">${photos.map((u, i) => `<div class="gs ${i === 0 && l.cover ? 'bn' : 'pic'}"><i style="background-image:url('${esc(u)}')"></i><img src="${esc(u)}" alt="${esc(l.name)}"></div>`).join('')}</div>${photos.length > 1 ? `<button class="gn gp" aria-label="Previous photo">‹</button><button class="gn gx" aria-label="Next photo">›</button>` : ''}<span class="gc" id="gc">1/${photos.length}</span></div>
        ${photos.length > 1 ? `<div class="gthumbs" id="gth">${photos.slice(0, 12).map((u, i) => `<button type="button" class="${i ? '' : 'on'}" data-i="${i}" aria-label="Photo ${i + 1}"><img loading="lazy" src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}`
      : `<div class="dx-ph"><img src="${emblem}" alt=""><b>${esc(l.name)}</b><span>No photos added yet</span></div>`}
    </div>
    <div class="dx-info card">
      <h1>${esc(l.name)}</h1>
      <div class="tags">${cats}</div>
      ${(l.is_verified || l.is_premium) ? `<div class="badges big dx-badges">${badgeImgs(l)}</div>` : ''}
      <div class="dx-stats">
        ${l.rating_count ? `<div><b>${Number(l.rating_avg).toFixed(1)}</b><span class="stars">${stars(l.rating_avg)}</span><small>${l.rating_count} reviews</small></div>` : ''}
        <div><b id="lk">${l.likes}</b><small>Likes</small></div>
        ${l.established && l.established !== '0' ? `<div><b>${esc(l.established)}</b><small>Established</small></div>` : ''}
      </div>
      <div class="dx-btns">
        ${phones[0] ? `<a class="btn btn-yellow dx-cta" href="tel:${tel(phones[0])}">${IC.phone}Call now</a>` : ''}
        ${l.whatsapp ? `<a class="btn btn-wa dx-cta" target="_blank" rel="noopener" href="https://wa.me/${waNum(l.whatsapp)}?text=${encodeURIComponent('Hi, I found you on PMC Yellow Pages.')}">${IC.chat}WhatsApp</a>` : ''}
        <a class="btn btn-ghost dx-cta" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${mapQ}">${IC.dir}Directions</a>
        <button class="btn btn-ghost" id="likeBtn" type="button">${IC.heart}<span id="lkt">${liked ? 'Liked' : 'Like'}</span></button><button class="btn btn-ghost" id="shBtn" type="button">${IC.share}Share</button>
      </div>
    </div>
  </div></section>

  <section class="dx-body"><div class="wrap dx-cols">
    <div class="dx-main">
      ${(() => { const ab = l.about || `${l.name} is listed on PMC Yellow Pages${(l.categories || [])[0] ? ' under ' + l.categories[0].name : ''}${fullAddr ? ', located at ' + fullAddr : ''}. Call or WhatsApp the business directly for services, prices and availability.`; const long = ab.length > 320; return `<div class="card aboutc"><h2 class="h-sm">About ${esc(l.name)}</h2><div class="about${long ? ' clamp' : ''}" id="abt">${esc(ab)}</div>${long ? '<button type="button" class="more-t" id="abtT" aria-expanded="false">Show more <span>▾</span></button>' : ''}</div>`; })()}
      <div class="card"><h2>Business details</h2><ul class="dx-rows">
        ${row('pin', 'Address', esc(fullAddr))}
        ${phones.map((p, i) => row('phone', i ? 'Phone ' + (i + 1) : 'Phone', `<a href="tel:${tel(p)}">${esc(p)}</a>`)).join('')}
        ${row('mail', 'Email', l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : '')}
        ${row('globe', 'Website', site ? `<a target="_blank" rel="noopener" href="${esc(site)}">${esc(l.website)}</a>` : '')}
        ${row('user', 'Contact person', esc(l.contact_name))}
        ${row('clock', 'Business hours', esc(l.business_hours))}
        ${row('cal', 'Established', l.established && l.established !== '0' ? esc(l.established) : '')}
        ${row('clock', 'Last updated', esc(upd))}
      </ul></div>
      <div class="card faq"><h2>${ownFaq ? 'Frequently asked questions' : 'General FAQs'}</h2>${faqs.map((f, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(f.question)}</summary><p>${esc(f.answer)}</p></details>`).join('')}</div>
      <div class="card"><h2>Ratings &amp; reviews</h2>
        <div class="rsum">${l.rating_count ? `<div class="big">${Number(l.rating_avg).toFixed(1)}</div><div><span class="stars lg">${stars(l.rating_avg)}</span><small>${l.rating_count} reviews</small></div>` : '<div><b>No reviews yet</b><small>Be the first to review this business.</small></div>'}</div>
        <div id="rv"><div class="spin" style="margin:20px auto"></div></div>
        <hr class="hr"><h3 style="font-size:1.05rem">Write a review</h3>
        <form class="form" id="rf"><div class="starsel" id="ss" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(n => `<span data-n="${n}" role="radio" aria-label="${n} star">★</span>`).join('')}</div>
          <div class="g2"><input class="inp" name="name" placeholder="Your name" required maxlength="60"><input class="inp" name="mobile" placeholder="Mobile number" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required></div>
          <textarea class="inp" name="review" placeholder="Share your experience…" required minlength="5" maxlength="1000"></textarea>
          <button class="btn btn-navy" style="justify-self:start">Submit review</button><small style="color:var(--mut)">Reviews are published after admin approval.</small></form></div>
      ${l.similar && l.similar.filter(s => s.name).length ? `<div class="simil"><h2 class="navyh">Similar businesses</h2><div class="grid2">${l.similar.filter(s => s.name).slice(0, 6).map(listingCard).join('')}</div></div>` : ''}
    </div>
    <aside class="dx-side">
      ${(l.email || site || soc.length) ? `<div class="card"><h2>Online</h2>
        ${l.email ? `<a class="btn btn-ghost btn-block" href="mailto:${esc(l.email)}">${IC.mail}Send email</a>` : ''}
        ${site ? `<a class="btn btn-ghost btn-block" target="_blank" rel="noopener" href="${esc(site)}">${IC.globe}Visit website</a>` : ''}
        ${soc.length ? `<div class="socials">${soc.map(([k, v]) => `<a class="chip" target="_blank" rel="noopener" href="${esc(v)}">${esc(k)}</a>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="card mapcard"><h2>Location</h2><div class="mapbox"><iframe loading="lazy" title="Map" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${mapQ}&output=embed"></iframe></div></div>
      <div class="card claim"><b>Is this your business?</b><span>Log in to edit details, add photos and get the Verified &amp; Trusted badges.</span><a class="btn btn-yellow btn-block" href="#/account">Manage listing</a></div>
    </aside>
  </div></section>
  <div class="actbar">${phones[0] ? `<a class="btn btn-yellow" href="tel:${tel(phones[0])}">${IC.phone}Call</a>` : ''}${l.whatsapp ? `<a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(l.whatsapp)}">${IC.chat}WhatsApp</a>` : ''}<a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${mapQ}" aria-label="Directions">${IC.dir}</a></div>`;

  // carousel + thumbnails + zoom
  const gc = $('#gcar');
  if (gc) {
    let gi = 0; const tr = $('.gtrack', gc);
    const go = n => { gi = (n + photos.length) % photos.length; tr.style.transform = `translateX(-${gi * 100}%)`; $('#gc').textContent = (gi + 1) + '/' + photos.length; $$('#gth button').forEach((b, k) => b.classList.toggle('on', k === gi)); };
    if (photos.length > 1) { $('.gp', gc).onclick = () => go(gi - 1); $('.gx', gc).onclick = () => go(gi + 1); }
    $$('#gth button').forEach(b => b.onclick = () => go(+b.dataset.i));
    let sx = 0; gc.ontouchstart = e => { sx = e.touches[0].clientX; }; gc.ontouchend = e => { const d = e.changedTouches[0].clientX - sx; if (Math.abs(d) > 40 && photos.length > 1) go(gi + (d < 0 ? 1 : -1)); };
    $$('.gs img', gc).forEach(im => im.onclick = () => { const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<img src="${esc(im.src)}" alt="">`; m.onclick = () => m.remove(); document.body.append(m); });
  }
  // share buttons on the similar-business cards
  $$('.simil [data-share]').forEach(x => x.onclick = async () => {
    const u = shareUrl(x.dataset.share);
    if (navigator.share) { try { await navigator.share({ title: x.dataset.name, url: u }); } catch {} }
    else { try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { toast(u); } }
  });
  // About: show more / show less
  const abt = $('#abt'), abtT = $('#abtT');
  if (abt && abtT) abtT.onclick = () => {
    const open = abt.classList.toggle('open');
    abtT.setAttribute('aria-expanded', open);
    abtT.innerHTML = open ? 'Show less <span>▴</span>' : 'Show more <span>▾</span>';
    if (!open) abt.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // like + share
  $('#likeBtn').onclick = async () => {
    const was = ls.get('pmc_like_' + l.id) === '1';
    try { const d = await api('like', { body: { dir_id: l.id, action: was ? 'unlike' : 'like' } }); ls.set('pmc_like_' + l.id, was ? '0' : '1'); $('#lk').textContent = d.likes; $('#lkt').textContent = was ? 'Like' : 'Liked'; }
    catch (e) { toast(e.message, true); }
  };
  $('#shBtn').onclick = async () => {
    const u = l.share_url || shareUrl(l.slug);
    if (navigator.share) { try { await navigator.share({ title: l.name, url: u }); } catch {} }
    else { try { await navigator.clipboard.writeText(u); toast('Link copied'); } catch { toast(u); } }
  };
  // reviews
  let rating = 0;
  $$('#ss span').forEach(s => s.onclick = () => { rating = +s.dataset.n; $$('#ss span').forEach(x => x.classList.toggle('on', +x.dataset.n <= rating)); });
  api('reviews', { params: { dir_id: l.id, page: 1 } }).then(d => {
    const r = $('#rv'); if (!r) return;
    r.innerHTML = d.items.length ? d.items.map(x => `<div class="rev"><b>${esc(x.name)}</b> <span class="stars">${stars(x.rating)}</span> <small>${esc(x.date ? fmtDate(x.date) : '')}</small><p style="margin:6px 0 0">${esc(x.review)}</p></div>`).join('') : '';
  }).catch(() => { const r = $('#rv'); if (r) r.innerHTML = ''; });
  $('#rf').onsubmit = async e => {
    e.preventDefault(); if (!rating) return toast('Please select a star rating', true);
    const f = new FormData(e.target), btn = e.target.querySelector('button'); btn.disabled = true;
    try { await api('review_add', { body: { dir_id: l.id, name: f.get('name'), mobile: f.get('mobile'), rating, review: f.get('review') } }); toast('Thanks! Your review is sent for approval.'); e.target.reset(); rating = 0; $$('#ss span').forEach(x => x.classList.remove('on')); }
    catch (er) { toast(er.message, true); } btn.disabled = false;
  };
}

async function directory() {
  main.innerHTML = loader();
  const d = await api('directory_categories');
  main.innerHTML = pageHead('Important Directory', 'Emergency numbers, government offices, clubs and more') + `<section class="sec"><div class="wrap"><div class="mini-grid">${d.categories.map(c => `<a class="mini" href="#/directory/${encodeURIComponent(c.slug)}"><b>${esc(c.name)}</b><small>View entries →</small></a>`).join('')}</div></div></section>`;
}
async function directoryList(slug) {
  main.innerHTML = loader();
  const d = await api('directory_list', { params: { slug } });
  main.innerHTML = pageHead(d.category || 'Directory', '', '<a href="#/directory">Important Directory</a> ›') + `<section class="sec"><div class="wrap"><div class="mini-grid">${d.items.map(i => `<a class="mini" href="#/directory/item/${encodeURIComponent(i.slug)}"><b>${esc(i.name)}</b></a>`).join('') || '<div class="empty" style="grid-column:1/-1">Nothing here yet.</div>'}</div></div></section>`;
}
async function directoryItem(slug) {
  main.innerHTML = loader();
  const { item } = await api('directory_item', { params: { slug } });
  main.innerHTML = pageHead(item.name, '', `<a href="#/directory">Important Directory</a> › ${esc(item.category)}`) + `<section class="sec"><div class="wrap"><div class="card prose">${item.details_html ? clean(item.details_html) : `<p style="white-space:pre-line">${esc(item.details_text)}</p>`}</div></div></section>`;
}

/* news (WordPress feed) */
let postsCache = null;
async function blog(b) {
  if (postsCache) return postsCache;
  b = b || await boot();
  const r = await fetch(b.config?.blog_feed || 'https://pmcnews.in/wp-json/wp/v2/posts?categories=237&per_page=20&_embed');
  const arr = await r.json();
  return postsCache = arr.map(o => ({
    title: (o.title?.rendered || ''), slug: o.slug, date: o.date, html: o.content?.rendered || '', link: o.link,
    image: o._embedded?.['wp:featuredmedia']?.[0]?.source_url || o.yoast_head_json?.og_image?.[0]?.url || '',
  }));
}
const postCard = p => { const b = postBits(p); return `<a class="post" href="#/news/${encodeURIComponent(p.slug)}"><div class="im">${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}<span class="tagp">News</span></div><div class="b"><small>${esc(fmtDate(p.date))} · ${readMin(p.html)} min read</small><h3>${esc(b.title)}</h3><p>${esc(b.ex)}…</p><span class="rm">Read more →</span></div></a>`; };
async function news() {
  main.innerHTML = loader();
  let posts; try { posts = await blog(); } catch { main.innerHTML = errBox('News is unavailable right now.'); return; }
  main.innerHTML = pageHead('News', 'Latest from PMC News') + `<section class="sec"><div class="wrap"><div class="news">${posts.map(postCard).join('')}</div></div></section>`;
}
async function newsItem(slug) {
  main.innerHTML = loader();
  const p = (await blog()).find(x => x.slug === slug);
  if (!p) { main.innerHTML = errBox('Post not found.', false); return; }
  const t = document.createElement('div'); t.innerHTML = p.title;
  main.innerHTML = pageHead(t.textContent, fmtDate(p.date), '<a href="#/news">News</a> ›') + `<section class="sec"><div class="wrap"><div class="card prose">${p.image ? `<img src="${esc(p.image)}" alt="" style="margin-bottom:18px;width:100%">` : ''}${clean(p.html)}<p><a target="_blank" rel="noopener" href="${esc(p.link)}">Read on PMC News ↗</a></p></div></div></section>`;
}

/* enquiry forms */
function enquiryForm(type) {
  return `<form class="form" id="ef"><div class="g2"><div class="fld"><label>Name *</label><input class="inp" name="name" required></div><div class="fld"><label>Phone *</label><input class="inp" name="phone" inputmode="tel" required></div></div>
  <div class="g2"><div class="fld"><label>Email</label><input class="inp" type="email" name="email"></div><div class="fld"><label>Company</label><input class="inp" name="company"></div></div>
  <div class="fld"><label>Message *</label><textarea class="inp" name="message" required></textarea></div><button class="btn btn-navy btn-lg" style="justify-self:start">Send</button></form>`;
}
function bindEnquiry(type) {
  $('#ef').onsubmit = async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); f.type = type;
    const b = e.target.querySelector('button'); b.disabled = true;
    try { await api('enquiry', { body: f }); toast('Thank you! We will get back to you shortly.'); e.target.reset(); } catch (er) { toast(er.message, true); } b.disabled = false;
  };
}
async function contact() {
  const b = await boot();
  main.innerHTML = pageHead('Contact us', 'Questions, feedback or suggestions — we read every message.') + `<section class="sec"><div class="wrap"><div class="card narrow wide">${enquiryForm('feedback')}</div></div></section>`;
  bindEnquiry('feedback');
}
async function payBanner(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const o = await api('banner_order', { body: { banner_id: id } }); await loadRazorpay();
    new Razorpay({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: o.name, description: o.description || 'Banner ad',
      prefill: { contact: o.prefill_mobile }, theme: { color: '#002365' },
      handler: async r => { try { await api('banner_verify', { body: { banner_id: id, razorpay_payment_id: r.razorpay_payment_id, razorpay_order_id: r.razorpay_order_id, razorpay_signature: r.razorpay_signature } }); toast('Payment verified! Now upload your banner image.'); route(); } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; } },
      modal: { ondismiss: () => btn && (btn.disabled = false) },
    }).open();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}

async function advertise() {
  if (needLogin()) return;
  main.innerHTML = loader();
  const [pl, b, list] = await Promise.all([api('banner_plans'), boot(), api('banner_list')]);
  const items = list.items || [];
  const ads = items.map(a => {
    const st = a.needs_payment ? ['Payment pending', 'w'] : a.needs_image ? ['Upload your image', 'x'] : ['Live', 's'];
    return `<article class="ad">${a.image ? `<img class="adimg" loading="lazy" src="${esc(a.image)}" alt="">` : '<div class="adimg ph">No image yet</div>'}
      <div class="adb"><span class="bdg ${st[1]}">${st[0]}</span><h3>${esc(a.company)}</h3><p>${esc(a.location_label)} · ${esc(a.category)}</p>
      <p class="adm">${a.validity_days} days · ${rupee(a.amount_paise)}${a.expires_at ? ` · valid till ${esc(String(a.expires_at).slice(0, 10))}` : ''}</p>
      <div class="row">${a.needs_payment ? `<button class="btn btn-yellow btn-sm" data-pay="${a.id}">Pay now</button>` : ''}
      ${(a.needs_image || (!a.needs_payment && a.image)) ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer">${a.needs_image ? 'Upload image' : 'Replace image'}<input type="file" accept="image/*" hidden data-up="${a.id}"></label>` : ''}
      <button class="btn btn-red btn-sm" data-del="${a.id}">Delete</button></div></div></article>`;
  }).join('');
  main.innerHTML = pageHead('Advertise with us', 'Put your banner in front of everyone who searches PMC Yellow Pages', '<a href="#/account">My account</a> ›') + `<section class="sec"><div class="wrap">
    <div class="sec-h"><div><h2 class="navyh">My ads</h2><p>Pay, upload your image and track your banners.</p></div><button class="btn btn-yellow" id="newAd">+ New ad</button></div>
    <div id="wiz" class="card" style="display:${items.length ? 'none' : 'block'};margin-bottom:28px"></div>
    <div class="adgrid">${ads}</div>
    ${items.length ? '' : '<div class="empty" id="noads"><b>You have no ads yet</b>Create your first ad to reach thousands of local customers.</div>'}
    <div class="card" style="margin-top:36px"><h2>Banner placements &amp; prices</h2><div class="plan">${pl.types.map(t => `<div><h3>${esc(t.label)}</h3><small style="color:var(--mut)">Image size ${esc(t.size)} px</small><table>${t.plans.map(p => `<tr><td>${p.days} days</td><td>${esc(p.price_label)}</td></tr>`).join('')}</table></div>`).join('')}</div></div>
    <div class="card narrow wide" style="margin-top:28px"><h2>Need help? Request a callback</h2>${enquiryForm('advertise')}</div></div></section>`;
  bindEnquiry('advertise');
  $$('[data-pay]').forEach(x => x.onclick = () => payBanner(+x.dataset.pay, x));
  $$('[data-del]').forEach(x => x.onclick = async () => { if (!confirm('Delete this ad?')) return; try { await api('banner_delete', { body: { banner_id: x.dataset.del } }); toast('Ad deleted'); route(); } catch (e) { toast(e.message, true); } });
  $$('[data-up]').forEach(x => x.onchange = async () => { const f = x.files[0]; if (!f) return; toast('Uploading…'); try { await api('banner_upload', { body: { banner_id: x.dataset.up }, files: { image: f } }); toast('Image uploaded'); route(); } catch (e) { toast(e.message, true); } });
  const W = $('#wiz'); let type = pl.types[0]?.code || 'HB', days = 0, slot = 1, keep = { c: '', k: '' };
  const drawWiz = () => {
    const t = pl.types.find(x => x.code === type) || pl.types[0];
    W.innerHTML = `<h2>New ad</h2><div class="form">
     <div><h3 class="step">1. Where should your ad appear?</h3><div class="opts">${pl.types.map(x => `<button type="button" class="opt ${x.code === type ? 'on' : ''}" data-t="${x.code}"><b>${esc(x.label)}</b><small>${esc(x.size)} px</small></button>`).join('')}</div></div>
     <div><h3 class="step">2. Choose a plan</h3><div class="opts">${t.plans.map(x => `<button type="button" class="opt ${x.days === days ? 'on' : ''}" data-d="${x.days}"><b>${x.days} days</b><small>${esc(x.price_label)}</small></button>`).join('')}</div>
       ${type === 'R' ? `<h3 class="step" style="margin-top:14px">Position on the right side</h3><div class="opts">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="opt sm ${n === slot ? 'on' : ''}" data-s="${n}">${n}</button>`).join('')}</div>` : ''}</div>
     <div><h3 class="step">3. Details</h3><div class="g2"><div class="fld"><label>Business / ad name *</label><input class="inp" id="adc" maxlength="80" value="${esc(keep.c)}"></div>
       <div class="fld"><label>Category to advertise in *</label><select class="inp" id="adk"><option value="">Choose category</option>${b.categories.map(c => `<option value="${c.id}" ${String(c.id) === keep.k ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
       <small style="color:var(--mut)">After payment you'll upload your banner image here in "My ads".</small></div>
     <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-yellow btn-lg" id="adgo">Continue to payment</button>${items.length ? '<button class="btn btn-ghost btn-lg" id="adx">Cancel</button>' : ''}</div></div>`;
    const save = () => { keep = { c: $('#adc').value, k: $('#adk').value }; };
    $$('[data-t]', W).forEach(x => x.onclick = () => { save(); type = x.dataset.t; days = 0; drawWiz(); });
    $$('[data-d]', W).forEach(x => x.onclick = () => { save(); days = +x.dataset.d; drawWiz(); });
    $$('[data-s]', W).forEach(x => x.onclick = () => { save(); slot = +x.dataset.s; drawWiz(); });
    const cx = $('#adx'); if (cx) cx.onclick = () => { W.style.display = 'none'; };
    $('#adgo').onclick = async e => {
      save(); const company = keep.c.trim(), cat = keep.k;
      if (!days) return toast('Choose a plan', true);
      if (!company) return toast('Enter your business / ad name', true);
      if (!cat) return toast('Choose a category', true);
      e.target.disabled = true; e.target.textContent = 'Please wait…';
      try { const c = await api('banner_create', { body: { category_id: cat, company_name: company, location: type, slot, validity_days: days } }); await payBanner(c.banner_id, e.target); }
      catch (er) { toast(er.message, true); e.target.disabled = false; e.target.textContent = 'Continue to payment'; }
    };
  };
  drawWiz();
  $('#newAd').onclick = () => { W.style.display = 'block'; W.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
}

/* ---------- account ---------- */
const PHONES = ['9437404000', '9437505000', '9437606000'];
async function login() {
  if (token) { location.hash = '#/account'; return; }
  main.innerHTML = `<section class="authwrap"><div class="wrap"><div class="auth">
    <aside class="auth-l"><span class="eyebrow">Business dashboard</span><h1>Manage your business listings</h1>
      <p>Log in with the mobile number registered on your listing to edit details, add photos and go Premium.</p>
      <ul><li>Edit your business details anytime</li><li>Upload up to 30 photos with Premium</li><li>Get the PMC Verified &amp; Trusted badge</li><li>See your listing status instantly</li></ul>
      <div class="auth-help">Need help? Call <a href="tel:${PHONES[0]}">${PHONES[0]}</a> · <a href="tel:${PHONES[1]}">${PHONES[1]}</a></div></aside>
    <div class="auth-r"><div class="authcard" id="lg"></div></div></div></div></section>`;
  const box = $('#lg');
  const steps = n => `<ol class="steps">${['Mobile', 'OTP', 'Done'].map((t, i) => `<li class="${i + 1 < n ? 'done' : i + 1 === n ? 'on' : ''}"><i>${i + 1 < n ? '✓' : i + 1}</i><span>${t}</span></li>`).join('')}</ol>`;
  const head = (t, sub) => `<div class="ah"><div class="aico">🏢</div><h2>${t}</h2><p>${sub}</p></div>`;
  let timer;
  const step1 = () => {
    clearInterval(timer);
    box.innerHTML = steps(1) + head('My Listings Dashboard', 'Enter your registered mobile number to access and manage your business listings.') + `
    <form class="form" id="f1" novalidate><div class="fld"><label for="mob">Mobile number</label>
      <div class="phone"><span>+91</span><input id="mob" class="inp" name="mobile" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number" autocomplete="tel-national" autofocus></div>
      <small id="merr" class="ferr"></small></div>
      <button class="btn btn-navy btn-lg btn-block">Send OTP</button></form>
    <div class="or"><span>or</span></div>
    <p class="reg">Don't have a listing yet?<br><a class="btn btn-yellow btn-block" href="#/free-listing">Register for FREE Listing</a></p>
    <p class="note">Your mobile number must be registered as Phone-1 or Phone-2 in an existing listing.</p>`;
    const inp = $('#mob'); inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 10); $('#merr').textContent = ''; };
    $('#f1').onsubmit = async e => {
      e.preventDefault(); const mobile = inp.value;
      if (!/^[6-9]\d{9}$/.test(mobile)) { $('#merr').textContent = 'Enter a valid 10-digit mobile number.'; inp.focus(); return; }
      const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Sending…';
      try { const d = await api('otp_send', { body: { mobile } }); step2(mobile, d.resend_after_seconds || 30); }
      catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Send OTP'; }
    };
  };
  const step2 = (mobile, wait) => {
    box.innerHTML = steps(2) + head('Verify OTP', `OTP sent to +91 ${esc(mobile)}. Enter the 6-digit code below.`) + `
    <form class="form" id="f2" novalidate><div class="fld"><label for="otp">6-digit OTP</label><input id="otp" class="inp otp" name="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" autofocus><small id="oerr" class="ferr"></small></div>
      <button class="btn btn-navy btn-lg btn-block">Verify &amp; login</button>
      <div class="resend"><span id="rs"></span><button type="button" class="linkbtn" id="rb" disabled>Resend OTP</button></div>
      <button type="button" class="btn btn-ghost btn-block" id="chg">← Change mobile number</button></form>`;
    $('#chg').onclick = step1;
    let left = wait; const rs = $('#rs'), rb = $('#rb');
    const tick = () => { rs.textContent = left > 0 ? `Resend OTP in ${left}s` : ''; rb.disabled = left > 0; if (left-- <= 0) clearInterval(timer); };
    clearInterval(timer); tick(); timer = setInterval(tick, 1000);
    rb.onclick = async () => { rb.disabled = true; try { const d = await api('otp_send', { body: { mobile } }); toast('OTP sent again'); left = d.resend_after_seconds || 30; clearInterval(timer); tick(); timer = setInterval(tick, 1000); } catch (er) { toast(er.message, true); rb.disabled = false; } };
    const inp = $('#otp'); inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); $('#oerr').textContent = ''; };
    $('#f2').onsubmit = async e => {
      e.preventDefault(); const otp = inp.value;
      if (otp.length !== 6) { $('#oerr').textContent = 'Enter the 6-digit OTP.'; return; }
      const b = e.target.querySelector('.btn-navy'); b.disabled = true; b.textContent = 'Verifying…';
      try {
        const d = await api('otp_verify', { body: { mobile, otp } }); clearInterval(timer); setAuth(d.token, d.profile);
        box.innerHTML = steps(4) + head('You are logged in', 'Taking you to your dashboard…');
        const next = ls.get('pmc_next') || '#/account'; ls.del('pmc_next'); setTimeout(() => location.hash = next, 700);
      } catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Verify & login'; }
    };
  };
  step1();
}
const needLogin = () => { if (!token) { ls.set('pmc_next', location.hash); location.hash = '#/login'; return true; } return false; };

async function account(statusFilter = 'all') {
  if (needLogin()) return;
  main.innerHTML = loader();
  const me = await api('me'); setAuth(token, me.profile);
  const p = me.profile, c = me.counts;
  const q = new URLSearchParams(location.hash.split('?')[1] || ''); const st = q.get('status') || 'all';
  const d = await api('my_listings', { params: { status: st, page: 1 } });
  main.innerHTML = pageHead('My Listings Dashboard', 'Manage your business listings on PMC Yellow Pages') + `<section class="sec"><div class="wrap">
  <div class="card dash-top"><div class="avatar">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : esc(initials(p.name || p.mobile))}</div>
    <div style="flex:1"><h2 style="margin:0">${esc(p.name || 'Add your name')}</h2><span style="color:var(--mut)">${esc(p.mobile)}${p.email ? ' · ' + esc(p.email) : ''}</span></div>
    <button class="btn btn-ghost btn-sm" id="edP">Edit profile</button><button class="btn btn-ghost btn-sm" id="lo">Logout</button></div>
  <div class="sec-h" style="margin-top:28px"><h2>My listings</h2><a class="btn btn-yellow" href="#/account/listing">+ Add new listing</a></div>
  <div class="tabs">${[['all', 'All'], ['free', 'Free'], ['active', 'Premium'], ['pending', 'Pending'], ['rejected', 'Rejected']].map(([k, n]) => `<a class="tab ${st === k ? 'on' : ''}" href="#/account?status=${k}">${n}<i>${c[k] ?? 0}</i></a>`).join('')}</div>
  <div class="list">${d.items.map(ownerCard).join('') || '<div class="empty"><b>No listings here</b>Add your business — it\'s free.</div>'}</div>
  <div style="margin-top:36px"><button class="btn btn-red btn-sm" id="del">Delete my account</button></div></div></section>`;
  $('#lo').onclick = () => { logout(); location.hash = '#/'; };
  $('#edP').onclick = () => profileModal(p);
  $('#del').onclick = async () => {
    if (prompt('This removes your login and profile (listings stay). Type DELETE to confirm.') !== 'DELETE') return;
    try { await api('account_delete', { body: { confirm: 'DELETE' } }); logout(); location.hash = '#/'; } catch (e) { toast(e.message, true); }
  };
  $$('[data-prem]').forEach(b => b.onclick = () => payPremium(+b.dataset.prem, b));
}
function ownerCard(l) {
  const bad = { 0: 'w', 1: 's', 2: 'x' }; // best effort mapping; label comes from server
  return `<article class="lc ${l.is_premium ? 'prem' : ''}"><div class="th">${l.cover ? `<img src="${esc(l.cover)}" alt="">` : esc(initials(l.name))}</div><div>
   <div class="badges"><span class="bdg ${/reject/i.test(l.status_label) ? 'x' : /pending/i.test(l.status_label) ? 'w' : 's'}">${esc(l.status_label || 'Listed')}</span>${l.is_premium ? '<span class="bdg p">★ Premium</span>' : ''}</div>
   <h3>${esc(l.name)}</h3><div class="cats">${esc(l.categories)}</div><div class="addr">📍 ${esc(l.address)}</div>
   <div class="row"><a class="btn btn-navy btn-sm" href="#/account/listing/${l.id}">Edit</a>${l.slug ? `<a class="btn btn-ghost btn-sm" href="#/b/${encodeURIComponent(l.slug)}">View</a>` : ''}${!l.is_premium ? `<button class="btn btn-yellow btn-sm" data-prem="${l.id}">Go Premium</button>` : ''}</div></div></article>`;
}
function profileModal(p) {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<form class="box form"><h2>Edit profile</h2><div class="fld"><label>Name</label><input class="inp" name="name" value="${esc(p.name)}" required></div><div class="fld"><label>Email</label><input class="inp" type="email" name="email" value="${esc(p.email)}"></div><div class="fld"><label>Photo</label><input type="file" name="photo" accept="image/*"></div><div style="display:flex;gap:10px"><button class="btn btn-navy">Save</button><button type="button" class="btn btn-ghost" id="x">Cancel</button></div></form>`;
  document.body.append(m); $('#x', m).onclick = () => m.remove();
  m.onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const ph = f.get('photo'); const b = e.target.querySelector('.btn-navy'); b.disabled = true;
    try { const d = await api('profile_save', { body: { name: f.get('name'), email: f.get('email') }, files: { photo: ph && ph.size ? ph : null } }); setAuth(token, d.profile); m.remove(); toast('Profile saved'); route(); }
    catch (er) { toast(er.message, true); b.disabled = false; }
  };
}

function loadRazorpay() {
  return new Promise((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load payment window.')); document.head.append(s);
  });
}
async function payPremium(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const o = await api('premium_order', { body: { dir_id: id } }); await loadRazorpay();
    new Razorpay({
      key: o.key_id, order_id: o.order_id, amount: o.amount, currency: o.currency, name: o.name, description: o.description || 'Premium listing',
      prefill: { contact: o.prefill_mobile }, theme: { color: '#002365' },
      handler: async r => { try { await api('premium_verify', { body: { dir_id: id, razorpay_payment_id: r.razorpay_payment_id, razorpay_order_id: r.razorpay_order_id, razorpay_signature: r.razorpay_signature } }); toast('Premium activated 🎉'); route(); } catch (e) { toast(e.message, true); } },
      modal: { ondismiss: () => btn && (btn.disabled = false) },
    }).open();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}


const BENEFITS = {
  free: { tag: '100% Free', t: 'List your business on <em>PMC Yellow Pages</em>', sub: 'Reach thousands of local customers searching for your services every day.', items: [['🔍', 'Better Search Visibility', 'Show up when people search your category.'], ['📞', 'More Customer Calls', 'Customers call or WhatsApp you directly.'], ['🚀', 'Instant Submission', 'Submit in minutes — our team reviews and publishes.']] },
  premium: { tag: 'Premium', t: 'List your business on <em>PMC Premium Listing</em>', sub: 'Unlock photo gallery, Verified & Trusted badge on your business listing.', items: [['📸', 'Photo Gallery', 'Add up to 30 photos of your business.'], ['🏆', 'Priority Placement', 'Appear above free listings in search.'], ['⚡', 'More Visibility', 'PMC Verified & Trusted badge builds confidence.']] },
};
function listingHero(mode, b) {
  const d = BENEFITS[mode] || BENEFITS.free;
  return `<section class="lhero"><div class="wrap"><span class="eyebrow">${d.tag}</span><h1>${d.t}</h1><p>${d.sub}</p>
    ${mode === 'premium' ? `<div class="pricetag">${esc(b?.config?.premium_price_label || '₹1499')} <small>one-time · lifetime</small></div>` : ''}
    <div class="bgrid">${d.items.map(i => `<div><i>${i[0]}</i><b>${i[1]}</b><span>${i[2]}</span></div>`).join('')}</div></div></section>`;
}
async function listingLanding(mode) {
  main.innerHTML = loader(); const b = await boot();
  ls.set('pmc_next', '#/' + (mode === 'premium' ? 'premium-listing' : 'free-listing'));
  main.innerHTML = listingHero(mode, b) + `<section class="sec"><div class="wrap"><div class="card narrow wide" style="text-align:center"><h2 style="border:0;padding:0">Log in to add your business</h2><p style="color:var(--mut)">Verify your mobile number with a quick OTP, then fill in your business details.</p><a class="btn btn-navy btn-lg" href="#/login">Login with mobile number</a><p class="note" style="margin-top:18px">Need help? Call <a href="tel:${PHONES[0]}">${PHONES[0]}</a>, <a href="tel:${PHONES[1]}">${PHONES[1]}</a> or <a href="tel:${PHONES[2]}">${PHONES[2]}</a></p></div></div></section>`;
}
async function listingForm(id, mode = 'free') {
  if (!id && !token) return listingLanding(mode);
  if (needLogin()) return;
  main.innerHTML = loader();
  const b = await boot(); let L = null, F = {};
  if (id) { L = (await api('listing_mine', { params: { dir_id: id } })).listing; F = L.form || {}; }
  const sel = new Set((F.category_ids || []).map(Number)); const v = k => esc(F[k] || '');
  main.innerHTML = (id ? pageHead('Edit listing', L.name, '<a href="#/account">My account</a> ›') : listingHero(mode, b)) + `<section class="sec"><div class="wrap"><div class="card narrow wide">
  <form class="form" id="lf">
   <div class="fld"><label>Business name *</label><input class="inp" name="company_name" value="${v('company_name')}" required></div>
   <div class="g2"><div class="fld"><label>Contact person</label><input class="inp" name="contact_name" value="${v('contact_name')}"></div><div class="fld"><label>Phone</label><input class="inp" name="phone" value="${v('phone') || v('mobile')}" inputmode="tel"></div></div>
   <div class="fld"><label>Address *</label><textarea class="inp" name="address" style="min-height:70px" required>${v('address')}</textarea></div>
   <div class="g2"><div class="fld"><label>City *</label><select class="inp" name="city" required>${b.cities.map(c => `<option value="${esc(c.name)}" ${(F.city ? F.city === c.name : c.id === b.default_city) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
     <div class="fld"><label>Area *</label><select class="inp" name="location" required><option value="">Select area</option>${b.locations.map(a => `<option ${F.location === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div></div>
   <div class="g2"><div class="fld"><label>Pincode</label><input class="inp" name="pincode" value="${v('pincode')}" inputmode="numeric" maxlength="6"></div><div class="fld"><label>Established (year)</label><input class="inp" name="established" value="${v('established')}" inputmode="numeric" maxlength="4"></div></div>
   <div class="g2"><div class="fld"><label>Email</label><input class="inp" type="email" name="email" value="${v('email')}"></div><div class="fld"><label>Website</label><input class="inp" name="website" value="${v('website')}"></div></div>
   <div class="fld"><label>Categories * <small style="display:inline">(pick one or more)</small></label><input class="inp" id="cq" placeholder="Filter categories…" style="margin-bottom:8px"><div class="catpick" id="cp">${b.categories.map(c => `<label data-n="${esc(c.name.toLowerCase())}"><input type="checkbox" value="${c.id}" ${sel.has(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></div>
   <div class="fld"><label>Keywords</label><input class="inp" name="keywords" value="${v('keywords')}" placeholder="comma separated"></div>
   <div class="fld"><label>About your business</label><textarea class="inp" name="about" style="min-height:140px">${v('about')}</textarea></div>
   <div class="fld"><label>Cover photo</label><input type="file" name="cover" accept="image/*"></div>
   <button class="btn btn-navy btn-lg" style="justify-self:start">${id ? 'Save changes' : 'Submit listing'}</button></form></div>
  ${id ? galleryCard(L) : ''}</div></section>`;
  $('#cq').oninput = e => { const q = e.target.value.toLowerCase(); $$('#cp label').forEach(l => l.style.display = l.dataset.n.includes(q) ? '' : 'none'); };
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const cats = $$('#cp input:checked').map(i => i.value);
    if (!cats.length) return toast('Select at least one category', true);
    const body = {}; ['company_name', 'contact_name', 'phone', 'address', 'city', 'location', 'pincode', 'established', 'email', 'website', 'keywords', 'about'].forEach(k => body[k] = f.get(k) || ''); body.categories = cats; if (id) body.dir_id = id;
    const cv = f.get('cover'); const btn = e.target.querySelector('.btn-navy'); btn.disabled = true;
    try { const d = await api(id ? 'listing_update' : 'listing_create', { body, files: { cover: cv && cv.size ? cv : null } }); toast(id ? 'Listing updated' : 'Listing submitted for approval'); location.hash = '#/account'; if (!id && mode === 'premium' && d.dir_id) setTimeout(() => payPremium(d.dir_id), 600); }
    catch (er) { toast(er.message, true); btn.disabled = false; }
  };
  if (id) bindGallery(L);
}
function galleryCard(L) {
  if (!L.is_premium) return `<div class="card narrow wide"><h2>Photo gallery</h2><div class="alert">Photo gallery is a Premium feature. Upgrade to add up to 30 photos.</div><button class="btn btn-yellow" id="gp">Go Premium</button></div>`;
  return `<div class="card narrow wide"><h2>Photo gallery <small style="color:var(--mut)">(${L.gallery.length}/30)</small></h2>${L.gallery_processing ? '<div class="alert">Some photos are still processing…</div>' : ''}
  <div class="gal" id="gg">${L.gallery.map(g => `<div style="position:relative"><img src="${esc(g.thumb || g.url)}" alt=""><button class="btn btn-red btn-sm" data-gd="${g.id}" style="position:absolute;top:4px;right:4px;padding:3px 8px">✕</button></div>`).join('')}</div>
  <div style="margin-top:14px"><input type="file" id="gu" accept="image/*" multiple> <button class="btn btn-navy btn-sm" id="gb">Upload</button></div></div>`;
}
function bindGallery(L) {
  const gp = $('#gp'); if (gp) gp.onclick = () => payPremium(L.id, gp);
  $$('[data-gd]').forEach(b => b.onclick = async () => { if (!confirm('Delete this photo?')) return; try { await api('gallery_delete', { body: { image_id: b.dataset.gd } }); toast('Deleted'); route(); } catch (e) { toast(e.message, true); } });
  const gb = $('#gb'); if (gb) gb.onclick = async () => {
    const fs = [...$('#gu').files]; if (!fs.length) return toast('Choose photos first', true); gb.disabled = true;
    for (const f of fs) { try { await api('gallery_upload', { body: { dir_id: L.id }, files: { photo: f } }); } catch (e) { toast(e.message, true); break; } }
    toast('Upload done'); route();
  };
}

/* ---------- router ---------- */
const routes = [
  [/^$|^\/$/, home, 'home'],
  [/^\/categories$/, categories, 'categories'],
  [/^\/search$/, (_, q) => search(q), ''],
  [/^\/c\/(.+)$/, m => category(decodeURIComponent(m[1])), 'categories'],
  [/^\/b\/(.+)$/, m => detail(decodeURIComponent(m[1])), ''],
  [/^\/directory$/, directory, 'directory'],
  [/^\/directory\/item\/(.+)$/, m => directoryItem(decodeURIComponent(m[1])), 'directory'],
  [/^\/directory\/(.+)$/, m => directoryList(decodeURIComponent(m[1])), 'directory'],
  [/^\/news$/, news, 'news'],
  [/^\/news\/(.+)$/, m => newsItem(decodeURIComponent(m[1])), 'news'],
  [/^\/advertise$/, advertise, 'advertise'],
  [/^\/contact$/, contact, 'contact'],
  [/^\/login$/, login, ''],
  [/^\/account$/, account, ''],
  [/^\/account\/listing$/, () => listingForm(0, 'free'), ''],
  [/^\/free-listing$/, () => listingForm(0, 'free'), ''],
  [/^\/premium-listing$/, () => listingForm(0, 'premium'), ''],
  [/^\/account\/listing\/(\d+)$/, m => listingForm(+m[1]), ''],
];
async function route() {
  rid++;
  const raw = location.hash.replace(/^#/, ''); const [path, qs] = raw.split('?'); const q = new URLSearchParams(qs || '');
  document.title = 'PMC Yellow Pages | Find Verified Local Businesses in Odisha';
  $('#nav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false');
  for (const [re, fn, nav] of routes) {
    const m = path.match(re); if (!m) continue;
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === nav));
    const tabKey = /^\/(account|login|free-listing|premium-listing)/.test(path) ? 'acct' : nav;
    $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.t === tabKey));
    document.body.classList.toggle('is-detail', /^\/b\//.test(path));
    try { await fn(m, q); } catch (e) { if (e.stale) return; main.innerHTML = errBox(e.message || 'Something went wrong.', e.status !== 404); console.error(e); }
    if (!route.first) window.scrollTo(0, 0); route.first = false; main.focus({ preventScroll: true });
    return;
  }
  main.innerHTML = errBox('Page not found.', false);
}
route.first = true;
window.addEventListener('hashchange', () => { route.first = false; route(); });
$('#burger').onclick = () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); };
$('#yr').textContent = new Date().getFullYear();
$('#tabbar [data-t="search"]').onclick = e => {
  e.preventDefault();
  const go = () => { const q = $('#sq'); if (q) { window.scrollTo({ top: 0, behavior: 'smooth' }); q.focus({ preventScroll: true }); } };
  if (location.hash && location.hash !== '#/') { location.hash = '#/'; setTimeout(go, 450); } else go();
};
renderAcct();
boot().then(b => { const p = b.config?.pages || {}; $$('[data-page]').forEach(a => p[a.dataset.page] && (a.href = p[a.dataset.page])); }).catch(() => {});
route();
})();

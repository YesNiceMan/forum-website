/* ============ AURORA VAULT 前端核心：API / 路由 / 动效 / 组件 ============ */

/* ---------- 基础工具 ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const el = (html) => { const t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; };
export const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const nl2br = (s = '') => escapeHtml(s).replace(/\n/g, '<br>');
export const clampText = (s = '', n = 120) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export const fmtScore = (n) => { const v = Number(n) || 0; return v ? v.toFixed(1) : '—'; };
export const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '—');
export function relTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!(diff >= 0)) return fmtDate(iso);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
  return fmtDate(iso);
}
export function fmtBytes(n = 0) {
  n = Number(n) || 0;
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return (i ? n.toFixed(n >= 100 ? 0 : 1) : Math.round(n)) + ' ' + u[i];
}
/** 远程图片走服务端中转，规避防盗链与混合内容 */
export const imgSrc = (url, label = '') => {
  if (!url) return '';
  if (url.startsWith('/uploads/') || url.startsWith('/assets/')) return url;
  if (/^data:image/i.test(url)) return url;
  return '/api/proxy?url=' + encodeURIComponent(url) + (label ? '&label=' + encodeURIComponent(label) : '');
};
export const providerInitial = (name = '') => (/^[a-zA-Z]/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 2));

const BQ = String.fromCharCode(96);
/** 极简 Markdown（简介 / 内容手写友好） */
export function mdLite(src = '') {
  const esc = escapeHtml(String(src).replace(/\r\n/g, '\n'));
  const inline = (s) => s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) => '<img src="' + imgSrc(u, a) + '" alt="' + a + '" loading="lazy" />')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, a, u) => '<a href="' + u + '" target="_blank" rel="noopener nofollow">' + a + '</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(new RegExp(BQ + '([^' + BQ + ']+)' + BQ, 'g'), '<code>$1</code>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<>"')]+)(?=[\s<]|$)/g, '<a href="$1" target="_blank" rel="noopener nofollow">$1</a>');
  const lines = esc.split('\n');
  const out = [];
  let list = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { if (list) { out.push('</' + list + '>'); list = null; } continue; }
    const head = /^(#{1,5})\s+(.*)$/.exec(line);
    if (head) { out.push('<h' + (head[1].length + 1) + '>' + inline(head[2]) + '</h' + (head[1].length + 1) + '>'); continue; }
    if (/^>\s?/.test(line)) { out.push('<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'); continue; }
    if (/^(?:[-*+]\s+|\d+[.)\s]\s+)/.test(line)) {
      const want = /^\d/.test(line) ? 'ol' : 'ul';
      if (list !== want) { if (list) out.push('</' + list + '>'); out.push('<' + want + '>'); list = want; }
      out.push('<li>' + inline(line.replace(/^(?:[-*+]\s+|\d+[.)\s]\s+)/, '')) + '</li>');
      continue;
    }
    if (/^(---|\*\*\*)$/.test(line.trim())) { out.push('<hr />'); continue; }
    if (list) { out.push('</' + list + '>'); list = null; }
    out.push('<p>' + inline(line) + '</p>');
  }
  if (list) out.push('</' + list + '>');
  return out.join('');
}

/* ---------- 本地偏好 ---------- */
const LS = 'aurora.vault.v1';
const defaults = { favorites: [], recent: [], filters: {}, theme: 'dark', nickname: '' };
let prefs = loadPrefs();
export function loadPrefs() {
  try { return Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS) || '{}')); } catch { return Object.assign({}, defaults); }
}
export function savePrefs(patch = {}) {
  prefs = Object.assign({}, prefs, patch);
  try { localStorage.setItem(LS, JSON.stringify(prefs)); } catch {}
  return prefs;
}
export const Prefs = {
  get all() { return prefs; },
  set: savePrefs,
  isFav(id) { return prefs.favorites.some((f) => f.id === id); },
  favList() { return prefs.favorites; },
  toggleFav(r) {
    const exists = prefs.favorites.some((f) => f.id === r.id);
    const next = exists ? prefs.favorites.filter((f) => f.id !== r.id) : [{ id: r.id, title: r.title, cover: r.cover, type: r.type, at: Date.now() }].concat(prefs.favorites).slice(0, 200);
    savePrefs({ favorites: next });
    return !exists;
  },
  remember(title) {
    const next = [title].concat(prefs.recent.filter((x) => x !== title)).slice(0, 12);
    savePrefs({ recent: next });
    return next;
  },
};

/* ---------- 网络 ---------- */
export class ApiError extends Error { constructor(message, status, payload) { super(message); this.status = status; this.payload = payload; } }
let pending = 0;
let barVal = 0;
function bar(step) {
  let b = document.querySelector('.loading-bar');
  if (!b) { b = el('<div class="loading-bar"></div>'); document.body.append(b); }
  if (step === 'in') {
    pending++;
    barVal = Math.min(.9, (barVal || .04) + .09);
    b.style.opacity = '1';
    b.style.transform = 'scaleX(' + barVal.toFixed(3) + ')';
  } else {
    pending = Math.max(0, pending - 1);
    if (!pending) {
      barVal = 1;
      b.style.transform = 'scaleX(1)';
      b.style.opacity = '0';
      setTimeout(() => { barVal = 0; b.style.transform = 'scaleX(0)'; }, 340);
    }
  }
}
const inflight = new Map();
export async function api(method, path, body, opts = {}) {
  const key = method + ' ' + path + (body ? JSON.stringify(body).slice(0, 300) : '');
  if (opts.dedupe !== false && inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    if (!opts.silent) bar('in');
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        // 聚合搜索 / 导入识别本来就要跑十几秒，只在调用方指定时掐表
        signal: opts.timeoutMs && typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs) : undefined,
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.indexOf('json') > -1 ? await res.json() : await res.text();
      if (!res.ok || (data && data.ok === false)) {
        const msg = (data && (data.message || data.error)) || ('HTTP ' + res.status);
        throw new ApiError(msg, res.status, data);
      }
      return data;
    } finally {
      if (!opts.silent) bar('out');
      inflight.delete(key);
    }
  })();
  if (opts.dedupe !== false) inflight.set(key, run);
  return run;
}
export const Api = {
  bootstrap: () => api('GET', '/api/bootstrap'),
  resources: (query) => api('GET', '/api/resources?' + new URLSearchParams(query).toString()),
  resource: (id) => api('GET', '/api/resources/' + encodeURIComponent(id)),
  rate: (id, score) => api('POST', '/api/resources/' + encodeURIComponent(id) + '/rate', { score }),
  favorite: (id, on) => api('POST', '/api/resources/' + encodeURIComponent(id) + '/favorite', on === undefined ? {} : { on }, { silent: true }),
  // 补源是「点了就该看到结果」的操作，给 15s 兜底，超时还原按钮而不是永远转圈
  contribute: (id, payload) => api('POST', '/api/resources/' + encodeURIComponent(id) + '/contribute', payload, { timeoutMs: 15000 }),
  detect: (text) => api('POST', '/api/detect', { text }),
  enrich: (urls, mirror) => api('POST', '/api/enrich', { urls, mirror }),
  search: (payload) => api('POST', '/api/search', payload),
  submit: (draft) => api('POST', '/api/submit', draft),
  session: () => api('GET', '/api/admin/session', null, { silent: true, dedupe: false }),
  login: (user, pass) => api('POST', '/api/admin/login', { user, pass }),
  logout: () => api('POST', '/api/admin/logout', {}),
  admin: {
    overview: () => api('GET', '/api/admin/overview'),
    resources: (query) => api('GET', '/api/admin/resources?' + new URLSearchParams(query).toString()),
    resource: (id) => api('GET', '/api/admin/resource/' + encodeURIComponent(id)),
    create: (body) => api('POST', '/api/admin/resources', body),
    patch: (id, body) => api('PATCH', '/api/admin/resources/' + encodeURIComponent(id), body),
    remove: (id) => api('DELETE', '/api/admin/resources/' + encodeURIComponent(id)),
    bulk: (body) => api('POST', '/api/admin/resources/bulk', body),
    checkLinks: (id) => api('POST', '/api/admin/resources/' + encodeURIComponent(id) + '/check-links', {}),
    archive: () => api('GET', '/api/admin/archive'),
    restore: (id) => api('POST', '/api/admin/archive/' + encodeURIComponent(id) + '/restore', {}),
    submissions: (status) => api('GET', '/api/admin/submissions?status=' + encodeURIComponent(status || 'all')),
    decide: (id, body) => api('POST', '/api/admin/submissions/' + encodeURIComponent(id) + '/decide', body),
    enrichSubmission: (id) => api('POST', '/api/admin/submissions/' + encodeURIComponent(id) + '/enrich', {}),
    taxonomy: () => api('GET', '/api/admin/taxonomy'),
    saveType: (body) => api('POST', '/api/admin/types', body),
    removeType: (key) => api('DELETE', '/api/admin/types/' + encodeURIComponent(key)),
    saveTags: (names) => api('POST', '/api/admin/tags', { names }),
    patchTag: (name, body) => api('PATCH', '/api/admin/tags/' + encodeURIComponent(name), body),
    sources: () => api('GET', '/api/admin/sources'),
    saveSource: (body) => api('POST', '/api/admin/sources', body),
    testSource: (id, q) => api('POST', '/api/admin/sources/' + encodeURIComponent(id) + '/test', { q }),
    settings: () => api('GET', '/api/admin/settings'),
    patchSettings: (body) => api('PATCH', '/api/admin/settings', body),
    media: () => api('GET', '/api/admin/media'),
    upload: (body) => api('POST', '/api/admin/upload', body),
    deleteMedia: (name) => api('POST', '/api/admin/media/delete', { name }),
    mirror: (url) => api('POST', '/api/admin/mirror', { url }),
    logs: (kind) => api('GET', '/api/admin/logs?kind=' + encodeURIComponent(kind || '')),
    maintenance: (body) => api('POST', '/api/admin/maintenance', body),
    textToHtml: (text) => api('POST', '/api/admin/text-to-html', { text }),
    importParse: (body) => api('POST', '/api/admin/import/parse', body),
    importEnrich: (body) => api('POST', '/api/admin/import/enrich', body),
    importCommit: (body) => api('POST', '/api/admin/import/commit', body),
  },
};

/* ---------- 提示 ---------- */
export function toast(message, kind = 'info', ms = 3200) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const icon = kind === 'ok' ? '✓' : kind === 'bad' ? '!' : kind === 'warn' ? '~' : 'i';
  const node = el('<div class="toast ' + (kind === 'ok' ? 'toast--ok' : kind === 'bad' ? 'toast--bad' : '') + '"><span class="toast__icon">' + icon + '</span><span class="toast__msg"></span></div>');
  node.querySelector('.toast__msg').textContent = String(message);
  root.append(node);
  const kill = () => { node.classList.add('out'); setTimeout(() => node.remove(), 280); };
  const timer = setTimeout(kill, ms);
  node.addEventListener('click', () => { clearTimeout(timer); kill(); });
  return node;
}
export function confirmDialog(opts = {}) {
  const { title = '确认操作', text = '', okText = '确认', danger = false } = opts;
  return new Promise((resolve) => {
    modal({
      title, size: 'modal--narrow', body: '<p class="dim" style="margin:0">' + escapeHtml(text) + '</p>',
      foot: '<button class="btn btn--quiet" data-no>取消</button><button class="btn ' + (danger ? 'btn--danger' : 'btn--primary') + '" data-yes>' + escapeHtml(okText) + '</button>',
      onMount(node, close) {
        node.querySelector('[data-no]').onclick = () => { close(); resolve(false); };
        node.querySelector('[data-yes]').onclick = () => { close(); resolve(true); };
      },
      onClose: () => resolve(false),
    });
  });
}
/** 通用弹窗：body 可为 HTML 字符串或节点 */
export function modal(cfg = {}) {
  const { title = '', sub = '', body = '', foot = '', size = '', onMount, onClose, dismissable = true } = cfg;
  const root = document.getElementById('modalRoot');
  const overlay = el('<div class="overlay"><div class="modal ' + size + '" role="dialog" aria-modal="true"><header class="modal__head"><div class="grow"><h3></h3></div><button class="icon-btn modal__close" data-close aria-label="关闭">×</button></header><div class="modal__body"></div></div></div>');
  const box = overlay.querySelector('.modal');
  overlay.querySelector('h3').textContent = title;
  if (sub) { const p = el('<p></p>'); p.innerHTML = sub; overlay.querySelector('.modal__head .grow').append(p); }
  const bodyHost = overlay.querySelector('.modal__body');
  if (typeof body === 'string') bodyHost.innerHTML = body; else bodyHost.append(body);
  if (foot) { const f = el('<footer class="modal__foot"></footer>'); f.innerHTML = foot; box.append(f); }
  const close = (result) => {
    if (overlay.dataset.closing) return;
    overlay.dataset.closing = '1';
    overlay.classList.add('closing');
    box.classList.add('closing');
    setTimeout(() => { overlay.remove(); document.body.style.overflow = ''; onClose && onClose(result); }, 210);
  };
  overlay.addEventListener('mousedown', (e) => { if (dismissable && e.target === overlay) close(); });
  overlay.querySelector('[data-close]').onclick = () => close();
  const esc = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(); } };
  document.addEventListener('keydown', esc);
  document.body.style.overflow = 'hidden';
  root.append(overlay);
  setTimeout(() => { const first = box.querySelector('input, textarea, select, button:not([data-close])'); if (first) first.focus({ preventScroll: true }); }, 70);
  const ctrl = { node: box, overlay, close };
  if (onMount) onMount(box, close);
  return ctrl;
}

/* ---------- 灯箱 ---------- */
export function openLightbox(images = [], start = 0) {
  const box = document.getElementById('lightbox');
  if (!box || !images.length) return;
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  let i = Math.max(0, Math.min(start, images.length - 1));
  const stage = box.querySelector('#lightboxStage');
  const render = () => {
    const item = images[i] || {};
    const url = typeof item === 'string' ? item : item.url;
    const cap = typeof item === 'string' ? '' : item.caption || item.alt || '';
    stage.innerHTML = '<img src="' + imgSrc(url, cap) + '" alt="' + escapeHtml(cap) + '" />';
    box.querySelector('#lightboxCaption').textContent = cap || '';
    box.querySelector('#lightboxIndex').textContent = (i + 1) + ' / ' + images.length;
  };
  const step = (d) => { i = (i + d + images.length) % images.length; render(); };
  const key = (e) => { if (e.key === 'Escape') done(); else if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); };
  const done = () => { box.hidden = true; document.body.style.overflow = ''; document.removeEventListener('keydown', key); };
  box.querySelector('#lightboxClose').onclick = done;
  box.querySelector('#lightboxPrev').onclick = () => step(-1);
  box.querySelector('#lightboxNext').onclick = () => step(1);
  box.onclick = (e) => { if (e.target === box || e.target === stage) done(); };
  document.addEventListener('keydown', key);
  render();
}

/* ---------- 动效 ---------- */
export const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let io = null;
export function reveal(root = document) {
  const nodes = Array.from(root.querySelectorAll('[data-reveal]'));
  if (!nodes.length) return;
  if (reduceMotion()) { nodes.forEach((n) => n.classList.add('is-in')); return; }
  nodes.forEach((n, idx) => { if (!n.style.getPropertyValue('--reveal-delay')) n.style.setProperty('--reveal-delay', (idx % 12) * 46 + 'ms'); });
  io = io || new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: .1 });
  nodes.forEach((n) => io.observe(n));
}
export function countUp(node, to, opts = {}) {
  const { dur = 1150, decimals = 0, suffix = '' } = opts;
  if (reduceMotion()) { node.textContent = Number(to).toFixed(decimals) + suffix; return; }
  const t0 = performance.now();
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = (Number(to) * eased).toFixed(decimals) + (p === 1 ? suffix : '');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
export function observeCounters(root = document) {
  Array.from(root.querySelectorAll('[data-count]')).forEach((n) => {
    if (n.dataset.counted) return;
    const ob = new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (!e.isIntersecting) return;
        ob.disconnect();
        n.dataset.counted = '1';
        countUp(n, Number(n.dataset.count) || 0, { decimals: Number(n.dataset.decimals || 0), suffix: n.dataset.suffix || '' });
      });
    }, { threshold: .4 });
    ob.observe(n);
  });
}
/**
 * 卡片视差倾斜。旧实现在每次 pointermove 里同步读 getBoundingClientRect()，
 * 划过一个卡片列表就是每帧数十次「读布局 + 写样式」的重排抖动。
 * 现在：rect 只在进框时读一次，写样式合并进一个 rAF，滚动中直接跳过。
 */
export function tilt(node, opts = {}) {
  const { max = 7, scale = 1.012 } = opts;
  if (reduceMotion() || window.matchMedia('(hover: none)').matches) return () => {};
  let rect = null, queued = null, raf = 0;
  const flush = () => {
    raf = 0;
    if (!rect || !queued) return;
    const px = (queued.x - rect.left) / rect.width;
    const py = (queued.y - rect.top) / rect.height;
    queued = null;
    node.style.transform = 'perspective(950px) rotateX(' + ((.5 - py) * max).toFixed(2) + 'deg) rotateY(' + ((px - .5) * max).toFixed(2) + 'deg) translateY(-4px) scale(' + scale + ')';
  };
  const enter = (e) => { rect = node.getBoundingClientRect(); queued = { x: e.clientX, y: e.clientY }; };
  const move = (e) => {
    if (!rect || scrollBusy) return;
    queued = { x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const leave = () => {
    rect = null; queued = null;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    node.style.transform = '';
  };
  node.addEventListener('pointerenter', enter);
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerleave', leave);
  node.addEventListener('pointercancel', leave);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    node.removeEventListener('pointerenter', enter);
    node.removeEventListener('pointermove', move);
    node.removeEventListener('pointerleave', leave);
    node.removeEventListener('pointercancel', leave);
  };
}
export function rippleAll(root = document) {
  Array.from(root.querySelectorAll('.btn, .pager button, .tabs button')).forEach((b) => {
    if (b.dataset.rippled) return;
    b.dataset.rippled = '1';
    b.addEventListener('pointerdown', (e) => {
      if (reduceMotion()) return;
      const pos = getComputedStyle(b).position;
      if (!/relative|absolute|fixed|sticky/.test(pos)) b.style.position = 'relative';
      const r = b.getBoundingClientRect();
      const s = Math.max(r.width, r.height);
      const dot = el('<span class="ripple"></span>');
      dot.style.width = dot.style.height = s + 'px';
      dot.style.left = e.clientX - r.left - s / 2 + 'px';
      dot.style.top = e.clientY - r.top - s / 2 + 'px';
      b.append(dot);
      setTimeout(() => dot.remove(), 660);
    });
  });
}
/**
 * 滚动期一起做三件事：顶部进度条、顶栏毛玻璃态、以及给 <body> 打上
 * is-scrolling（CSS 借此暂停背景极光等环境动画）。
 * 旧实现是两个独立的 scroll 监听，并且进度条改的是 width（每帧触发布局）。
 */
let scrollBusy = false;
let scrollRaf = 0;
let scrollIdleTimer = 0;
function scrollFrame() {
  scrollRaf = 0;
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  const barNode = document.getElementById('scrollProgress');
  if (barNode) {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    barNode.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, y / h) : 0).toFixed(4) + ')';
  }
  const header = document.getElementById('topbar');
  if (header) header.classList.toggle('is-stuck', y > 12);
  document.body.classList.add('is-scrolling');
  clearTimeout(scrollIdleTimer);
  scrollIdleTimer = setTimeout(() => { scrollBusy = false; document.body.classList.remove('is-scrolling'); }, 160);
}
function onScroll() {
  scrollBusy = true;
  if (!scrollRaf) scrollRaf = requestAnimationFrame(scrollFrame);
}
let scrollBound = false;
function bindScroll() {
  if (scrollBound) return;
  scrollBound = true;
  window.addEventListener('scroll', onScroll, { passive: true });
}
export function scrollProgress() { bindScroll(); scrollFrame(); }
export function stickyHeader() { bindScroll(); scrollFrame(); }
/** 顶栏高度会随断点换行变化，实测写回 --nav-h，供所有 sticky 元素对齐 */
export function syncNavMetrics() {
  const header = document.getElementById('topbar');
  if (!header) return;
  const apply = () => {
    const h = Math.round(header.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--nav-h', h + 'px');
  };
  apply();
  if (window.ResizeObserver) new ResizeObserver(apply).observe(header);
  window.addEventListener('resize', apply, { passive: true });
}
/** 元素贴顶时加 is-stuck（用哨兵 + IntersectionObserver，不占用滚动主线程） */
export function markStuck(node) {
  if (!node || !node.parentNode || !('IntersectionObserver' in window)) return () => {};
  const sentinel = el('<span class="stuck-sentinel" aria-hidden="true"></span>');
  node.parentNode.insertBefore(sentinel, node);
  let io = null;
  const build = () => {
    if (io) io.disconnect();
    const top = Math.round(parseFloat(getComputedStyle(node).top) || 0);
    io = new IntersectionObserver((entries) => {
      entries.forEach((e) => node.classList.toggle('is-stuck', !e.isIntersecting && e.boundingClientRect.top < 0));
    }, { rootMargin: '-' + top + 'px 0px 0px 0px', threshold: 0 });
    io.observe(sentinel);
  };
  build();
  window.addEventListener('resize', build, { passive: true });
  return () => { if (io) io.disconnect(); sentinel.remove(); };
}
/**
 * 把高亮胶囊摆到某个链接上。
 * 胶囊 CSS 是 left:0 / top:0，其绝对定位原点是 .mainnav 的 padding box，
 * 而 getBoundingClientRect 给的是 border box，所以要减掉边框宽度；
 * 旧代码没有减，同时还依赖 inset:auto 的「静态位置」（flex 容器里再加一次
 * padding 偏移），于是选中态背景整体比文字低 5px，看着就是没居中。
 */
function navMarker(nav, cls) {
  let m = nav.querySelector('.' + cls);
  if (!m) { m = el('<span class="' + cls + '"></span>'); nav.prepend(m); }
  return m;
}
function placeOn(node, nav, link) {
  const r = link.getBoundingClientRect();
  const pr = nav.getBoundingClientRect();
  node.style.width = r.width + 'px';
  node.style.height = r.height + 'px';
  node.style.transform = 'translate(' + (r.left - pr.left - nav.clientLeft).toFixed(2) + 'px,' + (r.top - pr.top - nav.clientTop).toFixed(2) + 'px)';
  node.classList.add('on');
}
export function placeNavPill(link) {
  const nav = document.getElementById('mainnav');
  if (!nav || !link) return;
  placeOn(navMarker(nav, 'mainnav__pill'), nav, link);
}
/**
 * 悬停高亮：只画一层柔光胶囊，强调色胶囊始终留在当前路由上。
 * 旧写法让实心胶囊跟着指针满场飞，被它划过的文字仍是深色，
 * 浅色模式下瞬间糊成一团（也就是「文字跟着图标滑动变色」）。
 */
export function navPillHover(link) {
  const nav = document.getElementById('mainnav');
  if (!nav) return;
  const ghost = navMarker(nav, 'mainnav__ghost');
  const active = nav.querySelector('a.is-active');
  if (!link || link === active) { ghost.classList.remove('on'); return; }
  placeOn(ghost, nav, link);
}
export function navPill(activePath) {
  const nav = document.getElementById('mainnav');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll('a'));
  links.forEach((a) => {
    const route = a.dataset.route || '/';
    a.classList.toggle('is-active', route === '/' ? activePath === '/' : activePath.indexOf(route) === 0);
  });
  const ghost = nav.querySelector('.mainnav__ghost');
  if (ghost) ghost.classList.remove('on');
  const active = links.find((a) => a.classList.contains('is-active'));
  const pill = nav.querySelector('.mainnav__pill');
  if (!active) { if (pill) pill.classList.remove('on'); return; }
  placeNavPill(active);
}

/* ---------- 复制 / 打开 ---------- */
export async function copy(text, label = '已复制') {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(label, 'ok', 2000);
    return true;
  } catch {
    const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
    ta.value = String(text);
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    toast(ok ? label : '复制失败，请手动选择', ok ? 'ok' : 'bad');
    return ok;
  }
}
export function copyLink(link) {
  const code = link.code ? ' 提取码：' + link.code : '';
  return copy(link.url + code, (link.label || '链接') + (link.code ? ' 与提取码' : ' 链接') + ' 已复制');
}
export function openLink(url) {
  if (/^(magnet:|ed2k:|thunder:)/i.test(url)) {
    toast('正在唤起下载器…无响应可复制链接到迅雷 / qBittorrent', 'info', 4200);
    window.location.href = url;
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/* ---------- 路由 ---------- */
const routes = new Map();
export function defineRoutes(map) { Object.keys(map).forEach((k) => routes.set(k, map[k])); }
export function navigate(path, opts = {}) {
  const target = '#' + (path.charAt(0) === '/' ? path : '/' + path);
  if (location.hash === target) return render();
  if (opts.replace) history.replaceState(null, '', target);
  else { location.hash = target; return; }
  render();
}
export function parseHash() {
  const raw = (location.hash || '#/').slice(1);
  const parts = raw.split('?');
  const segments = parts[0].split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(parts[1] || ''));
  return { path: '/' + segments.join('/'), segments, query };
}
export function resolveRoute() {
  const { path, segments, query } = parseHash();
  for (const entry of routes) {
    const pattern = entry[0];
    const view = entry[1];
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].charAt(0) === ':') params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
      else if (parts[i] !== segments[i]) { ok = false; break; }
    }
    if (ok) return { view, params, query, path };
  }
  return null;
}
export async function render() {
  const host = document.getElementById("view");
  const match = resolveRoute();
  navPill(parseHash().path);
  if (!match) {
    host.innerHTML = '';
    host.append(el('<div class="shell section"><div class="empty"><div class="empty__art">🧭</div><h3>页面走丢了</h3><p>地址不存在或已失效。可以回到 <a class="link-quiet" href="#/library">资源库</a> 继续浏览。</p><a class="btn btn--primary" href="#/">回到首页</a></div></div>'));
    reveal(host);
    return;
  }
  const wasFirst = !render.done;
  host.classList.remove("view--enter");
  host.innerHTML = '';
  /* 换页立刻回到顶部。旧写法是渲染完再平滑滚回去，长页面上等于
     「新页面刚出来又自己滑一段」，观感上就是切页卡顿。 */
  if (!wasFirst) window.scrollTo(0, 0);
  const done = Promise.resolve(match.view(host, { params: match.params, query: match.query }));
  /* 页面函数在第一个 await 之前就把外壳（含骨架屏）写进了 DOM：
     这一帧直接上入场动画与揭示，不必等接口返回。 */
  requestAnimationFrame(() => {
    host.classList.add("view--enter");
    reveal(host);
    observeCounters(host);
    rippleAll(host);
  });
  try {
    await done;
  } catch (err) {
    const msg = escapeHtml(err && err.message ? err.message : String(err));
    if (!host.childElementCount) {
      host.append(el('<div class="shell section"><div class="empty"><div class="empty__art">⚠️</div><h3>页面加载失败</h3><p class="mono tiny">' + msg + '</p><button class="btn btn--sm btn--quiet" onclick="location.reload()">重新加载</button></div></div>'));
      reveal(host);
    } else {
      toast('部分数据加载失败：' + msg, 'bad', 3600);
    }
    render.done = true;
    return;
  }
  reveal(host);
  observeCounters(host);
  rippleAll(host);
  render.done = true;
}
render.done = false;
export function startRouter() {
  window.addEventListener('hashchange', () => { render(); });
  syncNavMetrics();
  scrollProgress();
  stickyHeader();
  render();
}

/* ---------- 通用小组件 ---------- */
export function skeletonGrid(count = 8, wide = false) {
  const wrap = el('<div class="grid' + (wide ? ' grid--wide' : '') + '"></div>');
  for (let i = 0; i < count; i++) {
    wrap.append(el('<div class="skel-card"><div class="skel-card__media skeleton"></div><div class="skel-card__body"><div class="skeleton" style="height:15px;width:72%"></div><div class="skeleton" style="height:11px;width:95%"></div><div class="skeleton" style="height:11px;width:52%"></div><div class="skeleton" style="height:24px;width:40%;margin-top:6px"></div></div></div>'));
  }
  return wrap;
}
export function emptyState(opts = {}) {
  const { icon = '🗂', title = '暂无内容', desc = '', action = '' } = opts;
  return '<div class="empty" data-reveal="scale"><div class="empty__art">' + icon + '</div><h3>' + escapeHtml(title) + '</h3>' + (desc ? '<p>' + desc + '</p>' : '') + (action ? '<div class="row" style="gap:10px">' + action + '</div>' : '') + '</div>';
}
export function scoreBadge(score) {
  const v = Number(score) || 0;
  const cls = v >= 8.5 ? 'badge--ok' : v >= 7 ? 'badge--brand' : v > 0 ? 'badge--warn' : '';
  return '<span class="badge ' + cls + '">★ ' + fmtScore(v) + '</span>';
}
export function providerChips(links, max = 4) {
  const map = new Map();
  links.forEach((l) => { const k = l.provider || l.label; if (!map.has(k)) map.set(k, l); });
  return Array.from(map.values()).slice(0, max).map((l) => '<i title="' + escapeHtml(l.label || l.provider || '') + '" style="background:' + escapeHtml(l.color || '#94a3b8') + '">' + escapeHtml(providerInitial(l.label || l.provider || '?')) + '</i>').join('');
}
export function completenessBar(c = {}) {
  const pct = Number(c.percent) || 0;
  const miss = (c.missing || []).map((m) => '<span class="tag" style="border-color:#fbbf2440;color:#fcd34d">' + escapeHtml(m.label) + '</span>').join('');
  return '<div class="completeness"><div class="row row--between" style="font:500 11px/1 var(--font-mono);color:var(--text-mute)"><span>完整度</span><span>' + pct + '%</span></div><div class="completeness__bar"><i style="width:' + pct + '%"></i></div>' + (miss ? '<div class="pill-list">' + miss + '</div>' : '') + '</div>';
}
export const store = { bootstrap: null, session: null };

/* AURORA 资源库 · 应用入口 */
import { $, $$, el, escapeHtml, Api, store, defineRoutes, startRouter, navigate, toast, Prefs, reveal, rippleAll, modal, imgSrc, fmtScore, relTime, openLightbox, reduceMotion, navPill, navPillHover, syncNavMetrics } from './core.js';
import { resourceCard } from './ui.js';
import { home } from './pages/home.js';
import { library } from './pages/library.js';
import { detail } from './pages/detail.js';
import { search } from './pages/search.js';
import { submitView } from './pages/submit.js';
import { importView } from './pages/import.js';
import { favsView } from './pages/favs.js';

/* ---------- 主题 ---------- */
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f4fb' : '#06070d');
  const btn = $('#themeBtn');
  if (btn) btn.innerHTML = theme === 'light' ? sunIcon() : moonIcon();
}
function moonIcon() { return '<svg viewBox="0 0 24 24" class="icon"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'; }
function sunIcon() { return '<svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'; }

function initTheme() {
  const saved = Prefs.all.theme || 'dark';
  applyTheme(saved);
  const btn = $('#themeBtn');
  if (btn) btn.onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    const apply = () => { applyTheme(next); Prefs.set({ theme: next }); };
    /* 主题切换用 View Transition 做圆形展开：DOM 更新是同步的，不会拖慢动画 */
    if (document.startViewTransition && !reduceMotion()) {
      const r = btn.getBoundingClientRect();
      document.documentElement.style.setProperty('--vt-x', Math.round(r.left + r.width / 2) + 'px');
      document.documentElement.style.setProperty('--vt-y', Math.round(r.top + r.height / 2) + 'px');
      try {
        const t = document.startViewTransition(apply);
        if (t && t.finished) t.finished.catch(() => {});
      } catch { apply(); }
    } else {
      apply();
    }
    toast(next === 'light' ? '已切换到浅色模式' : '已切换到深色模式', 'info', 1500);
  };
}

/* ---------- 命令面板 ---------- */
const palette = {
  root: null, input: null, list: null, items: [], cursor: 0, mode: 'menu', query: '', timer: null,
};
function bindPalette() {
  if (palette.root) return;
  palette.root = $('#palette');
  palette.input = $('#paletteInput');
  palette.list = $('#paletteList');
  palette.root.addEventListener('mousedown', (e) => { if (e.target === palette.root) closePalette(); });
  palette.input.addEventListener('input', () => { palette.query = palette.input.value.trim(); palette.cursor = 0; scheduleQuery(); });
  palette.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(palette.items[palette.cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  palette.list.addEventListener('click', (e) => {
    const item = e.target.closest('[data-idx]');
    if (item) run(palette.items[Number(item.dataset.idx)]);
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    const k = (e.key || '').toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); palette.root.hidden ? openPalette() : closePalette(); }
    else if (k === 'escape' && !palette.root.hidden) closePalette();
    else if (k === '/' && !typing && palette.root.hidden) { e.preventDefault(); openPalette(); }
  });
}
function openPalette() {
  bindPalette();
  palette.root.hidden = false;
  document.body.style.overflow = 'hidden';
  palette.input.value = '';
  palette.query = '';
  palette.cursor = 0;
  draw(defaultItems());
  setTimeout(() => palette.input.focus(), 30);
}
function closePalette() {
  if (palette.root) { palette.root.hidden = true; document.body.style.overflow = ''; }
}

function move(d) {
  if (!palette.items.length) return;
  palette.cursor = (palette.cursor + d + palette.items.length) % palette.items.length;
  draw(palette.items, true);
  const node = palette.list.querySelector('[data-cursor]');
  if (node) node.scrollIntoView({ block: 'nearest' });
}
function scheduleQuery() {
  clearTimeout(palette.timer);
  if (!palette.query) { draw(defaultItems()); return; }
  palette.timer = setTimeout(async () => {
    try {
      const res = await Api.resources({ q: palette.query, pageSize: 7, sort: 'relevance' });
      const items = res.items.map((r) => ({ icon: r.cover ? '🖼' : '📄', label: r.title, hint: r.type + ' · ★' + fmtScore(r.score), run: () => navigate('/resource/' + r.id) }));
      const head = [{ icon: '🌐', label: '聚合搜索「' + palette.query + '」', hint: '同时检索网盘 / 网站 / 磁力', run: () => navigate('/search?q=' + encodeURIComponent(palette.query)) }];
      draw(head.concat(items.length ? items : [{ icon: '·', label: '站内没有匹配的资源', hint: '', run: () => {} }]));
    } catch { draw(defaultItems()); }
  }, 220);
}
function defaultItems() {
  const nav = [
    { icon: '◎', label: '发现 · 首页', hint: '#/', run: () => navigate('/') },
    { icon: '▦', label: '资源库', hint: '#/library', run: () => navigate('/library') },
    { icon: '🌐', label: '聚合搜索', hint: '#/search', run: () => navigate('/search') },
    { icon: '📈', label: 'Excel 导入中心', hint: '#/import', run: () => navigate('/import') },
    { icon: '✍️', label: '手动添加资源', hint: '#/submit', run: () => navigate('/submit') },
    { icon: '★', label: '我的收藏', hint: '#/favs', run: () => navigate('/favs') },
    { icon: '🛠', label: '后台管理', hint: '/admin', run: () => { window.location.href = '/admin'; } },
    { icon: document.documentElement.dataset.theme === 'light' ? '🌙' : '☀️', label: '切换深浅色', hint: 'theme', run: () => { $('#themeBtn').click(); } },
  ];
  const recents = (Prefs.all.recent || []).slice(0, 4).map((t) => ({ icon: '🕘', label: t, hint: '最近浏览 · 聚合搜索', run: () => navigate('/search?q=' + encodeURIComponent(t)) }));
  const tags = (store.bootstrap ? store.bootstrap.tags.slice(0, 4) : []).map((t) => ({ icon: '#', label: '标签：' + t.name, hint: t.count + ' 条', run: () => navigate('/library?tag=' + encodeURIComponent(t.name)) }));
  return nav.concat(recents, tags);
}
function draw(items, keepCursor) {
  palette.items = items;
  if (!keepCursor) palette.cursor = 0;
  palette.list.innerHTML = items.map((it, i) => (
    '<button class="palette__item" data-idx="' + i + '"' + (i === palette.cursor ? ' data-cursor' : '') + '><span class="palette__ico">' + escapeHtml(it.icon) + '</span><span class="grow truncate">' + escapeHtml(it.label) + '</span>'
    + (it.hint ? '<span class="tiny mono muted">' + escapeHtml(it.hint) + '</span>' : '') + '</button>'
  )).join('');
}
function run(item) {
  if (!item) return;
  closePalette();
  item.run();
}

/* ---------- 顶栏 ---------- */
function initChrome() {
  const paletteBtn = $('#paletteBtn');
  if (paletteBtn) paletteBtn.onclick = openPalette;
  const nav = $('#mainnav');
  if (nav && !nav.dataset.scrollBound) {
    nav.dataset.scrollBound = '1';
    nav.addEventListener('pointerover', (e) => {
      const a = e.target.closest('a');
      if (a) navPillHover(a);
    });
    nav.addEventListener('pointerleave', () => navPillHover(null));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#palette') && !$('#palette').hidden) closePalette();
  });
}
function currentPath() {
  const raw = (location.hash || '#/').slice(1).split('?')[0];
  return '/' + raw.split('/').filter(Boolean).join('/');
}

/* ---------- 公告 ---------- */
function showAnnouncement() {
  const text = store.bootstrap && store.bootstrap.settings.announcement;
  if (!text || sessionStorage.getItem('aurora.announce') === text) return;
  const node = el(['<div class="card card--pad" style="max-width:520px">',
    '<div class="row row--between" style="margin-bottom:8px"><span class="badge badge--brand">站点公告</span><button class="icon-btn icon-btn--sm" data-close>×</button></div>',
    '<div class="prose" style="font-size:14px">' + escapeHtml(text) + '</div>',
    '</div>'].join(''));
  modal({ title: '', body: node, size: 'modal--narrow' });
  sessionStorage.setItem('aurora.announce', text);
}

/* ---------- 启动 ---------- */
async function boot() {
  initTheme();
  try {
    store.bootstrap = await Api.bootstrap();
    store.session = store.bootstrap.session;
  } catch (err) {
    document.getElementById('view').innerHTML = '';
    document.getElementById('view').append(el('<div class="shell section"><div class="empty"><div class="empty__art">⚠️</div><h3>无法连接服务</h3><p>' + escapeHtml(err.message || '') + '</p></div></div>'));
    return;
  }
  document.documentElement.style.setProperty('--brand-accent', store.bootstrap.settings.accent || '#7c5cff');
  const site = store.bootstrap.settings.siteName || 'AURORA 资源库';
  document.title = site + ' · ' + (store.bootstrap.settings.tagline || '');
  $$('[data-site-tagline]').forEach((n) => { n.textContent = store.bootstrap.settings.tagline || ''; });
  $$('[data-footer-note]').forEach((n) => { n.textContent = (store.bootstrap.settings.footerNote || '') + (store.bootstrap.settings.icp ? ' · ' + store.bootstrap.settings.icp : ''); });
  const brand = $('#brandName');
  if (brand) brand.textContent = String(site).split(' ')[0].toUpperCase();
  const adminLink = Array.from($$('.topbar__actions a')).find((a2) => a2.getAttribute('href') === '/admin');
  if (adminLink && store.session && store.session.authed) adminLink.innerHTML = '后台 · ' + escapeHtml(store.session.user);
  defineRoutes({
    '/': home,
    '/library': library,
    '/resource/:id': detail,
    '/search': search,
    '/submit': submitView,
    '/import': importView,
    '/favs': favsView,
  });
  bindPalette();
  startRouter();
  initChrome();
  rippleAll(document);
  reveal(document);
  showAnnouncement();
  window.__aurora = { store, navigate, toast, Api, openLightbox, modal, el, escapeHtml, resourceCard, applyTheme };
}
boot();

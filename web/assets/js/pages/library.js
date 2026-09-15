/* 资源库：筛选 + 网格 + 分页 */
import { $, $$, el, escapeHtml, Api, store, skeletonGrid, reveal, navigate, emptyState, parseHash, Prefs, toast, openLightbox, fmtScore, markStuck } from '../core.js';
import { resourceCard } from '../ui.js';

const state = { q: '', types: [], tags: [], providers: [], sort: 'newest', page: 1, pageSize: 24, total: 0, totalPages: 1, items: [], loading: false };

export async function library(host, ctx) {
  const b = store.bootstrap;
  const q = ctx.query || {};
  state.q = q.q || '';
  state.types = q.type ? [q.type] : [];
  state.tags = q.tag ? q.tag.split('|') : [];
  state.providers = q.provider ? q.provider.split('|') : [];
  state.sort = q.sort || 'newest';
  state.page = Number(q.page) || 1;

  host.innerHTML = [
    '<div class="shell section--tight" style="padding-top:26px">',
    '<div class="sec-head" style="margin-bottom:16px">',
    '<div><span class="eyebrow">Library</span><h2 data-page-title>资源库</h2><p id="libSummary">按类型、标签与网盘来源筛选；支持标题 / 名字模糊检索。</p></div>',
    '<div class="row" style="gap:8px"><a class="btn btn--quiet btn--sm" href="#/import">导入 Excel</a><a class="btn btn--primary btn--sm" href="#/submit">手动添加</a></div>',
    '</div>',
    /* 搜索导航条：整块是带描边 / 阴影的粘性面板，贴顶时再加深层级 */
    '<div class="filters" id="libFilters">',
    '<div class="filters__row">',
    '<label class="search-inline"><svg viewBox="0 0 24 24" class="icon" style="color:var(--text-mute)"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5.5 13.5L20 21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    '<input id="libSearch" type="search" role="searchbox" placeholder="搜索标题、简介、标签或网盘链接…" value="' + escapeHtml(state.q) + '" autocomplete="off" />',
    '<button class="btn btn--sm btn--primary" id="libGo" type="submit">搜索</button></label>',
    '<div class="pill-tabs" id="sortTabs" role="group" aria-label="排序方式">',
    [['newest', '最新'], ['score', '高分'], ['views', '最热'], ['updated', '更新']].map(([k, n]) => '<button class="chip' + (state.sort === k ? ' is-on' : '') + '" data-sort="' + k + '">' + n + '</button>').join(''),
    '</div>',
    '</div>',
    '<div class="filters__row" id="activeFilters"></div>',
    '</div>',
    '<div class="lib-layout">',
    '<aside class="lib-side">',
    '<div class="side-group"><h4>类型</h4><div class="side-list" id="typeList"></div></div>',
    '<div class="side-group"><h4>热门标签</h4><div class="side-list" id="tagList"></div></div>',
    '<div class="side-group"><h4>网盘 / 磁力</h4><div class="side-list" id="provList"></div></div>',
    '<div class="side-group"><h4>我的收藏</h4><div class="side-list" id="favList"></div></div>',
    '</aside>',
    '<div><div class="grid grid--wide" id="libGrid"></div><div class="pager" id="libPager"></div></div>',
    '</div>',
    '</div>',
  ].join('');

  renderSidebar(host);
  bindSearch(host);
  /* 侧栏吸附位置跟着筛选面板实际高度走，窄屏换行时也不会被面板压住 */
  const filters = host.querySelector('#libFilters');
  const layout = host.querySelector('.lib-layout');
  if (filters) {
    markStuck(filters);
    const side = host.querySelector('.lib-side');
    if (layout && window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        layout.style.setProperty('--filters-h', Math.round(filters.getBoundingClientRect().height) + 'px');
      });
      ro.observe(filters);
      host.__filtersRO = ro;
    }
  }
  await load(host, true);
}

function renderSidebar(host) {
  const b = store.bootstrap;
  const typeList = host.querySelector('#typeList');
  typeList.innerHTML = b.types.map((t) => '<button data-type="' + escapeHtml(t.key) + '" class="' + (state.types.includes(t.key) ? 'is-on' : '') + '"><i style="background:' + t.color + '"></i><span class="truncate">' + escapeHtml(t.name) + '</span><span class="n">' + (t.count || 0) + '</span></button>').join('');
  const tagList = host.querySelector('#tagList');
  tagList.innerHTML = b.tags.slice(0, 18).map((t) => '<button data-tag="' + escapeHtml(t.name) + '" class="' + (state.tags.includes(t.name) ? 'is-on' : '') + '"><i style="background:' + (t.color || '#7c5cff') + '"></i><span class="truncate">' + escapeHtml(t.name) + '</span><span class="n">' + (t.count || 0) + '</span></button>').join('');
  const provList = host.querySelector('#provList');
  const provCount = new Map();
  b.providers.forEach(() => {});
  const counts = window.__provCounts || new Map();
  provList.innerHTML = b.providers.slice(0, 16).map((p) => '<button data-provider="' + p.key + '" class="' + (state.providers.includes(p.key) ? 'is-on' : '') + '"><i style="background:' + p.color + '"></i><span class="truncate">' + escapeHtml(p.name) + '</span><span class="n">' + (counts.get(p.name) || counts.get(p.key) || '') + '</span></button>').join('');
  const favs = Prefs.favList();
  const favList = host.querySelector('#favList');
  favList.innerHTML = favs.length
    ? favs.slice(0, 12).map((f) => '<button data-open="' + f.id + '"><i style="background:var(--amber)"></i><span class="truncate">' + escapeHtml(f.title) + '</span></button>').join('')
    : '<p class="tiny muted">在卡片右上角点 ★ 收藏资源，收藏保存在本机。</p>';

  typeList.onclick = (e) => toggleFilter(e, 'types');
  tagList.onclick = (e) => toggleFilter(e, 'tags');
  provList.onclick = (e) => toggleFilter(e, 'providers');
  favList.onclick = (e) => {
    const btn = e.target.closest('[data-open]');
    if (btn) navigate('/resource/' + btn.dataset.open);
  };
}

function toggleFilter(e, key) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const value = btn.dataset.type || btn.dataset.tag || btn.dataset.provider;
  if (!value) return;
  const i = state[key].indexOf(value);
  if (i > -1) state[key].splice(i, 1); else state[key].push(value);
  state.page = 1;
  btn.classList.toggle('is-on');
  load(btn.closest('.shell'), false);
}

function bindSearch(host) {
  const input = host.querySelector('#libSearch');
  const go = () => { state.q = input.value.trim(); state.page = 1; load(host, true); };
  host.querySelector('#libGo').onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  /* 输入即搜：620ms 防抖；清空输入也回到全部列表 */
  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const v = input.value.trim();
      if (v.length >= 2 || (!v && state.q)) go();
    }, 620);
  });
  input.addEventListener('search', () => { if (!input.value.trim()) go(); });
  host.querySelector('#sortTabs').onclick = (e) => {
    const btn = e.target.closest('[data-sort]');
    if (!btn) return;
    state.sort = btn.dataset.sort;
    state.page = 1;
    $$('#sortTabs .chip', host).forEach((c) => c.classList.toggle('is-on', c === btn));
    load(host, false);
  };
}

function syncUrl() {
  const parts = [];
  if (state.q) parts.push('q=' + encodeURIComponent(state.q));
  if (state.types.length) parts.push('type=' + encodeURIComponent(state.types[0]));
  if (state.tags.length) parts.push('tag=' + encodeURIComponent(state.tags.join('|')));
  if (state.providers.length) parts.push('provider=' + encodeURIComponent(state.providers.join('|')));
  if (state.sort !== 'newest') parts.push('sort=' + state.sort);
  if (state.page > 1) parts.push('page=' + state.page);
  const next = '#/library' + (parts.length ? '?' + parts.join('&') : '');
  history.replaceState(null, '', next);
}

function renderActive(host) {
  const box = host.querySelector('#activeFilters');
  const chips = [];
  if (state.q) chips.push({ label: '关键词：' + state.q, clear: () => { state.q = ''; } });
  state.types.forEach((t) => chips.push({ label: '类型：' + t, clear: () => { state.types = state.types.filter((x) => x !== t); } }));
  state.tags.forEach((t) => chips.push({ label: '标签：' + t, clear: () => { state.tags = state.tags.filter((x) => x !== t); } }));
  state.providers.forEach((p) => {
    const prov = store.bootstrap.providers.find((x) => x.key === p);
    chips.push({ label: '来源：' + (prov ? prov.name : p), clear: () => { state.providers = state.providers.filter((x) => x !== p); } });
  });
  if (!chips.length) { box.innerHTML = '<span class="tiny muted">未设置筛选条件 · 显示全部资源</span>'; return; }
  box.innerHTML = '<span class="tiny muted">当前条件</span>' + chips.map((c, i) => '<button class="chip" data-clear="' + i + '">' + escapeHtml(c.label) + ' ×</button>').join('') + '<button class="chip" data-clear="all">清空全部</button>';
  box.onclick = (e) => {
    const btn = e.target.closest('[data-clear]');
    if (!btn) return;
    const key = btn.dataset.clear;
    if (key === 'all') { state.q = ''; state.types = []; state.tags = []; state.providers = []; }
    else { const fn = chips[Number(key)]; if (fn) fn.clear(); }
    state.page = 1;
    renderSidebar(host);
    load(host, false);
  };
}

let loadSeq = 0;
async function load(host, reset) {
  const seq = ++loadSeq;
  const grid = host.querySelector('#libGrid');
  if (!grid) return;
  syncUrl();
  renderActive(host);
  grid.innerHTML = '';
  grid.append(skeletonGrid(reset ? 8 : 4, true));
  state.loading = true;
  try {
    const res = await Api.resources({
      q: state.q, type: state.types.join(','), tag: state.tags.join(','), provider: state.providers.join(','),
      sort: state.sort, page: state.page, pageSize: state.pageSize,
    });
    if (seq !== loadSeq) return;            /* 迟到的旧请求结果直接丢弃，避免列表闪回 */
    state.items = res.items;
    state.total = res.total;
    state.totalPages = res.totalPages;
    grid.innerHTML = '';
    if (!res.items.length) {
      grid.innerHTML = emptyState({ icon: '🔍', title: '没有匹配的资源', desc: '换个关键词，或去<a class="link-quiet" href="#/search?q=' + encodeURIComponent(state.q) + '">聚合搜索</a>找找网盘、网站与磁力来源。', action: '<button class="btn btn--sm btn--quiet" onclick="location.reload()">重置筛选</button>' });
    } else {
      const frag = document.createDocumentFragment();
      res.items.forEach((r) => frag.append(resourceCard(r)));
      grid.append(frag);
    }
    host.querySelector('#libSummary').textContent = '共 ' + res.total + ' 条资源 · 第 ' + res.page + '/' + res.totalPages + ' 页 · 按' + ({ newest: '最新入库', score: '分数', views: '热度', updated: '更新时间', relevance: '相关度' }[state.sort] || state.sort) + '排序';
    renderPager(host);
    reveal(grid);
  } catch (err) {
    if (seq !== loadSeq) return;
    grid.innerHTML = emptyState({ icon: '⚠️', title: '加载失败', desc: escapeHtml(err.message || '网络异常') });
  } finally {
    if (seq === loadSeq) state.loading = false;
  }
}

function renderPager(host) {
  const box = host.querySelector('#libPager');
  if (state.totalPages <= 1) { box.innerHTML = ''; return; }
  const items = [];
  const push = (label, page, on, disabled) => items.push('<button data-page="' + page + '"' + (on ? ' class="is-on"' : '') + (disabled ? ' disabled' : '') + '>' + label + '</button>');
  push('‹', state.page - 1, false, state.page <= 1);
  const pages = new Set([1, state.totalPages, state.page, state.page - 1, state.page + 1]);
  let last = 0;
  [...pages].filter((p) => p >= 1 && p <= state.totalPages).sort((a, b) => a - b).forEach((p) => {
    if (p - last > 1) items.push('<span class="muted">…</span>');
    push(String(p), p, p === state.page, false);
    last = p;
  });
  push('›', state.page + 1, false, state.page >= state.totalPages);
  box.innerHTML = items.join('');
  box.onclick = (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    state.page = Number(btn.dataset.page);
    load(host, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
}

/* ============ AURORA 控制台 ============ */
import {
  $, $$, el, escapeHtml, nl2br, Api, api, toast, modal, confirmDialog, reveal, observeCounters, countUp,
  rippleAll, stickyHeader, navPill, fmtDate, relTime, fmtBytes, fmtScore, imgSrc, providerInitial, copy,
  openLightbox, Prefs, store, skeletonGrid, emptyState, reduceMotion, tilt, mdLite, navigate, clampText, completenessBar,
} from './core.js';
import { resourceCard, linkRow, galleryGrid, scoreRing, animateRing, progressBar, typeBadge } from './ui.js';
import { formKit } from './form.js';

const NAV = [
  { grp: '内容' },
  { hash: '#/dash', icon: '◎', name: '总览' },
  { hash: '#/resources', icon: '▦', name: '资源管理' },
  { hash: '#/gaps', icon: '✧', name: '批量补全' },
  { hash: '#/submissions', icon: '✉', name: '投稿审核', badge: 'submissions' },
  { hash: '#/import', icon: '↧', name: '导入中心' },
  { hash: '#/archive', icon: '⛯', name: '回收站' },
  { grp: '组织' },
  { hash: '#/taxonomy', icon: '＃', name: '分类标签' },
  { hash: '#/sources', icon: '🛰', name: '检索来源' },
  { hash: '#/media', icon: '🖼', name: '媒体库' },
  { grp: '系统' },
  { hash: '#/logs', icon: '🕘', name: '操作日志' },
  { hash: '#/settings', icon: '⚙', name: '站点设置' },
  { hash: '#/backup', icon: '💾', name: '数据备份' },
];
const VIEWS = {
  '/dash': viewDash, '/resources': viewResources, '/new': (main, ctx) => viewEditor(main, null), '/edit/:id': viewEditor,
  '/gaps': viewGaps, '/submissions': viewSubmissions, '/import': viewImport, '/archive': viewArchive, '/taxonomy': viewTaxonomy,
  '/sources': viewSources, '/media': viewMedia, '/logs': viewLogs, '/settings': viewSettings, '/backup': viewBackup,
};
const state = { path: '/', authed: false, user: 'admin', pending: 0, resFilters: { q: '', status: '', type: '', lack: '', sort: 'updated', page: 1, pageSize: 20 }, picked: new Set(), imp: null };

/* ---------- 启动 ---------- */
async function boot() {
  initTheme();
  bindChrome();
  window.addEventListener('hashchange', route);
  try {
    store.bootstrap = await Api.bootstrap();
    store.session = store.bootstrap.session || null;
    state.authed = !!(store.bootstrap.session && store.bootstrap.session.authed);
    state.user = state.authed ? store.bootstrap.session.user : 'admin';
    paintSession();
    keepSessionAlive();
  } catch (err) {
    $('#adminMain').innerHTML = '';
    $('#adminMain').append(el('<div class="empty"><div class="empty__art">⚠️</div><h3>无法连接服务</h3><p>' + escapeHtml(err.message || '') + '</p></div>'));
    return;
  }
  showGate(!state.authed);
  route();
  refreshBadges();
}
function initTheme() {
  const theme = Prefs.all.theme || 'dark';
  document.documentElement.dataset.theme = theme;
  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    Prefs.set({ theme: next });
    toast(next === 'light' ? '浅色模式' : '深色模式', 'info', 1400);
  };
}
function bindChrome() {
  $('#admin').classList.add('is-ready');
  const render = () => {
    $('#adminNav').innerHTML = NAV.map((n) => n.grp
      ? '<div class="admin-nav__grp">' + escapeHtml(n.grp) + '</div>'
      : '<a href="' + n.hash + '" data-hash="' + n.hash + '"><i>' + n.icon + '</i><span>' + escapeHtml(n.name) + '</span>' + (n.badge ? '<b data-badge="' + n.badge + '" hidden></b>' : '') + '</a>').join('');
  };
  render();
  $('#adminBurger').onclick = () => $('#admin').classList.toggle('is-open');
  $('#adminSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); location.hash = '#/resources?q=' + encodeURIComponent(e.target.value.trim()); }
  });
  $('#logoutBtn').onclick = async () => {
    if (!(await confirmDialog({ title: '退出登录', text: '确定退出控制台？', okText: '退出' }))) return;
    try { await Api.logout(); } catch {}
    state.authed = false;
    store.session = null;
    showGate(true);
    paintSession();
    toast('已退出登录', 'ok');
  };
  $('#adminVersion').textContent = 'AURORA VAULT · ' + (store.bootstrap ? store.bootstrap.version : '1.0') + ' · ' + (store.bootstrap ? store.bootstrap.stats.resources : 0) + ' 条资源';
}
const REMEMBER_KEY = 'aurora.remember';
function showGate(show) {
  const gate = $('#adminLogin');
  gate.hidden = !show;
  if (!show) return;
  const note = $('#loginNote');
  if (note) note.textContent = '会话记在浏览器里：刷新、切换前后台、甚至重启服务都不用重新登录。';
  const box = $('#loginRemember');
  if (box) box.checked = localStorage.getItem(REMEMBER_KEY) !== '0';
  setTimeout(() => $('#loginPass').focus(), 60);
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    const remember = !!(box && box.checked);
    if (box) localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const res = await Api.login($('#loginUser').value.trim(), $('#loginPass').value, remember);
      state.authed = true;
      state.user = res.user || 'admin';
      store.session = { authed: true, user: state.user, remember, expires: res.expires || 0 };
      paintSession();
      gate.hidden = true;
      toast(res.message || '登录成功', 'ok', 4600);
      route();
      refreshBadges();
    } catch (err) {
      if (note) note.textContent = err.message || '登录失败';
      toast(err.message || '登录失败', 'bad', 4600);
    }
    btn.disabled = false;
    btn.textContent = '登录控制台';
  };
}
/** 侧栏那行小字：让人看得见「这次登录能撑到什么时候」 */
function paintSession() {
  const node = $('#sessionNote');
  const user = $('#adminUser');
  if (user) {
    const b = user.querySelector('b');
    if (b) b.textContent = state.authed ? state.user : '未登录';
    const s = user.querySelector('span span, .tiny');
    if (s) s.textContent = state.authed ? '已登录' : '需要口令';
  }
  if (!node) return;
  if (!state.authed) { node.textContent = '会话：未登录'; return; }
  const exp = (store.session && store.session.expires) || 0;
  const left = exp ? Math.max(0, exp - Date.now()) : 0;
  const day = Math.floor(left / 86400000);
  const hr = Math.floor((left % 86400000) / 3600000);
  node.textContent = '会话：' + (store.session && store.session.remember ? '记住登录 ' : '') + (day ? day + ' 天 ' : '') + hr + ' 小时'
    + ' · 使用中自动续期';
  node.style.color = left && left < 3600 * 1000 ? 'var(--amber)' : '';
}
/**
 * 保活：标签页重新可见、窗口重新聚焦、以及每 4 分钟一次心跳，都去敲 /api/admin/session。
 * 服务端会滑动续期并把 Set-Cookie 发回来，于是「切到前台待一会儿再回后台」不会再要口令。
 */
let heartbeat = 0;
function keepSessionAlive() {
  if (heartbeat) return;
  const ping = async (silent) => {
    try {
      const s = await Api.session();
      const authed = !!(s && s.authed);
      if (authed !== state.authed) {
        state.authed = authed;
        if (authed) { state.user = s.user || 'admin'; showGate(false); route(); refreshBadges(); }
        else showGate(true);
      }
      store.session = { authed, user: s.user || null, expires: s.expires || 0, remember: !!s.remember };
      paintSession();
    } catch (err) {
      if (err && err.status === 401 && state.authed) { state.authed = false; store.session = null; showGate(true); paintSession(); }
    }
  };
  heartbeat = setInterval(() => ping(false), 4 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(true); });
  window.addEventListener('focus', () => ping(true));
}
/** 401 自愈：先确认一次会话，别把还有效的 Cookie 判成「请重新登录」 */
async function recover401() {
  try {
    const s = await Api.session();
    if (s && s.authed) {
      state.authed = true;
      store.session = { authed: true, user: s.user, expires: s.expires, remember: !!s.remember };
      paintSession();
      return true;
    }
  } catch {}
  state.authed = false;
  showGate(true);
  paintSession();
  return false;
}
async function refreshBadges() {
  try {
    const res = await Api.admin.submissions('pending');
    state.pending = (res.items || []).length;
    const b = $('[data-badge="submissions"]');
    if (b) { b.hidden = !state.pending; b.textContent = state.pending; }
  } catch {}
}

/* ---------- 路由 ---------- */
function parseHash() {
  const raw = (location.hash || '#/dash').slice(1);
  const [pathPart, queryPart] = raw.split('?');
  return { segments: pathPart.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(queryPart || '')) };
}
function resolveView(segments) {
  const path = '/' + segments.join('/');
  if (VIEWS[path]) return { fn: VIEWS[path], params: {} };
  if (segments.length === 2 && segments[0] === 'edit') return { fn: VIEWS['/edit/:id'], params: { id: segments[1] } };
  return null;
}
async function route() {
  const main = $('#adminMain');
  const { segments, query } = parseHash();
  const match = resolveView(segments);
  $('#admin').classList.remove('is-open');
  $$('#adminNav a').forEach((a) => {
    const h = a.dataset.hash.replace('#/', '');
    a.classList.toggle('is-active', h === segments[0] || (segments[0] === '' && h === 'dash'));
  });
  document.title = (segments[0] ? crumbs(segments[0]) : '总览') + ' · AURORA 控制台';
  $('#adminCrumb').innerHTML = '<span class="mono tiny muted">控制台</span><span class="muted">/</span><b>' + escapeHtml(crumbs(segments[0] || 'dash')) + '</b>';
  if (!state.authed) {
    // bootstrap 说没登录也别急着弹口令：再确认一次签名 Cookie（从前台切回来的路径最容易撞到这里）
    const ok = await recover401();
    if (!ok) { renderLoginInto(main); return; }
  }
  if (!match) { main.innerHTML = emptyState({ icon: '🧭', title: '没有这个后台页面', action: '<a class="btn btn--sm btn--primary" href="#/dash">回到总览</a>' }); return; }
  main.innerHTML = '<div class="admin-boot"><span class="spinner"></span><span class="small muted">加载中…</span></div>';
  try {
    main.innerHTML = '';
    await match.fn(main, { params: match.params, query });
  } catch (err) {
    main.innerHTML = '';
    if (err && err.status === 401) { if (await recover401()) { route(); return; } return; }
    main.append(el('<div class="empty"><div class="empty__art">⚠️</div><h3>加载失败</h3><p>' + escapeHtml(err.message || '未知错误') + '</p><a class="btn btn--sm btn--quiet" href="#/dash">回总览</a></div>'));
    return;
  }
  reveal(main);
  observeCounters(main);
  rippleAll(main);
  if (!reduceMotion()) main.scrollTo ? window.scrollTo({ top: 0 }) : null;
  else window.scrollTo({ top: 0 });
}
function crumbs(seg) {
  const found = NAV.find((n) => n.hash === '#/' + seg);
  if (seg === 'edit') return '编辑资源';
  if (seg === 'new') return '新建资源';
  if (seg === 'gaps') return '批量补全';
  return found ? found.name : '总览';
}
function renderLoginInto(main) {
  main.innerHTML = '';
  main.append(el('<div class="empty"><div class="empty__art">🔐</div><h3>请先登录</h3><p>控制台需要管理员口令（默认 admin / aurora888）。</p></div>'));
  showGate(true);
}
function head(title, desc, acts) {
  return '<div class="admin-h" data-reveal><div><h2>' + escapeHtml(title) + '</h2>' + (desc ? '<p>' + escapeHtml(desc) + '</p>' : '') + '</div><div class="row row--wrap" style="gap:8px">' + (acts || '') + '</div></div>';
}
function card(title, inner, extra) {
  return '<div class="card card--pad" data-reveal' + (extra ? ' ' + extra : '') + '><div class="panel-h"><h3>' + escapeHtml(title) + '</h3><span class="grow"></span></div>' + inner + '</div>';
}
async function guard(promise, host) {
  try { return await promise; } catch (err) {
    if (err && err.status === 401) { await recover401(); throw err; }
    host.innerHTML = '';
    host.append(el('<div class="empty"><div class="empty__art">⚠️</div><h3>' + escapeHtml(err.message || '请求失败') + '</h3></div>'));
    throw err;
  }
}


/* ---------- 总览 ---------- */
async function viewDash(main) {
  const data = await guard(Api.admin.overview(), main);
  const s = data.stats;
  const tiles = [
    ['资源总数', s.resources, '▦', 0], ['已发布', s.published, '✓', 0], ['草稿', s.drafts, '✎', 0],
    ['待审投稿', s.submissions, '✉', 0], ['信息不全', s.incomplete, '⚠', 0], ['归档', s.archived, '⛯', 0],
    ['下载链接', s.downloads, '↧', 0], ['其他来源', s.others, '↗', 0], ['图片', s.images, '🖼', 0],
    ['平均分数', s.avgScore, '★', 1], ['浏览量', s.views, '👁', 0], ['今日搜索', s.todaySearches, '⌕', 0],
  ];
  main.innerHTML = [
    head('总览', '数据快照 · 最近 ' + data.logs.length + ' 条日志', '<button class="btn btn--sm btn--quiet" id="quickCheck">检测全部链接</button><a class="btn btn--sm btn--primary" href="#/new">+ 新建资源</a>'),
    '<div class="stat-grid" data-reveal>' + tiles.map(([label, val, ico, dec]) => '<div class="stat-tile"><i>' + ico + '</i><b data-count="' + (Number(val) || 0) + '"' + (dec ? ' data-decimals="1"' : '') + '>0</b><span>' + label + '</span></div>').join('') + '</div>',
    '<div class="admin-cols">',
    '<div style="display:grid;gap:16px">',
    card('近 14 天活动', sparkHtml(s.daily)),
    card('最近入库', recentTable(data.recent)),
    card('待处理投稿', data.pending && data.pending.length ? '<div class="tl">' + data.pending.map((p) => '<div class="tl__item"><div class="row row--between"><b class="small truncate">' + escapeHtml(p.title) + '</b><a class="btn btn--sm btn--quiet" href="#/submissions">去审核</a></div><div class="tiny mono muted">' + relTime(p.createdAt) + ' · ' + escapeHtml(p.from || '匿名') + ' · 完整度 ' + ((p.completeness && p.completeness.percent) || 0) + '%</div></div>').join('') + '</div>' : '<p class="tiny muted">投稿箱已清空 🎉</p>'),
    '</div>',
    '<div style="display:grid;gap:16px">',
    card('类型分布', barsHtml(s.typeCounts)),
    card('来源占比', barsHtml((s.providers || []).map((p) => ({ key: p.name, name: p.name, count: p.count, color: '#22d3ee' })))),
    card('热门标签', '<div class="tag-cloud">' + (s.hotTags || []).map((t) => '<a class="tag" style="border-color:' + (t.color || '#7c5cff') + '55;color:' + (t.color || '#c9bcff') + '" href="#/resources?q=' + encodeURIComponent(t.name) + '">#' + escapeHtml(t.name) + ' <b class="mono tiny muted">' + t.count + '</b></a>').join('') + '</div>'),
    card('最多浏览', '<div class="tl">' + (s.topViewed || []).map((r) => '<a class="tl__item" href="#/edit/' + r.id + '" style="display:block"><div class="row row--between"><b class="truncate small">' + escapeHtml(r.title) + '</b><span class="mono tiny muted">' + r.views + '</span></div></a>').join('') + '</div>'),
    card('健康度', '<div class="bars">' + [['待审投稿', s.submissions, '#f472b6'], ['信息不全', s.incomplete, '#fbbf24'], ['草稿', s.drafts, '#22d3ee']].map(([k, v, c]) => '<div class="bars__row"><span>' + k + '</span><div class="bars__track"><i class="bars__fill" style="width:' + Math.min(100, ((v || 0) / Math.max(1, s.resources)) * 100) + '%;background:' + c + '"></i></div><span class="mono" style="text-align:right">' + (v || 0) + '</span></div>').join('') + '</div>'),
    card('最近日志', '<div class="tl">' + data.logs.slice(0, 10).map(logLine).join('') + '</div>'),
    '</div>',
    '</div>',
  ].join('');
  main.querySelector('#quickCheck').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = '检测中…';
    try { const r = await Api.admin.maintenance({ action: 'check-all' }); toast(r.message || '检测完成', 'ok'); } catch (err) { toast(err.message, 'bad'); }
    e.target.disabled = false;
    e.target.textContent = '检测全部链接';
  };
}
function logLine(l) {
  const kindColor = { import: '#34d399', submission: '#f472b6', error: '#fb7185', login: '#fbbf24', system: '#94a3b8', export: '#22d3ee', source: '#a78bfa', backup: '#a3e635' };
  return '<div class="tl__item"><div class="row row--between"><span class="tl__k" style="color:' + (kindColor[l.kind] || '#94a3b8') + '">' + escapeHtml(l.kind || 'log') + '</span><span class="mono tiny muted">' + relTime(l.at) + '</span></div><div class="small">' + escapeHtml(l.message || '') + '</div></div>';
}
function sparkHtml(daily) {
  const days = daily || [];
  if (!days.length) return '<p class="tiny muted">暂无活动数据</p>';
  const max = Math.max(1, ...days.map((d) => (d.searches || 0) + (d.views || 0)));
  return '<div class="spark">' + days.map((d) => {
    const total = (d.searches || 0) + (d.views || 0);
    const h = Math.max(2, Math.round((total / max) * 74));
    return '<div class="spark__col" title="' + escapeHtml(d.day) + ' · 搜索 ' + (d.searches || 0) + ' / 浏览 ' + (d.views || 0) + ' / 导入 ' + (d.imports || 0) + ' / 投稿 ' + (d.submissions || 0) + '"><i class="spark__bar" style="height:' + h + 'px"></i><span>' + escapeHtml(String(d.day).slice(5)) + '</span></div>';
  }).join('') + '</div>';
}
function barsHtml(rows) {
  const list = rows || [];
  if (!list.length) return '<p class="tiny muted">暂无数据</p>';
  const max = Math.max(...list.map((t) => t.count || 0), 1);
  return '<div class="bars">' + list.map((t) => '<a class="bars__row" href="#/resources?type=' + encodeURIComponent(t.key || '') + '" style="color:inherit"><span class="truncate">' + escapeHtml(t.name || t.key) + '</span><div class="bars__track"><i class="bars__fill" style="width:' + Math.max(3, ((t.count || 0) / max) * 100) + '%;background:' + (t.color || '#7c5cff') + '"></i></div><span class="mono" style="text-align:right">' + (t.count || 0) + '</span></a>').join('') + '</div>';
}
function recentTable(items) {
  if (!items || !items.length) return '<p class="tiny muted">还没有资源，先去<a class="link-quiet" href="#/import">导入中心</a>。</p>';
  return '<div class="table-wrap"><table class="table table--compact admin-table"><tbody>' + items.map((r) => (
    '<tr><td style="width:56px">' + (r.cover ? '<img src="' + imgSrc(r.cover, r.title) + '" alt="" loading="lazy" />' : '<span class="ph">' + escapeHtml(providerInitial(r.title)) + '</span>') + '</td>'
    + '<td><div class="cell-title"><span style="min-width:0"><a class="truncate" href="#/edit/' + r.id + '" style="font-weight:600">' + escapeHtml(r.title) + '</a><br /><span class="tiny mono muted">' + relTime(r.updatedAt) + ' · ' + escapeHtml(r.status) + '</span></span></div></td>'
    + '<td>' + typeBadge(r.type) + '</td>'
    + '<td class="mono tiny" style="text-align:right">★ ' + fmtScore(r.score) + '</td></tr>'
  )).join('') + '</tbody></table></div>';
}

/* ---------- 资源管理 ---------- */
async function viewResources(main, ctx) {
  const f = state.resFilters;
  const q = ctx.query || {};
  ['q', 'status', 'type', 'lack', 'sort'].forEach((k) => { if (q[k] !== undefined) f[k] = q[k]; });
  if (q.page) f.page = Number(q.page);
  main.innerHTML = [
    head('资源管理', '增删改查 · 批量操作 · 失效检测 · 回收站', '<a class="btn btn--sm btn--quiet" href="#/archive">回收站</a><a class="btn btn--sm btn--primary" href="#/new">+ 新建资源</a>'),
    '<div class="admin-toolbar" data-reveal>',
    '<input class="input" id="fq" placeholder="搜索标题 / 标签 / 简介" value="' + escapeHtml(f.q) + '" />',
    '<div class="seg" id="fStatus">' + [['', '全部'], ['published', '已发布'], ['draft', '草稿'], ['archived', '归档']].map(([k, n]) => '<button data-v="' + k + '" class="' + (f.status === k ? 'on' : '') + '">' + n + '</button>').join('') + '</div>',
    '<div class="select-wrap"><select class="select" id="fType"><option value="">全部类型</option>' + store.bootstrap.types.map((t) => '<option' + (f.type === t.key ? ' selected' : '') + '>' + escapeHtml(t.key) + '</option>').join('') + '</select></div>',
    '<div class="select-wrap"><select class="select" id="fLack"><option value="">不限完整度</option>' + [['incomplete', '仅未完善'], ['complete', '仅已完整'], ['dead', '含失效链接']].map(([k, n]) => '<option value="' + k + '"' + (f.lack === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>',
    '<div class="select-wrap"><select class="select" id="fSort">' + [['updated', '按更新'], ['newest', '按入库'], ['score', '按分数'], ['views', '按浏览'], ['title', '按标题']].map(([k, n]) => '<option value="' + k + '"' + (f.sort === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>',
    '<span class="grow"></span>',
    '<div class="select-wrap"><select class="select" id="bulkAction" style="min-width:126px"><option value="">批量操作…</option><option value="publish">发布</option><option value="draft">转草稿</option><option value="feature">设精选</option><option value="unfeature">取消精选</option><option value="archive">归档</option><option value="delete">删除</option></select></div>',
    '<button class="btn btn--sm btn--primary" id="bulkGo">执行</button>',
    '<button class="btn btn--sm btn--quiet" id="checkPicked">检测链接</button>',
    '<button class="btn btn--sm btn--quiet" id="gapsGo" title="抓取来源页 / 联网检索，只填空着的位置">✧ 批量补全空白</button>',
    '</div>',
    '<div id="resSummary" class="row row--wrap tiny mono muted" style="gap:10px;margin-bottom:10px"></div>',
    '<div class="table-wrap"><table class="table admin-table" id="resTable"></table></div>',
    '<div class="pager" id="resPager"></div>',
  ].join('');
  bindFilters(main);
  await loadResources(main);
}
function bindFilters(main) {
  const f = state.resFilters;
  let timer = null;
  const input = main.querySelector('#fq');
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { f.q = input.value.trim(); f.page = 1; loadResources(main); }, 420); });
  main.querySelector('#fStatus').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    f.status = b.dataset.v;
    f.page = 1;
    Array.from(main.querySelectorAll('#fStatus button')).forEach((x) => x.classList.toggle('on', x === b));
    loadResources(main);
  };
  ['fType', 'fLack', 'fSort'].forEach((id) => {
    const sel = main.querySelector('#' + id);
    sel.onchange = () => { f[sel.id === 'fType' ? 'type' : sel.id === 'fLack' ? 'lack' : 'sort'] = sel.value; f.page = 1; loadResources(main); };
  });
  main.querySelector('#bulkGo').onclick = () => runBulk(main);
  main.querySelector('#checkPicked').onclick = () => runCheckPicked(main);
  main.querySelector('#gapsGo').onclick = () => { location.hash = state.picked.size ? '#/gaps?picked=1' : '#/gaps'; };
}
async function loadResources(main) {
  const f = state.resFilters;
  const table = main.querySelector('#resTable');
  if (table) table.innerHTML = '<tbody>' + Array.from({ length: 8 }, () => '<tr><td colspan="9"><div class="skeleton" style="height:38px"></div></td></tr>').join('') + '</tbody>';
  const data = await guard(Api.admin.resources({ q: f.q, status: f.status, type: f.type, lack: f.lack, sort: f.sort, page: f.page, pageSize: f.pageSize }), main);
  if (!table) return;
  table.innerHTML = '<thead><tr><th style="width:34px"><input type="checkbox" class="check" id="pickAll" /></th><th>资源</th><th>类型</th><th>分数</th><th>完整度</th><th>下载</th><th>来源</th><th>状态</th><th style="text-align:right">更新 / 操作</th></tr></thead><tbody>'
    + (data.items.map((r) => rowHtml(r)).join('') || '<tr><td colspan="9" class="admin-empty-row">没有符合条件的资源</td></tr>') + '</tbody>';
  const counts = data.counts || {};
  main.querySelector('#resSummary').innerHTML = '<span>共 <b>' + data.total + '</b> 条 · 第 ' + data.page + '/' + (data.totalPages || 1) + ' 页</span>'
    + '<span class="badge badge--ok">已发布 ' + (counts.published || 0) + '</span><span class="badge badge--warn">草稿 ' + (counts.draft || 0) + '</span><span class="badge">归档 ' + (counts.archived || 0) + '</span>'
    + '<span class="grow"></span><span id="pickInfo">已选 0</span>';
  renderPager(main, data);
  table.onclick = (e) => {
    const pickAll = e.target.closest('#pickAll');
    if (pickAll) { data.items.forEach((r) => (pickAll.checked ? state.picked.add(r.id) : state.picked.delete(r.id))); paintPicks(table); updatePickInfo(); return; }
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    const pick = e.target.closest('[data-pick]');
    if (pick) { togglePick(id, pick.checked, tr); return; }
    const act = e.target.closest('[data-a]');
    if (!act) return;
    const r = data.items.find((x) => x.id === id);
    if (act.dataset.a === 'edit') location.hash = '#/edit/' + id;
    if (act.dataset.a === 'preview') window.open('/#/resource/' + id, '_blank');
    if (act.dataset.a === 'check') runCheck(id, act);
    if (act.dataset.a === 'feature') quickFeature(r, main);
    if (act.dataset.a === 'fill') fillOneRow(id, r, act, main);
    if (act.dataset.a === 'delete') removeResource(id, r, main);
  };
  updatePickInfo();
  reveal(main);
  rippleAll(main);
}
function rowHtml(r) {
  const c = r.completeness || { percent: 0, missing: [] };
  const dead = (r.deadLinks || []).length;
  return '<tr data-id="' + r.id + '"' + (state.picked.has(r.id) ? ' class="is-picked"' : '') + '>'
    + '<td><input type="checkbox" class="check" data-pick' + (state.picked.has(r.id) ? ' checked' : '') + ' /></td>'
    + '<td><div class="cell-title">' + (r.cover ? '<img src="' + imgSrc(r.cover, r.title) + '" alt="" loading="lazy" />' : '<span class="ph">' + escapeHtml(providerInitial(r.title)) + '</span>')
    + '<span style="min-width:0"><a class="truncate" href="#/edit/' + r.id + '" style="font-weight:600">' + escapeHtml(r.title) + '</a><br />'
    + '<span class="tiny mono muted">' + (r.tags || []).slice(0, 4).map((t) => '#' + escapeHtml(t)).join(' ') + (r.featured ? ' · <b style="color:var(--amber)">精选</b>' : '') + (dead ? ' · <b style="color:var(--red)">' + dead + ' 个失效</b>' : '') + '</span></span></div></td>'
    + '<td>' + typeBadge(r.type) + '</td>'
    + '<td class="mono tiny">★ ' + fmtScore(r.score) + '</td>'
    + '<td style="width:118px"><div class="completeness"><div class="completeness__bar"><i style="width:' + c.percent + '%"></i></div><span class="tiny mono muted">' + c.percent + '%' + (c.missing && c.missing.length ? ' · 缺 ' + c.missing.map((m) => m.label).join('/') : '') + '</span></div></td>'
    + '<td class="mono tiny">' + (r.downloads || []).length + '</td>'
    + '<td class="mono tiny">' + (r.others || []).length + '</td>'
    + '<td>' + statusBadge(r.status) + '</td>'
    + '<td class="mono tiny muted" style="text-align:right">' + relTime(r.updatedAt) + '<div class="row row--tight" style="justify-content:flex-end;margin-top:4px"><button class="icon-btn icon-btn--sm" data-a="feature" title="精选">★</button><button class="icon-btn icon-btn--sm" data-a="edit" title="编辑">✎</button><button class="icon-btn icon-btn--sm" data-a="preview" title="前台预览">◉</button><button class="icon-btn icon-btn--sm" data-a="fill" title="补全这条的空白位置">✦</button><button class="icon-btn icon-btn--sm" data-a="check" title="检测链接">⌕</button><button class="icon-btn icon-btn--sm" data-a="delete" title="删除">×</button></div></td>'
    + '</tr>';
}
function paintPicks(table) {
  Array.from(table.querySelectorAll('tr[data-id]')).forEach((tr) => {
    const on = state.picked.has(tr.dataset.id);
    tr.classList.toggle('is-picked', on);
    const c = tr.querySelector('[data-pick]');
    if (c) c.checked = on;
  });
}
function togglePick(id, on, tr) {
  if (on) state.picked.add(id); else state.picked.delete(id);
  if (tr) tr.classList.toggle('is-picked', on);
  updatePickInfo();
}
function updatePickInfo() {
  const node = document.querySelector('#pickInfo');
  if (node) node.innerHTML = '已选 <b style="color:var(--violet)">' + state.picked.size + '</b>';
}
function statusBadge(status) {
  const map = { published: ['badge--ok', '已发布'], draft: ['badge--warn', '草稿'], archived: ['', '归档'], pending: ['badge--brand', '待审'] };
  const pair = map[status] || ['', status || '—'];
  return '<span class="badge ' + pair[0] + '">' + pair[1] + '</span>';
}
function renderPager(main, data) {
  const box = main.querySelector('#resPager');
  const pages = data.totalPages || 1;
  if (pages <= 1) { box.innerHTML = ''; return; }
  const cur = data.page;
  const nums = [];
  for (let i = Math.max(1, cur - 2); i <= Math.min(pages, cur + 2); i++) nums.push(i);
  box.innerHTML = '<button data-p="' + (cur - 1) + '"' + (cur <= 1 ? ' disabled' : '') + '>‹</button>'
    + (nums[0] > 1 ? '<button data-p="1">1</button><span class="muted">…</span>' : '')
    + nums.map((n) => '<button data-p="' + n + '" class="' + (n === cur ? 'is-on' : '') + '">' + n + '</button>').join('')
    + (nums[nums.length - 1] < pages ? '<span class="muted">…</span><button data-p="' + pages + '">' + pages + '</button>' : '')
    + '<button data-p="' + (cur + 1) + '"' + (cur >= pages ? ' disabled' : '') + '>›</button>';
  box.onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; state.resFilters.page = Number(b.dataset.p); loadResources(main); };
}
async function quickFeature(r, main) {
  try {
    await Api.admin.patch(r.id, { featured: !r.featured });
    toast(r.featured ? '已取消精选' : '已设为精选', 'ok', 1800);
    loadResources(main);
  } catch (err) { toast(err.message, 'bad'); }
}
async function runBulk(main) {
  const action = main.querySelector('#bulkAction').value;
  const ids = Array.from(state.picked);
  if (!action) return toast('先选择批量操作类型', 'warn');
  if (!ids.length) return toast('先勾选资源', 'warn');
  if (action === 'delete' && !(await confirmDialog({ title: '批量删除', text: '将删除 ' + ids.length + ' 条资源并放入回收站，确定继续？', okText: '删除', danger: true }))) return;
  try {
    const res = await Api.admin.bulk({ ids, action });
    toast('已处理 ' + (res.affected || 0) + ' 条', 'ok');
    state.picked.clear();
    loadResources(main);
    refreshBadges();
  } catch (err) { toast(err.message, 'bad'); }
}
async function runCheckPicked(main) {
  const ids = Array.from(state.picked);
  if (!ids.length) return toast('先勾选要检测的资源', 'warn');
  toast('开始检测 ' + ids.length + ' 条资源…', 'info');
  let dead = 0;
  for (const id of ids) {
    try { const r = await Api.admin.checkLinks(id); dead += (r.results || []).filter((x) => x.status === 'dead').length; } catch {}
  }
  toast('检测完成，' + dead + ' 个链接失效', dead ? 'warn' : 'ok', 4200);
  loadResources(main);
}
/** 单条补全：走同一套批量引擎，只处理这一条，勾到的位置全给它 */
async function fillOneRow(id, r, btn, main) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const res = await Api.admin.enrichBatch({
      ids: [id], fields: GAP_ALL_KEYS, dryRun: false, limit: 1, useSearch: true, allowLinks: true,
      mirror: !!(store.bootstrap.settings && store.bootstrap.settings.mirrorImagesByDefault), timeout: 9000, scope: 'ids',
    });
    const item = ((res.report || {}).items || [])[0] || {};
    const names = (item.filled || []).map((x) => x.label).join('、');
    toast(names ? '《' + (r && r.title ? r.title : '') + '》已补：' + names : (item.skipped || []).length ? '没能补到内容：' + ((item.skipped[0] || {}).reason || '来源页没有可用信息') : '这条已经填满了', names ? 'ok' : 'warn', 4600);
    loadResources(main);
  } catch (err) {
    toast('补全失败：' + (err.message || '服务异常'), 'bad', 4600);
  }
  btn.disabled = false;
  btn.textContent = '✦';
  delete btn.dataset.busy;
}
async function runCheck(id, btn) {
  btn.disabled = true;
  try {
    const r = await Api.admin.checkLinks(id);
    const bad = (r.results || []).filter((x) => x.status === 'dead');
    modal({
      title: '链接检测结果', size: 'modal--wide',
      sub: '共检测 <b>' + r.checked + '</b> 条，失效 <b style="color:' + (bad.length ? 'var(--red)' : 'var(--green)') + '">' + bad.length + '</b> 条',
      body: '<div class="table-wrap"><table class="table table--compact"><thead><tr><th>状态</th><th>资源</th><th>链接</th><th>说明</th></tr></thead><tbody>'
        + (r.results || []).map((x) => '<tr><td>' + (x.status === 'dead' ? '<span class="badge badge--bad">失效</span>' : '<span class="badge badge--ok">正常</span>') + '</td><td class="small truncate" style="max-width:180px">' + escapeHtml(x.title) + '</td><td class="mono tiny truncate" style="max-width:320px">' + escapeHtml(x.url) + '</td><td class="tiny muted">' + escapeHtml(x.note || '') + '</td></tr>').join('')
        + '</tbody></table></div>',
    });
  } catch (err) { toast('检测失败：' + err.message, 'bad'); }
  btn.disabled = false;
}
async function removeResource(id, r, main) {
  if (!(await confirmDialog({ title: '删除资源', text: '《' + (r && r.title ? r.title : id) + '》将移入回收站，可随时恢复。', okText: '删除', danger: true }))) return;
  try { await Api.admin.remove(id); toast('已移入回收站', 'ok'); state.picked.delete(id); loadResources(main); } catch (err) { toast(err.message, 'bad'); }
}

/* ---------- 批量补全空白 ---------- */
/* 位置键与服务端 server/lib/gaps.mjs 的 GAP_FIELDS 一一对应 */
const GAP_DEFAULT = ['summary', 'content', 'cover', 'gallery', 'tags', 'year', 'author', 'size', 'format'];
const gap = { fields: new Set(GAP_DEFAULT), scope: 'filter', limit: 6, useSearch: true, allowLinks: false, mirror: true, autoNext: true, running: false, stop: false };
async function viewGaps(main, ctx) {
  if (ctx && ctx.query && ctx.query.picked && state.picked.size) gap.scope = 'picked';
  main.innerHTML = [
    head('批量补全空白', '抓资源自带链接 + 可选联网检索，只往还空着的位置写；已有内容一律不动（正文与图集按追加处理）',
      '<a class="btn btn--sm btn--quiet" href="#/resources">← 资源管理</a><button class="btn btn--sm btn--quiet" id="gapPreview">预览能补什么</button><button class="btn btn--sm btn--primary" id="gapRun">开始批量补全</button>'),
    '<div class="gap-layout">',
    '<div class="gap-col">',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>补哪些位置</h3><span class="grow"></span><span class="tiny mono muted" id="gapSum">—</span></div><div id="gapFields"></div>'
      + '<div class="row row--wrap" style="gap:6px;margin-top:12px"><button class="btn btn--sm btn--quiet" data-pick="all">全选</button>'
      + '<button class="btn btn--sm btn--quiet" data-pick="default">推荐（文字+图片）</button><button class="btn btn--sm btn--quiet" data-pick="links">只补链接</button><button class="btn btn--sm btn--quiet" data-pick="none">清空</button></div></div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>处理范围</h3></div>'
      + '<div class="field"><label>筛选条件</label><div class="row" style="gap:8px"><div class="select-wrap grow"><select class="select" id="gStatus">' + [['all', '全部状态'], ['published', '仅已发布'], ['draft', '仅草稿']].map(([k, n]) => '<option value="' + k + '">' + n + '</option>').join('') + '</select></div><div class="select-wrap grow"><select class="select" id="gType"><option value="">全部类型</option>' + store.bootstrap.types.map((t) => '<option value="' + escapeHtml(t.key) + '">' + escapeHtml(t.key) + '</option>').join('') + '</select></div></div></div>'
      + '<div class="field" style="margin-top:10px"><label>标题 / 标签关键词</label><input class="input" id="gQ" placeholder="留空 = 不按关键词过滤" /></div>'
      + '<div class="field" style="margin-top:10px"><label>范围</label><div class="seg" id="gScope"><button data-v="filter">按筛选条件</button><button data-v="picked">仅勾选的资源</button></div><span class="tiny muted" id="gScopeNote"></span></div>'
      + '<div class="field" style="margin-top:10px"><label>每批条数（服务端限 30）</label><input class="input" id="gLimit" type="number" min="1" max="30" step="1" value="' + gap.limit + '" /></div>'
      + '<div class="row row--wrap" style="gap:14px;margin-top:14px">'
      + '<label class="switch"><input type="checkbox" id="gSearch"' + (gap.useSearch ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">允许联网检索补全</span></label>'
      + '<label class="switch"><input type="checkbox" id="gLinks"' + (gap.allowLinks ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">补下载 / 其他来源</span></label>'
      + '<label class="switch"><input type="checkbox" id="gMirror"' + (gap.mirror ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">图片转存本地</span></label>'
      + '<label class="switch"><input type="checkbox" id="gAuto"' + (gap.autoNext ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">自动跑完剩余批次</span></label>'
      + '</div>'
      + '<p class="tiny muted" style="margin:10px 0 0">「补下载 / 其他来源」会把检索到的链接也写进资源，误报风险由你把关，建议先预览。</p>'
      + '</div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>执行</h3><span class="grow"></span><button class="btn btn--sm btn--danger" id="gapStop" hidden>停止</button></div>'
      + '<div class="gap-run"><div class="gap-run__stat" id="gapStat"><span>等待开始</span></div>'
      + '<div class="gap-run__bar" id="gapBar">' + progressBar(0) + '</div>'
      + '<p class="tiny muted" id="gapNote">先点「预览能补什么」看看要动哪些格子，再开始写库。</p></div></div>',
    '</div>',
    '<div class="gap-col">',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>待补清单</h3><span class="grow"></span><span class="tiny mono muted" id="gapPrevNote">完整度最低的先补</span></div><div id="gapPreviewHost"></div></div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>逐条报告</h3><span class="grow"></span><span class="tiny mono muted">写入的位置 / 补不上的原因</span></div><div class="gap-log" id="gapLog"><p class="tiny muted">还没有跑过。</p></div></div>',
    '</div>',
    '</div>',
  ].join('');

  const fieldsHost = main.querySelector('#gapFields');
  const logHost = main.querySelector('#gapLog');
  const stat = main.querySelector('#gapStat');
  const bar = main.querySelector('#gapBar');
  const note = main.querySelector('#gapNote');
  let report = null;

  const readOpts = () => {
    gap.limit = Math.max(1, Math.min(30, Number(main.querySelector('#gLimit').value) || 6));
    gap.useSearch = main.querySelector('#gSearch').checked;
    gap.allowLinks = main.querySelector('#gLinks').checked;
    gap.mirror = main.querySelector('#gMirror').checked;
    gap.autoNext = main.querySelector('#gAuto').checked;
    return {
      status: main.querySelector('#gStatus').value,
      type: main.querySelector('#gType').value,
      q: main.querySelector('#gQ').value.trim(),
    };
  };
  const scopeBody = (f) => (gap.scope === 'picked' ? { ids: Array.from(state.picked) } : { filter: f });

  function paintFields(g) {
    const groups = g.groups || {};
    fieldsHost.innerHTML = '';
    Object.keys(groups).forEach((name) => {
      const box = el('<div class="gap-grp"><div class="gap-grp__title">' + escapeHtml(name) + '</div></div>');
      groups[name].forEach((fld) => {
        const on = gap.fields.has(fld.key);
        const row = el('<label class="gap-field' + (on ? ' is-on' : '') + (fld.count ? '' : ' is-zero') + '"><input type="checkbox" class="check" data-f="' + fld.key + '"' + (on ? ' checked' : '') + ' /><b>' + escapeHtml(fld.label) + '</b><span class="gap-count">' + fld.count + ' 空</span></label>');
        box.append(row);
      });
      fieldsHost.append(box);
    });
    fieldsHost.querySelectorAll('[data-f]').forEach((c) => {
      c.onchange = () => {
        if (c.checked) gap.fields.add(c.dataset.f); else gap.fields.delete(c.dataset.f);
        c.closest('.gap-field').classList.toggle('is-on', c.checked);
        syncSum();
      };
    });
    syncSum();
  }
  function syncSum() {
    const total = ((report && report.gaps) || { fields: [] }).fields.filter((f) => gap.fields.has(f.key)).reduce((n, f) => n + f.count, 0);
    main.querySelector('#gapSum').textContent = '已选 ' + gap.fields.size + ' 类 · 共 ' + total + ' 个空格';
    const res = main.querySelector('#resSummary');
    if (res) void res;
  }
  function paintPreview(items, ids) {
    const host = main.querySelector('#gapPreviewHost');
    if (!items || !items.length) { host.innerHTML = '<p class="small muted">这个范围里没有还空着的格子，不用补。</p>'; return; }
    host.innerHTML = '<div class="table-wrap"><table class="table table--compact"><thead><tr><th style="width:40px"></th><th>资源</th><th>还空着</th><th style="width:70px">完整度</th></tr></thead><tbody>'
      + items.map((r) => '<tr data-id="' + r.id + '"><td><span class="gap-preview">' + (r.cover ? '<img src="' + imgSrc(r.cover, r.title) + '" alt="" loading="lazy" />' : escapeHtml(providerInitial(r.title))) + '</span></td>'
        + '<td><a class="small" href="#/edit/' + r.id + '" style="font-weight:600">' + escapeHtml(r.title) + '</a><div class="tiny mono muted">' + escapeHtml(r.status) + (r.urls && r.urls.length ? ' · ' + r.urls.length + ' 个可抓链接' : ' · 无自带链接') + '</div></td>'
        + '<td><div class="gap-item__tags">' + r.blanks.map((b) => '<span class="gap-tag' + (gap.fields.has(b.key) ? '' : ' is-skip') + '">' + escapeHtml(b.label) + '</span>').join('') + '</div></td>'
        + '<td class="mono tiny">' + r.percent + '%</td></tr>').join('')
      + '</tbody></table></div>';
    main.querySelector('#gapPrevNote').textContent = '共 ' + (ids || items).length + ' 条待补 · 列出前 ' + items.length + ' 条';
  }
  function paintItems(items, dryRun) {
    items.forEach((x) => {
      const ok = x.filled.length;
      const line = el('<div class="gap-item ' + (ok ? 'is-ok' : 'is-none') + '"><span class="gap-item__mark">' + (ok ? (dryRun ? '◈' : '✓') : '·') + '</span>'
        + '<span style="min-width:0"><div class="gap-item__title">' + escapeHtml(x.title) + '</div><div class="gap-item__meta">'
        + escapeHtml(dryRun ? '预览：' : '') + (ok ? '写入 ' + x.filled.length + ' 个位置' : '没补到内容')
        + (x.skipped.length ? ' · ' + x.skipped.slice(0, 3).map((s) => s.label + '：' + s.reason).join(' / ') : '')
        + (x.notes && x.notes.length ? ' · ' + escapeHtml(x.notes[0]) : '') + '</div></span>'
        + '<span class="gap-item__tags">' + x.filled.slice(0, 8).map((s) => '<span class="gap-tag">' + escapeHtml(s.label) + '</span>').join('') + '</span></div>');
      logHost.prepend(line);
    });
  }
  function setProgress(text, pct) {
    stat.innerHTML = text;
    bar.innerHTML = progressBar(pct || 0) + (pct ? '<span class="gap-run__pct">' + Math.round(pct) + '%</span>' : '');
  }

  async function loadReport() {
    const f = readOpts();
    const data = await guard(Api.admin.gaps(Object.assign({}, f, gap.scope === 'picked' ? { ids: Array.from(state.picked).join(',') } : {})), fieldsHost);
    report = data;
    paintFields(data.gaps);
    paintPreview(data.preview, data.ids);
    const matched = (data.gaps.fields || []).filter((x) => gap.fields.has(x.key)).reduce((n, x) => n + x.count, 0);
    note.textContent = data.total ? ('范围内 ' + data.total + ' 条还有空格 · 勾选的位置共 ' + matched + ' 个格子待补') : '这个范围里没有空缺，选好筛选条件再试。';
    main.querySelector('#gScopeNote').textContent = gap.scope === 'picked'
      ? (state.picked.size ? '已勾选 ' + state.picked.size + ' 条' : '还没在资源管理里勾选任何资源，先回列表勾选')
      : '按上面的状态 / 类型 / 关键词过滤，完整度最低的先处理';
  }

  async function run(dryRun) {
    if (gap.running) return toast('已经在跑了', 'warn');
    if (!gap.fields.size) return toast('先勾选要补全的位置', 'warn');
    if (gap.scope === 'picked' && !state.picked.size) return toast('范围选了「仅勾选的资源」，但列表里没勾选', 'warn');
    const f = readOpts();
    gap.running = true;
    gap.stop = false;
    main.querySelector('#gapStop').hidden = !dryRun;
    main.querySelector('#gapRun').disabled = true;
    main.querySelector('#gapPreview').disabled = true;
    let batch = 0, scanned = 0, changed = 0, cells = 0, stalled = 0, remaining = 0, total = 0;
    if (!dryRun) logHost.innerHTML = '';
    try {
      do {
        batch++;
        setProgress('<span class="spinner"></span> 第 ' + batch + ' 批 · ' + (dryRun ? '预览' : '抓取并写入') + '中（每批最多 ' + gap.limit + ' 条，含外网抓取，稍等）…', Math.min(96, (scanned / Math.max(1, total || scanned + gap.limit)) * 100));
        const body = Object.assign({
          fields: Array.from(gap.fields), dryRun, limit: gap.limit, useSearch: gap.useSearch, allowLinks: gap.allowLinks,
          mirror: gap.mirror, concurrency: 2, timeout: 8000, scope: gap.scope,
        }, scopeBody(f));
        const res = await Api.admin.enrichBatch(body);
        const rep = res.report || { items: [], changed: 0, cells: 0 };
        scanned += res.scanned || 0;
        changed += rep.changed || 0;
        cells += rep.cells || 0;
        remaining = res.remaining || 0;
        total = res.matched || total;
        paintItems(rep.items || [], dryRun);
        setProgress('<span>' + (dryRun ? '预览批次 ' : '批次 ') + batch + ' 完成</span><span>已处理 <b>' + scanned + '</b> 条</span><span>可补 <b>' + cells + '</b> 个位置</span><span>涉及 <b>' + changed + '</b> 条资源</span>' + (remaining ? '<span>剩余 <b>' + remaining + '</b> 条</span>' : '<span>已跑完</span>'), total ? Math.min(100, (scanned / total) * 100) : 100);
        if (!res.scanned) break;
        if (!rep.changed) {
          stalled += 1;
          if (stalled >= 2) { note.textContent = '连续两批都没能补到内容：剩下的多是「来源页抓不到 / 检索不到可靠链接」，需要人工处理。'; break; }
        } else stalled = 0;
        if (dryRun) break;
      } while (gap.autoNext && remaining > 0 && !gap.stop);
      if (!dryRun) {
        const doneMsg = gap.stop ? '已手动停止：已写入 ' + cells + ' 个位置。' : ('跑完了：' + scanned + ' 条资源里写入 ' + cells + ' 个位置，' + changed + ' 条有变化。');
        note.textContent = doneMsg;
        await loadReport();
        reloadBootstrap();
        note.textContent = doneMsg;   // loadReport 会改写提示行，跑完的结论要留在最后
        toast('批量补全完成：写入 ' + cells + ' 个位置', 'ok', 4600);
      } else {
        const dryMsg = '预览完成：' + cells + ' 个空白位置可以补（未写库）。确认后点「开始批量补全」。';
        note.textContent = dryMsg;
        await loadReport();
        note.textContent = dryMsg;   // 清单同步刷新了，但预览结论要留在提示行上
        toast('预览：可补 ' + cells + ' 个位置 / ' + changed + ' 条资源', 'info', 4200);
      }
    } catch (err) {
      note.textContent = '执行失败：' + (err.message || '服务异常');
      toast('批量补全失败：' + (err.message || '服务异常'), 'bad', 5200);
    } finally {
      gap.running = false;
      main.querySelector('#gapStop').hidden = true;
      main.querySelector('#gapRun').disabled = false;
      main.querySelector('#gapPreview').disabled = false;
    }
  }

  main.querySelectorAll('[data-pick]').forEach((b) => {
    b.onclick = () => {
      const mode = b.dataset.pick;
      gap.fields = new Set(mode === 'all' ? GAP_ALL_KEYS : mode === 'default' ? GAP_DEFAULT : mode === 'links' ? ['downloads', 'others', 'sourceUrl'] : []);
      paintFields((report && report.gaps) || { groups: {} });
      loadReport();
    };
  });
  ['gStatus', 'gType', 'gQ', 'gLimit'].forEach((id) => {
    const node = main.querySelector('#' + id);
    node.addEventListener('change', loadReport);
    if (id === 'gQ') node.addEventListener('input', () => { clearTimeout(node._t); node._t = setTimeout(loadReport, 500); });
  });
  main.querySelector('#gScope').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    gap.scope = b.dataset.v;
    Array.from(main.querySelectorAll('#gScope button')).forEach((x) => x.classList.toggle('on', x === b));
    loadReport();
  };
  main.querySelector('#gapPreview').onclick = () => run(true);
  main.querySelector('#gapRun').onclick = () => run(false);
  main.querySelector('#gapStop').onclick = () => { gap.stop = true; note.textContent = '正在收尾当前批次…'; };
  Array.from(main.querySelectorAll('#gScope button')).forEach((x) => x.classList.toggle('on', x.dataset.v === gap.scope));
  await loadReport();
  reveal(main);
  rippleAll(main);
}
const GAP_ALL_KEYS = ['summary', 'content', 'cover', 'gallery', 'tags', 'type', 'score', 'year', 'author', 'size', 'format', 'sourceUrl', 'others', 'downloads'];

/* ---------- 资源编辑器 ---------- */
async function viewEditor(main, ctx) {
  const id = ctx && ctx.params ? ctx.params.id : null;
  let resource = null;
  if (id) {
    main.innerHTML = '<div class="admin-boot"><span class="spinner"></span></div>';
    try { const d = await Api.admin.resource(id); resource = d.resource; } catch (err) { main.innerHTML = emptyState({ icon: '⚠️', title: escapeHtml(err.message) }); return; }
  }
  const r = resource || { title: '', type: '', tags: [], score: 0, summary: '', content: '', cover: '', gallery: [], downloads: [], others: [], status: 'published', featured: false, notes: '' };
  let dirty = false;
  main.innerHTML = [
    head(id ? '编辑资源' : '新建资源', id ? 'ID ' + id : '手工创建一条完整资源', '<a class="btn btn--sm btn--quiet" href="#/resources">← 返回列表</a>' + (id ? '<a class="btn btn--sm btn--quiet" target="_blank" href="/#/resource/' + id + '">◉ 前台预览</a>' : '')),
    '<div class="admin-toolbar" data-reveal><span class="mono tiny muted" id="editComplete">完整度 —</span><span class="grow"></span>'
      + (id ? '<button class="btn btn--sm btn--quiet" id="btnCheck">检测链接</button>' : '')
      + '<button class="btn btn--sm btn--quiet" id="btnFill">一键补全空白</button>'
      + '<button class="btn btn--sm btn--primary" id="btnSave">保存</button></div>',
    '<div class="card card--pad"><div id="editForm"></div></div>',
  ].join('');
  const form = formKit(main.querySelector('#editForm'), {
    title: r.title, altTitles: r.altTitles, type: r.type, tags: r.tags, score: r.score, summary: r.summary, content: stripTagsToText(r.content),
    cover: r.cover, gallery: r.gallery, downloads: r.downloads, others: r.others, sourceUrl: r.sourceUrl,
    year: (r.meta || {}).year, region: (r.meta || {}).region, size: (r.meta || {}).size, format: (r.meta || {}).format, author: (r.meta || {}).publisher || (r.meta || {}).developer,
    notes: r.notes, featured: r.featured, status: r.status,
  }, { withStatus: true });
  form.onChange = () => { dirty = true; showComplete(main, form); };
  showComplete(main, form);
  main.querySelector('#btnSave').onclick = () => saveResource(id, form, main);
  const fill = main.querySelector('#btnFill');
  if (fill) fill.onclick = () => autoFill(main, form, r, fill);
  const check = main.querySelector('#btnCheck');
  if (check) check.onclick = () => runCheck(id, check);
  window.onbeforeunload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  reveal(main);
  rippleAll(main);
}
function stripTagsToText(html) {
  if (!html) return '';
  return String(html).replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
function showComplete(main, form) {
  const node = main.querySelector('#editComplete');
  if (!node) return;
  const v = form.value;
  const need = [['标题', v.title], ['类型', v.type], ['标签', v.tags.length], ['分数', Number(v.score) > 0], ['简介', v.summary], ['内容', v.content], ['封面 / 图片', v.cover || v.gallery.length], ['下载链接', v.downloads.length]];
  const okCount = need.filter((x) => x[1]).length;
  const pct = Math.round((okCount / need.length) * 100);
  node.innerHTML = '完整度 <b style="color:' + (pct === 100 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)') + '">' + pct + '%</b>' + (okCount < need.length ? ' · 待补：' + need.filter((x) => !x[1]).map((x) => x[0]).join('、') : ' · 全部字段已齐');
}
async function saveResource(id, form, main) {
  const payload = form.value;
  if (!payload.title) return toast('标题不能为空', 'bad');
  const btn = main.querySelector('#btnSave');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    if (id) {
      const res = await Api.admin.patch(id, payload);
      toast(res.message || '已保存', 'ok', 2000);
      window.onbeforeunload = null;
      route();
    } else {
      const res = await Api.admin.create(payload);
      toast('已创建：' + (res.resource ? res.resource.title : ''), 'ok');
      window.onbeforeunload = null;
      location.hash = '#/edit/' + res.resource.id;
    }
    refreshBadges();
  } catch (err) { toast('保存失败：' + err.message, 'bad', 4600); }
  btn.disabled = false;
  btn.textContent = '保存';
}
async function autoFill(main, form, r, btn) {
  // 已入库的资源直接走「批量补全」引擎：dryRun 拿到 patch，只填表单还没写的空字段
  if (r && r.id) {
    btn.disabled = true;
    btn.textContent = '识别中…';
    try {
      const res = await Api.admin.enrichBatch({ ids: [r.id], fields: GAP_ALL_KEYS, dryRun: true, limit: 1, useSearch: true, allowLinks: true, timeout: 9000, mirror: !!(store.bootstrap.settings && store.bootstrap.settings.mirrorImagesByDefault), scope: 'ids' });
      const item = ((res.report || {}).items || [])[0];
      const patch = (item && item.patch) || {};
      const v = form.value;
      const apply = {};
      if (!v.summary && patch.summary) apply.summary = String(patch.summary).slice(0, 400);
      if (!v.content && patch.content) apply.content = stripTagsToText(patch.content);
      if (!v.cover && patch.cover) apply.cover = patch.cover;
      if ((!v.gallery || !v.gallery.length) && Array.isArray(patch.gallery)) apply.gallery = patch.gallery;
      if ((!v.tags || !v.tags.length) && Array.isArray(patch.tags)) apply.tags = patch.tags;
      if ((!v.type || v.type === '其他') && patch.type) apply.type = patch.type;
      if (!Number(v.score) && patch.score) apply.score = patch.score;
      if (!v.sourceUrl && patch.sourceUrl) apply.sourceUrl = patch.sourceUrl;
      const m = patch.meta || {};
      if (!v.year && m.year) apply.year = m.year;
      if (!v.region && m.region) apply.region = m.region;
      if (!v.size && m.size) apply.size = m.size;
      if (!v.format && m.format) apply.format = m.format;
      if (!v.author && (m.developer || m.publisher)) apply.author = m.developer || m.publisher;
      const dlAdd = (patch.downloads || []).filter((l) => l && l.url && !v.downloads.some((x) => x.url === l.url));
      const otAdd = (patch.others || []).filter((l) => l && l.url && !v.others.some((x) => x.url === l.url));
      if (dlAdd.length) apply.downloads = [...v.downloads, ...dlAdd];
      if (otAdd.length) apply.others = [...v.others, ...otAdd];
      if (Object.keys(apply).length) {
        form.set(apply);
        dirty = true;
        showComplete(main, form);
        toast('已按空白位置补进表单：' + Object.keys(apply).join('、') + '（确认无误后点保存）', 'ok', 5200);
      } else {
        toast('没抓到能填进空白处的内容' + (((item && item.skipped) || [])[0] ? '：' + item.skipped[0].reason : ''), 'warn', 4600);
      }
    } catch (err) {
      toast('补全失败：' + (err.message || '服务异常'), 'bad', 4600);
    }
    btn.disabled = false;
    btn.textContent = '一键补全空白';
    return;
  }
  const v = form.value;
  const urls = [];
  if (v.sourceUrl) urls.push(v.sourceUrl);
  v.downloads.forEach((d) => { if (/^https?:/i.test(d.url)) urls.push(d.url); });
  v.others.forEach((d) => { if (/^https?:/i.test(d.url)) urls.push(d.url); });
  if (!urls.length) return toast('没有可识别的 http(s) 链接，请先填写来源或下载链接', 'warn');
  btn.disabled = true;
  btn.textContent = '识别中…';
  try {
    const res = await Api.enrich(urls.slice(0, 10), !!(store.bootstrap.settings && store.bootstrap.settings.mirrorImagesByDefault));
    const good = (res.items || []).filter((x) => x.ok).map((x) => x.result);
    const patch = {};
    if (!v.summary && good.length) patch.summary = String(good[0].description || good[0].textPreview || '').slice(0, 220);
    if (!v.content && good.length) patch.content = String(good[0].text || good[0].textPreview || '').slice(0, 1200).split('\n').filter(Boolean).map((l) => l.trim()).join('\n\n');
    const imgs = [];
    good.forEach((g) => (g.images || []).forEach((i) => imgs.push({ url: i.url, caption: i.alt || g.title || '' })));
    const seen = new Set(v.gallery.map((g) => g.url));
    const merged = v.gallery.slice();
    imgs.forEach((i) => { if (!seen.has(i.url) && merged.length < 24) { merged.push(i); seen.add(i.url); } });
    if (merged.length !== v.gallery.length) patch.gallery = merged;
    if (!v.cover && merged.length) patch.cover = merged[0].url;
    if (!v.tags.length && good.length && good[0].keywords) patch.tags = String(good[0].keywords).split(/[,，|]/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (!v.type) {
      const guess = guessType(good[0] || {});
      if (guess) patch.type = guess;
    }
    if (!Object.keys(patch).length) return toast('没有可补全的空白字段', 'info');
    form.set(patch);
    toast('已补全：' + Object.keys(patch).join('、'), 'ok', 4200);
  } catch (err) { toast('补全失败：' + err.message, 'bad'); }
  btn.disabled = false;
  btn.textContent = '一键补全空白';
}
function guessType(result) {
  const text = ((result.siteName || '') + ' ' + (result.title || '') + ' ' + (result.description || '')).toLowerCase();
  const map = [['电影', /(movie|film|电影|影视|蓝光|1080p|2160p|mkv)/], ['剧集', /(tv|drama|剧集|电视剧|连续剧|season)/], ['动漫', /(anime|动漫|番剧|nyaa)/], ['音乐', /(music|album|音乐|专辑|flac|mp3|vinyl)/], ['游戏', /(game|游戏|steam|switch)/], ['软件', /(app|software|软件|工具|sdk|api)/], ['电子书', /(book|e-book|pdf|epub|书|文档)/], ['素材', /(asset|ui kit|素材|模板|font|图标|icon)/]];
  for (const entry of map) if (entry[1].test(text)) return entry[0];
  return '';
}

/* ---------- 回收站 ---------- */
async function viewArchive(main) {
  main.innerHTML = head('回收站', '删除的资源保留在此，可恢复或彻底清除', '<a class="btn btn--sm btn--quiet" href="#/resources">← 资源管理</a>') + '<div id="archHost"></div>';
  const host = main.querySelector('#archHost');
  const data = await guard(Api.admin.archive(), host);
  if (!data.items.length) { host.innerHTML = emptyState({ icon: '⛯', title: '回收站是空的', action: '<a class="btn btn--sm btn--quiet" href="#/resources">返回资源管理</a>' }); return; }
  host.innerHTML = '<div class="table-wrap"><table class="table admin-table"><thead><tr><th>封面</th><th>标题</th><th>类型</th><th>原状态</th><th>删除时间</th><th style="text-align:right">操作</th></tr></thead><tbody>'
    + data.items.map((a) => '<tr><td>' + (a.cover ? '<img src="' + imgSrc(a.cover, a.title) + '" style="width:46px;height:34px;object-fit:cover;border-radius:8px" alt="" />' : '<span class="ph">·</span>') + '</td>'
      + '<td><b class="small">' + escapeHtml(a.title) + '</b></td><td>' + typeBadge(a.type) + '</td><td>' + statusBadge(a.status) + '</td>'
      + '<td class="mono tiny muted">' + new Date(a.at).toLocaleString('zh-CN') + '</td>'
      + '<td style="text-align:right"><button class="btn btn--sm btn--quiet" data-restore="' + a.id + '">恢复</button> <button class="btn btn--sm btn--danger" data-purge="' + a.id + '" data-title="' + escapeHtml(a.title) + '">彻底删除</button></td></tr>').join('')
    + '</tbody></table></div>';
  host.onclick = async (e) => {
    const rt = e.target.closest('[data-restore]');
    const pg = e.target.closest('[data-purge]');
    if (rt) {
      try { await Api.admin.restore(rt.dataset.restore); toast('已恢复', 'ok'); viewArchive(main); } catch (err) { toast(err.message, 'bad'); }
    }
    if (pg) {
      if (!(await confirmDialog({ title: '彻底删除', text: '《' + pg.dataset.title + '》将无法找回，确定？', okText: '彻底删除', danger: true }))) return;
      try { await api('DELETE', '/api/admin/archive/' + encodeURIComponent(pg.dataset.purge)); toast('已彻底删除', 'ok'); viewArchive(main); } catch (err) { toast(err.message, 'bad'); }
    }
  };
}

/* ---------- 投稿审核 ---------- */
async function viewSubmissions(main) {
  let status = 'pending';
  main.innerHTML = [
    head('投稿审核', '前台投稿与信息补全；通过后自动并入资源库（同名资源会合并链接）', '<div class="seg" id="subSeg">' + [['pending', '待审'], ['approved', '已通过'], ['rejected', '已驳回'], ['all', '全部']].map(([k, n], i) => '<button data-v="' + k + '" class="' + (i === 0 ? 'on' : '') + '">' + n + '</button>').join('') + '</div>'),
    '<div id="subList"></div>',
  ].join('');
  main.querySelector('#subSeg').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    status = b.dataset.v;
    Array.from(main.querySelectorAll('#subSeg button')).forEach((x) => x.classList.toggle('on', x === b));
    load();
  };
  await load();
  async function load() {
    const host = main.querySelector('#subList');
    host.innerHTML = skeletonGrid(3, true);
    const data = await guard(Api.admin.submissions(status), host);
    host.innerHTML = '';
    const counts = data.counts || {};
    host.append(el('<div class="row row--wrap tiny mono muted" style="gap:10px;margin-bottom:12px"><span>共 ' + data.items.length + ' 条</span><span class="badge badge--warn">待审 ' + (counts.pending || 0) + '</span><span class="badge badge--ok">已通过 ' + (counts.approved || 0) + '</span><span class="badge badge--bad">已驳回 ' + (counts.rejected || 0) + '</span></div>'));
    if (!data.items.length) { host.innerHTML += emptyState({ icon: '📭', title: '没有相关投稿', desc: '前台「投稿补全」页面提交的内容会出现在这里。' }); return; }
    const grid = el('<div class="grid grid--wide"></div>');
    data.items.forEach((s) => grid.append(subCard(s, main, load)));
    host.append(grid);
    reveal(host);
    rippleAll(host);
  }
}
const PATCH_LABEL = { title: '标题', type: '类型', tags: '标签', score: '分数', summary: '简介', content: '内容/正文', cover: '封面图', gallery: '图集', image: '图集', downloads: '资源下载', others: '其他来源', sourceUrl: '来源地址', meta: '资源信息', notes: '备注' };
const insertValue = (i) => {
  const v = i && i.value;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : (x && (x.url || x.caption)) || '')).filter(Boolean).join(' / ');
  if (v && typeof v === 'object') return Object.values(v).filter((x) => x && typeof x !== 'object').join(' · ') || String(v.url || '');
  return String(v == null ? '' : v);
};
function subCard(s, main, reload) {
  const draft = s.draft || {};
  const c = s.completeness || { percent: 0, missing: [] };
  const node = resourceCard({ id: s.id, title: draft.title || '（未命名）', type: draft.type, tags: draft.tags, score: draft.score, summary: draft.summary, cover: draft.cover || ((draft.gallery || [])[0] || {}).url || '', downloads: draft.downloads || [], others: draft.others || [], gallery: draft.gallery || [], createdAt: s.createdAt, updatedAt: s.createdAt, completeness: c, status: 'pending', featured: false, meta: {} });
  const isSource = s.kind === 'source';
  const isPatch = s.kind === 'patch';
  const badge = el('<span class="badge ' + (isSource || isPatch ? 'badge--live' : 'badge--brand') + '" style="position:absolute;left:12px;top:56px;z-index:5">' + (isSource ? '来源补充' : isPatch ? '内容补充' : ({ pending: '待审核', approved: '已通过', rejected: '已驳回' }[s.status] || s.status)) + '</span>');
  node.append(badge);
  if (isPatch && (s.insertLabels || []).length) {
    node.append(el('<div class="sub-inserts">' + (s.insertLabels || []).map((t) => '<span class="gap-tag">' + escapeHtml(t) + '</span>').join('') + '</div>'));
  }
  // 补源 / 内容补充都不能「存草稿」，也不该新建资源：唯一的通过动作就是写回原条目
  const acts = isSource
    ? '<button class="btn btn--sm btn--primary" data-s="publish">并入该资源</button><button class="btn btn--sm btn--danger" data-s="reject">驳回</button>'
    : isPatch
      ? '<button class="btn btn--sm btn--primary" data-s="publish">写入该资源</button><button class="btn btn--sm btn--quiet" data-s="approve">仅通过</button><button class="btn btn--sm btn--danger" data-s="reject">驳回</button>'
      : '<button class="btn btn--sm btn--primary" data-s="publish">通过并发布</button><button class="btn btn--sm btn--quiet" data-s="approve">仅通过</button><button class="btn btn--sm btn--danger" data-s="reject">驳回</button>';
  const target = (isSource || isPatch) ? '<span class="badge" title="通过后写入这条资源">' + (isPatch ? '写入' : '并入') + '《' + escapeHtml(s.targetTitle || s.resourceTitle || s.title || s.resourceId || '') + '》</span>' : '';
  const foot = el('<div class="row row--tight" style="padding:0 16px 14px;gap:6px;flex-wrap:wrap"><button class="btn btn--sm btn--quiet" data-s="detail">查看详情</button>' + acts + target + '<span class="grow"></span><span class="tiny mono muted">' + escapeHtml(s.from || '匿名') + ' · ' + relTime(s.createdAt) + '</span></div>');
  node.append(foot);
  foot.onclick = (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const act = b.dataset.s;
    if (act === 'detail') return openSubmission(s, main, reload);
    decide(s, act === 'publish' ? 'publish' : act, main, reload);
  };
  return node;
}
async function decide(s, action, main, reload) {
  const label = { publish: '通过并发布', approve: '仅通过', reject: '驳回', delete: '删除投稿' }[action];
  const danger = action === 'reject' || action === 'delete';
  if (danger && !(await confirmDialog({ title: label, text: action === 'reject' ? '驳回后可用「识别链接」补全再重新提交。' : '将永久删除这条投稿。', okText: label, danger: true }))) return;
  try {
    const res = await Api.admin.decide(s.id, { action });
    toast((res && res.message) || (label + '成功'), 'ok');
    refreshBadges();
    reload && reload();
  } catch (err) { toast(label + '失败：' + err.message, 'bad'); }
}
function openSubmission(s, main, reload) {
  if (s.kind === 'patch') return openPatchSubmission(s, main, reload);
  const draft = JSON.parse(JSON.stringify(s.draft || {}));
  let form = null;
  const wrap = el(['<div>',
    '<div class="hint-strip" style="margin-bottom:14px"><span>ℹ️</span><div><b>' + escapeHtml(s.from || '匿名') + '</b> 于 ' + new Date(s.createdAt).toLocaleString('zh-CN') + ' 提交 · 完整度 ' + ((s.completeness && s.completeness.percent) || 0) + '%' + (s.note ? ' · 备注：' + escapeHtml(s.note) : '') + '</div></div>',
    '<div id="subForm"></div>',
    '<div class="divider"></div>',
    '<div class="row row--wrap" style="gap:8px"><button class="btn btn--sm btn--primary" data-act="enrich">识别链接补全</button><span class="grow"></span><button class="btn btn--sm btn--quiet" data-act="approve">仅通过</button><button class="btn btn--sm btn--danger" data-act="reject">驳回</button><button class="btn btn--sm btn--danger" data-act="delete">删除</button><button class="btn btn--sm btn--brand" data-act="publish">保存并发布</button></div>',
    '</div>'].join(''));
  const ctrl = modal({ title: '投稿详情 · ' + (draft.title || '未命名'), size: 'modal--wide', body: wrap });
  form = formKit(wrap.querySelector('#subForm'), Object.assign({ notes: s.note || '', status: 'published' }, draft), { withStatus: true });
  wrap.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'enrich') {
      b.disabled = true;
      b.textContent = '识别中…';
      try {
        const res = await Api.admin.enrichSubmission(s.id);
        const d = res.draft || res.resource || {};
        form.set({ title: d.title, summary: d.summary, content: stripTagsToText(d.content), tags: d.tags, cover: d.cover, gallery: d.gallery, downloads: d.downloads, others: d.others, score: d.score, type: d.type });
        toast('已用识别结果补全，检查后保存', 'ok', 4200);
      } catch (err) { toast('识别失败：' + err.message, 'bad'); }
      b.disabled = false;
      b.textContent = '识别链接补全';
      return;
    }
    if (act === 'delete' || act === 'reject') {
      if (!(await confirmDialog({ title: act === 'reject' ? '驳回投稿' : '删除投稿', text: '确定执行？', okText: '确定', danger: true }))) return;
    }
    const action = act === 'approve' ? 'approve' : act === 'reject' ? 'reject' : act === 'delete' ? 'delete' : 'publish';
    try {
      const res = await Api.admin.decide(s.id, { action, patch: form.value });
      toast((res && res.message) || '处理完成', 'ok');
      ctrl.close();
      refreshBadges();
      reload && reload();
    } catch (err) { toast('处理失败：' + err.message, 'bad'); }
  };
}

/**
 * 内容补充投稿（前台「找更多来源」点选插入）：逐条勾选要写入的位置，
 * 编辑文字后写回原资源；也可只标记通过、或整条驳回。
 */
function openPatchSubmission(s, main, reload) {
  const inserts = Array.isArray(s.inserts) ? s.inserts : [];
  let chosen = new Set(inserts.map((x, i) => i));
  const host = el(['<div>',
    '<div class="hint-strip" style="margin-bottom:14px"><span>⤴</span><div><b>' + escapeHtml(s.from || '匿名') + '</b> 在 ' + new Date(s.createdAt).toLocaleString('zh-CN') + ' 从「找更多来源」点了 ' + inserts.length + ' 处内容'
      + (s.resourceId ? '，目标资源：<a class="link-quiet" href="#/edit/' + escapeHtml(s.resourceId) + '">《' + escapeHtml(s.targetTitle || s.resourceTitle || s.resourceId) + '》</a>' : '，目标资源已不在库中')
      + (s.sourceUrl ? ' · 来源 <a class="link-quiet" target="_blank" rel="noopener nofollow" href="' + escapeHtml(s.sourceUrl) + '">原页</a>' : '') + '</div></div>',
    '<div class="sub-insert-list"></div>',
    '<div class="row row--wrap" style="gap:8px;margin-top:12px"><input class="input" id="subNote" placeholder="给访客留个说明（可选）" style="max-width:280px" /></div>',
    '<div class="divider"></div>',
    '<div class="row row--wrap" style="gap:8px"><span class="tiny mono muted grow" id="subHint"></span>'
      + '<button class="btn btn--sm btn--quiet" data-pick="all">全选</button><button class="btn btn--sm btn--quiet" data-pick="none">全不选</button>'
      + '<button class="btn btn--sm btn--quiet" data-act="approve">仅通过不写入</button><button class="btn btn--sm btn--danger" data-act="reject">驳回</button>'
      + '<button class="btn btn--sm btn--brand" data-act="publish">写入所选</button></div>',
    '</div>'].join(''));
  const list = host.querySelector('.sub-insert-list');
  const paint = () => {
    list.innerHTML = '';
    if (!inserts.length) { list.innerHTML = '<p class="muted small">这条投稿没有携带可写入的内容。</p>'; return; }
    inserts.forEach((it, i) => {
      const value = insertValue(it);
      const row = el(['<label class="ins-row' + (chosen.has(i) ? ' is-on' : '') + '">',
        '<span class="ins-row__pick"><input type="checkbox" class="check" data-i="' + i + '"' + (chosen.has(i) ? ' checked' : '') + ' /><span class="ins-row__icon">' + (it.field === 'cover' || it.field === 'gallery' || it.field === 'image' ? '▣' : it.field === 'downloads' || it.field === 'others' || it.field === 'sourceUrl' ? '⛓' : '¶') + '</span></span>',
        '<span class="ins-row__main"><span class="ins-row__text"></span>',
        '<span class="ins-row__sub tiny mono muted">' + escapeHtml(PATCH_LABEL[it.field] || it.field || '内容') + ' · ' + (it.value && typeof it.value === 'object' && !Array.isArray(it.value) ? Object.keys(it.value).join('/') : typeof it.value) + '</span></span>',
        (it.field === 'cover' || it.field === 'gallery' || it.field === 'image') && /^\/(uploads\/|assets\/)|^https?:/.test(String((it.value || {}).url || '')) ? '<img class="ins-row__thumb" src="' + escapeHtml((it.value || {}).url) + '" alt="" loading="lazy" />' : '',
        '</label>'].join(''));
      row.querySelector('.ins-row__text').textContent = value.length > 160 ? value.slice(0, 160) + '…' : value;
      list.append(row);
    });
    const hint = host.querySelector('#subHint');
    if (hint) hint.textContent = '已选 ' + chosen.size + ' / ' + inserts.length + ' 处 · 写入规则与服务端一致：只填空位，正文与图集追加';
  };
  paint();
  host.onclick = async (e) => {
    const cb = e.target.closest('[data-i]');
    if (cb) { const i = Number(cb.dataset.i); if (cb.checked) chosen.add(i); else chosen.delete(i); paint(); return; }
    const pk = e.target.closest('[data-pick]');
    if (pk) { chosen = new Set(pk.dataset.pick === 'all' ? inserts.map((x, i) => i) : []); paint(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'reject') { if (!(await confirmDialog({ title: '驳回内容补充', text: '驳回后不会写入资源，可在说明里写原因。', okText: '驳回', danger: true }))) return; }
    if (act === 'publish' && !chosen.size) return toast('先勾选要写入的位置', 'warn');
    const payload = {
      action: act === 'publish' ? 'publish' : act,
      note: (host.querySelector('#subNote').value || '').slice(0, 200),
      inserts: Array.from(chosen).map((i) => inserts[i]),
    };
    b.disabled = true;
    try {
      const res = await Api.admin.decide(s.id, payload);
      toast((res && res.message) || '处理完成', 'ok', 4600);
      ctrl.close();
      refreshBadges();
      reload && reload();
    } catch (err) { toast('处理失败：' + (err.message || '服务异常'), 'bad', 4600); b.disabled = false; }
  };
  const ctrl = modal({ title: '内容补充 · ' + (s.targetTitle || s.resourceTitle || s.title || '未命名'), sub: '前台点选的内容，写入前可逐条挑。', size: 'modal--wide', body: host });
}

/* ---------- 导入中心（后台） ---------- */
const imp = { step: 0, file: null, parsed: null, drafts: [], selected: new Set(), report: null, batch: '', options: { mirror: true, imageLimit: 4, concurrency: 5, timeout: 9000, asDraft: false } };
const IMP_STEPS = ['上传', '映射', '识别', '导入'];
async function viewImport(main) {
  main.innerHTML = [
    head('导入中心', 'Excel / CSV 批量入库：解析表格 → 链接图文识别 → 弹窗预览 → 全部导入或勾选导入', '<button class="btn btn--sm btn--quiet" id="impReset">重置向导</button>'),
    '<div class="wiz" id="impWiz"></div><div id="impBody"></div>',
  ].join('');
  main.querySelector('#impReset').onclick = () => { Object.assign(imp, { step: 0, file: null, parsed: null, drafts: [], selected: new Set(), report: null }); draw(main); };
  draw(main);
  async function draw(host) {
    const wiz = host.querySelector('#impWiz');
    wiz.innerHTML = IMP_STEPS.map((n, i) => '<button class="step' + (i === imp.step ? ' on' : '') + (i < imp.step ? ' done' : '') + '" data-i="' + i + '"' + (i > imp.step ? ' disabled' : '') + '><b>' + (i < imp.step ? '✓' : i + 1) + '</b>' + n + '</button>').join('<span class="step__sep"></span>')
      + '<span class="grow"></span><span class="mono tiny muted" id="impHint"></span>';
    Array.from(wiz.querySelectorAll('.step')).forEach((s) => s.onclick = () => { imp.step = Number(s.dataset.i); draw(host); });
    const body = host.querySelector('#impBody');
    body.innerHTML = '';
    [impUpload, impMapping, impEnrich, impCommit][imp.step](body, host);
    reveal(body);
    rippleAll(body);
  }
  function hint(t) { const n = document.querySelector('#impHint'); if (n) n.innerHTML = t; }

  function impUpload(body, host) {
    body.append(el(['<div class="admin-cols">',
      '<div class="card card--pad" data-reveal>',
      '<div class="dropzone" id="dz" tabindex="0"><span class="dropzone__icon">📈</span><h3 style="margin:0;font-size:17px">拖入 Excel / CSV，或点击选择</h3><p class="muted small" style="margin:0">.xlsx / .xls / .csv / .tsv，≤ 15MB</p><span class="btn btn--primary" style="pointer-events:none">选择文件</span><input type="file" hidden id="f" accept=".xlsx,.xls,.csv,.tsv,.txt" /></div>',
      '<div id="fileInfo"></div>',
      '</div>',
      '<div class="card card--pad" data-reveal><h3 style="font-size:15px;margin-bottom:10px">表头建议</h3><div class="table-wrap" style="max-height:340px"><table class="table table--compact"><tbody>'
      + [['标题', '必填 · 用于搜索与同名合并'], ['类型', '电影/软件/素材…留空归入其他'], ['标签', '空格或逗号分隔'], ['分数', '0-10'], ['简介', '一句话说明'], ['内容', '详细介绍，保留换行'], ['资源下载', '网盘/磁力/直链，可多行'], ['其他来源', '在线站点链接'], ['封面图', '图片直链'], ['年份/地区/大小/格式/作者/来源页/备注', '可选']]
        .map(([a, b]) => '<tr><td><b class="mono tiny">' + escapeHtml(a) + '</b></td><td class="tiny dim">' + escapeHtml(b) + '</td></tr>').join('')
      + '</tbody></table></div><p class="tiny muted" style="margin-top:10px">示例文件：samples/demo-resources.xlsx（可用 <b>npm run sample</b> 重新生成）</p></div>',
      '</div>'].join('')));
    const dz = body.querySelector('#dz');
    const f = body.querySelector('#f');
    dz.onclick = () => f.click();
    dz.onkeydown = (e) => { if (e.key === 'Enter') f.click(); };
    f.onchange = () => { if (f.files[0]) uploadFile(f.files[0], host); };
    ['dragenter', 'dragover'].forEach((k) => dz.addEventListener(k, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((k) => dz.addEventListener(k, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', (e) => { const file = e.dataTransfer.files[0]; if (file) uploadFile(file, host); });
  }
  function uploadFile(file, host) {
    if (file.size > 15 * 1024 * 1024) return toast('文件超过 15MB', 'bad');
    imp.file = file;
    const info = host.querySelector('#fileInfo');
    if (info) info.innerHTML = '<div class="row" style="gap:10px;margin-top:12px"><span class="spinner"></span><b class="small">' + escapeHtml(file.name) + '</b><span class="tiny mono muted">' + fmtBytes(file.size) + '</span><span class="tiny muted">读取中…</span></div>';
    const fr = new FileReader();
    fr.onload = async () => {
      const base64 = String(fr.result).split(',')[1] || '';
      try {
        const res = await Api.admin.importParse({ filename: file.name, base64 });
        imp.parsed = res;
        imp.drafts = res.drafts;
        imp.selected = new Set(res.drafts.map((d) => d.id));
        imp.batch = 'IMP' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
        imp.step = 1;
        toast('解析完成：' + res.drafts.length + ' 行', 'ok');
        host.querySelector('#impWiz') && draw(host);
      } catch (err) {
        if (info) info.innerHTML = '<div class="hint-strip bad-strip" style="margin-top:12px"><span>⚠️</span><div>' + escapeHtml(err.message) + '</div></div>';
        toast('解析失败：' + err.message, 'bad', 5000);
      }
    };
    fr.onerror = () => toast('读取文件失败', 'bad');
    fr.readAsDataURL(file);
  }

  function impMapping(body, host) {
    const res = imp.parsed;
    if (!res) { body.append(el('<div class="hint-strip bad-strip"><span>⚠️</span><div>还没有解析结果，请先上传文件。</div></div>')); return; }
    const fields = store.bootstrap.fields || [];
    hint('表头第 ' + ((res.headerLine || 0) + 1) + ' 行 · ' + res.totalRows + ' 行数据');
    body.append(el(['<div class="card card--pad" data-reveal>',
      '<div class="row row--between" style="margin-bottom:12px"><h3 style="font-size:16px">列 ↔ 字段映射</h3><div class="row" style="gap:8px"><span class="badge badge--ok">自动 ' + Object.keys(res.mapping).length + '</span>' + (res.unmapped.length ? '<span class="badge badge--warn">未映射 ' + res.unmapped.length + '</span>' : '') + '</div></div>',
      '<div class="mapping-grid" id="mg">' + fields.map((f) => {
        const cur = res.mapping[f.key] || '';
        return '<div class="map-item' + (cur ? ' filled' : '') + '"><div class="map-item__label"><i></i><b>' + escapeHtml(f.label) + '</b>' + (f.required ? '<span class="tiny muted">必填</span>' : '') + '<span class="grow"></span><span class="mono tiny muted">' + escapeHtml(f.key) + '</span></div>'
          + '<div class="select-wrap"><select class="select" data-field="' + f.key + '"><option value="">— 不导入 —</option>' + res.headers.map((h) => '<option value="' + escapeHtml(h) + '"' + (cur === h ? ' selected' : '') + '>' + escapeHtml(h) + '</option>').join('') + '</select></div></div>';
      }).join('') + '</div>',
      '<div class="divider"></div><div class="field" style="max-width:300px"><label>导入批次号</label><input class="input" id="batch" value="' + escapeHtml(imp.batch) + '" /></div>',
      '<div class="row row--wrap" style="gap:10px;margin-top:16px"><button class="btn btn--primary" id="next">下一步：识别图文 →</button><button class="btn btn--quiet" id="skip">跳过识别直接预览</button></div>',
      '<div class="hint-strip" style="margin-top:14px"><span>📊</span><div>' + (res.stats.total) + ' 行 · 完整 ' + res.stats.complete + ' · 需补全 ' + res.stats.needFix + ' · 无下载链接 ' + res.stats.noLink + ' · 无标题 ' + res.stats.noTitle + ' · 表内重复 ' + res.stats.dupInTable + '</div></div>',
      '</div>'].join('')));
    body.querySelector('#batch').oninput = (e) => { imp.batch = e.target.value; };
    body.querySelector('#next').onclick = () => { imp.step = 2; draw(host); };
    body.querySelector('#skip').onclick = () => { imp.step = 3; draw(host); };
    body.querySelector('#mg').onchange = async (e) => {
      const sel = e.target.closest('select[data-field]');
      if (!sel) return;
      sel.closest('.map-item').classList.toggle('filled', !!sel.value);
      const mapping = {};
      Array.from(body.querySelectorAll('select[data-field]')).forEach((s) => { if (s.value) mapping[s.dataset.field] = s.value; });
      try {
        const res2 = await Api.admin.importParse({ filename: imp.file.name, base64: imp.base64, mapping });
        imp.parsed = res2;
        imp.drafts = res2.drafts;
        imp.selected = new Set(res2.drafts.map((d) => d.id));
        hint('已重新映射 · ' + res2.drafts.length + ' 行');
      } catch (err) { toast('重新解析失败：' + err.message, 'bad'); }
    };
  }

  function impEnrich(body, host) {
    hint(imp.drafts.length + ' 行待识别');
    body.append(el(['<div class="card card--pad" data-reveal>',
      '<div class="row row--between" style="margin-bottom:10px"><div><h3 style="font-size:16px">识别链接中的图片与文字</h3><p class="tiny muted" style="margin:4px 0 0">服务端访问每行链接，抓取标题 / 描述 / 关键词 / 正文 / 图片，仅填补空白字段</p></div><button class="btn btn--primary" id="go">开始识别</button></div>',
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px">',
      '<label class="switch"><input type="checkbox" id="oMirror"' + (imp.options.mirror ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">图片转存本地</span></label>',
      '<label class="switch"><input type="checkbox" id="oDraft"' + (imp.options.asDraft ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">导入为草稿</span></label>',
      '<div class="field"><label>每行最多图片</label><input class="input" type="number" min="0" max="12" id="oLimit" value="' + imp.options.imageLimit + '" /></div>',
      '<div class="field"><label>超时（毫秒）</label><input class="input" type="number" min="2000" max="30000" step="500" id="oTimeout" value="' + imp.options.timeout + '" /></div>',
      '</div>',
      '<div class="divider"></div>',
      '<div class="progress-thin"><i id="bar" style="width:' + (imp.report ? 100 : 0) + '%"></i></div>',
      '<div class="row row--wrap" style="gap:8px;margin-top:12px"><span class="mono tiny muted" id="status">' + (imp.report ? '上次识别：成功 ' + imp.report.ok + ' / 失败 ' + imp.report.failed + ' · 图片 ' + imp.report.images + ' · 补全字段 ' + imp.report.filled : '尚未开始') + '</span></div>',
      '<div id="log" style="margin-top:12px;display:grid;gap:6px;max-height:300px;overflow:auto"></div>',
      '<div class="row" style="gap:10px;margin-top:16px"><button class="btn btn--quiet" id="back">← 上一步</button><button class="btn btn--brand" id="next">下一步：预览导入 →</button></div>',
      '</div>'].join('')));
    body.querySelector('#go').onclick = async (e) => {
      const btn = e.currentTarget;
      const bar = body.querySelector('#bar');
      const st = body.querySelector('#status');
      imp.options.mirror = body.querySelector('#oMirror').checked;
      imp.options.asDraft = body.querySelector('#oDraft').checked;
      imp.options.imageLimit = Number(body.querySelector('#oLimit').value) || 0;
      imp.options.timeout = Number(body.querySelector('#oTimeout').value) || 9000;
      btn.disabled = true;
      btn.textContent = '识别中…';
      let shown = 0;
      const tick = setInterval(() => { shown = Math.min(93, shown + 2.5); bar.style.width = shown + '%'; st.textContent = '正在抓取…进度 ' + Math.round(shown) + '%'; }, 320);
      try {
        const res = await Api.admin.importEnrich({ drafts: imp.drafts, mirror: imp.options.mirror, imageLimit: imp.options.imageLimit, concurrency: imp.options.concurrency, timeout: imp.options.timeout });
        clearInterval(tick);
        bar.style.width = '100%';
        imp.drafts = res.drafts;
        imp.report = res.report;
        st.textContent = '完成：访问 ' + res.report.urls + ' 个链接 · 成功 ' + res.report.ok + ' · 失败 ' + res.report.failed + ' · 图片 ' + res.report.images + ' · 补全字段 ' + res.report.filled;
        const log = body.querySelector('#log');
        log.innerHTML = '';
        (res.report.perDraft || []).filter((d) => d.errors && d.errors.length).slice(0, 30).forEach((d) => log.append(el('<div class="hint-strip warn-strip"><span>⚠️</span><div><b>第 ' + d.line + ' 行 ' + escapeHtml(d.title || '') + '</b><br />' + d.errors.map((x) => '<span class="mono tiny">' + escapeHtml(x) + '</span>').join('<br />') + '</div></div>')));
        if (!log.children.length) log.append(el('<div class="hint-strip"><span>✅</span><div>全部链接识别成功</div></div>'));
        toast('识别完成', 'ok');
      } catch (err) {
        clearInterval(tick);
        bar.style.width = '0%';
        st.textContent = '识别失败：' + err.message;
        toast('识别失败：' + err.message, 'bad', 5000);
      } finally { btn.disabled = false; btn.textContent = '重新识别'; }
    };
    body.querySelector('#back').onclick = () => { imp.step = 1; draw(host); };
    body.querySelector('#next').onclick = () => { imp.step = 3; draw(host); };
  }

  function impCommit(body, host) {
    if (!imp.drafts.length) { body.append(el('<div class="hint-strip bad-strip"><span>⚠️</span><div>没有数据，请回到第一步上传文件。</div></div>')); return; }
    hint(imp.selected.size + ' / ' + imp.drafts.length + ' 已勾选');
    body.append(el(['<div class="card card--pad" data-reveal>',
      '<div class="row row--between" style="margin-bottom:10px"><div><h3 style="font-size:16px">预览导入</h3><p class="tiny muted" style="margin:4px 0 0">勾选要导入的行；黄色为信息不全，可编辑后导入；同名资源自动合并</p></div><button class="btn btn--primary" id="openModal">打开预览弹窗</button></div>',
      '<div class="row row--wrap" style="gap:8px;margin-bottom:12px">',
      '<button class="btn btn--sm btn--quiet" data-sel="all">全选</button><button class="btn btn--sm btn--quiet" data-sel="none">全不选</button><button class="btn btn--sm btn--quiet" data-sel="invert">反选</button><button class="btn btn--sm btn--quiet" data-sel="bad">仅选未完善</button>',
      '<span class="grow"></span><label class="switch"><input type="checkbox" id="oDraft2"' + (imp.options.asDraft ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">导入为草稿</span></label>',
      '<button class="btn btn--sm btn--primary" data-commit="all">全部导入</button><button class="btn btn--sm btn--brand" data-commit="picked">导入勾选项</button>',
      '</div>',
      '<div class="imp-row imp-row__head"><span>#</span><span>封面</span><span>标题</span><span>标签 / 类型</span><span>完整度</span><span style="text-align:right">操作</span></div>',
      '<div id="rows" style="display:grid;gap:8px;max-height:58vh;overflow:auto;padding-right:4px"></div>',
      '</div>'].join('')));
    const rows = body.querySelector('#rows');
    const drawRows = () => {
      rows.innerHTML = '';
      imp.drafts.forEach((d) => rows.append(impRow(d, host, drawRows)));
      hint(imp.selected.size + ' / ' + imp.drafts.length + ' 已勾选');
    };
    drawRows();
    body.onclick = (e) => {
      const sel = e.target.closest('[data-sel]');
      if (sel) {
        const k = sel.dataset.sel;
        if (k === 'all') imp.drafts.forEach((d) => imp.selected.add(d.id));
        if (k === 'none') imp.selected.clear();
        if (k === 'invert') imp.drafts.forEach((d) => (imp.selected.has(d.id) ? imp.selected.delete(d.id) : imp.selected.add(d.id)));
        if (k === 'bad') { imp.selected.clear(); imp.drafts.forEach((d) => { if (!d.completeness || d.completeness.percent < 100) imp.selected.add(d.id); }); }
        drawRows();
        return;
      }
      const cm = e.target.closest('[data-commit]');
      if (cm) {
        if (cm.dataset.commit === 'all') imp.drafts.forEach((d) => imp.selected.add(d.id));
        commitDraw(host, cm);
      }
    };
    body.querySelector('#openModal').onclick = () => impModal(host);
    body.querySelector('#oDraft2').onchange = (e) => { imp.options.asDraft = e.target.checked; };
  }
  function impRow(d, host, redraw) {
    const c = d.completeness || { percent: 0, missing: [] };
    const row = el(['<div class="imp-row' + (imp.selected.has(d.id) ? ' is-picked' : '') + (c.percent < 100 ? ' is-bad' : '') + '">',
      '<span class="mono tiny muted">' + d.line + '</span>',
      '<button class="review-row__thumb" style="width:54px;height:38px" data-zoom>' + (d.draft.cover || ((d.draft.gallery || [])[0] || {}).url ? '<img src="' + imgSrc(d.draft.cover || d.draft.gallery[0].url, d.draft.title) + '" alt="" loading="lazy" onerror="this.remove()" />' : '·') + '</button>',
      '<div style="min-width:0"><b class="truncate small">' + escapeHtml(d.draft.title || '（无标题）') + '</b><div class="tiny muted truncate">' + escapeHtml((d.draft.summary || '').slice(0, 70) || '（无简介）') + '</div></div>',
      '<div class="pill-list">' + '<span class="tag">' + escapeHtml(d.draft.type) + '</span>' + (d.draft.tags || []).slice(0, 2).map((t) => '<span class="tag">#' + escapeHtml(t) + '</span>').join('') + '</div>',
      completenessBar(c),
      '<div class="row row--tight" style="justify-content:flex-end"><input type="checkbox" class="check" data-pick' + (imp.selected.has(d.id) ? ' checked' : '') + ' /><button class="icon-btn icon-btn--sm" data-edit title="编辑">✎</button><button class="icon-btn icon-btn--sm" data-one title="识别此行">✨</button></div>',
      '</div>'].join(''));
    row.querySelector('[data-pick]').onchange = (e) => { if (e.target.checked) imp.selected.add(d.id); else imp.selected.delete(d.id); row.classList.toggle('is-picked', e.target.checked); hint(imp.selected.size + ' / ' + imp.drafts.length + ' 已勾选'); };
    row.querySelector('[data-zoom]').onclick = () => { const imgs = (d.draft.gallery || []).map((g) => ({ url: g.url, caption: g.caption || '' })); if (d.draft.cover) imgs.unshift({ url: d.draft.cover, caption: '封面' }); if (!imgs.length) return toast('此行无图片'); openLightbox(imgs, 0); };
    row.querySelector('[data-edit]').onclick = () => editDraftRow(d, host, redraw);
    row.querySelector('[data-one]').onclick = async (e) => {
      e.target.disabled = true;
      try {
        const res = await Api.admin.importEnrich({ drafts: [d], mirror: imp.options.mirror, imageLimit: imp.options.imageLimit, concurrency: 3, timeout: imp.options.timeout });
        Object.assign(d, res.drafts[0]);
        toast('第 ' + d.line + ' 行识别完成', 'ok');
        redraw();
      } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; }
    };
    return row;
  }
  function editDraftRow(d, host, redraw) {
    const draft = JSON.parse(JSON.stringify(d.draft));
    formSection(draft, (patch) => {
      Object.assign(d.draft, patch);
      d.issues = [];
      redraw && redraw();
      toast('第 ' + d.line + ' 行已更新', 'ok', 1800);
    });
  }
  function formSection(draft, onSave) {
    let form = null;
    const wrap = el(['<div>',
      '<div id="subForm"></div>',
      '<div class="divider"></div>',
      '<div class="row" style="gap:8px"><button class="btn btn--sm btn--quiet" data-act="enrich">自动识别链接</button><span class="grow"></span><button class="btn btn--sm btn--quiet" data-act="cancel">取消</button><button class="btn btn--sm btn--brand" data-act="save">保存此行</button></div>',
      '</div>'].join(''));
    const ctrl = modal({ title: '编辑：' + (draft.title || '未命名'), size: 'modal--wide', body: wrap });
    form = formKit(wrap.querySelector('#subForm'), Object.assign({ status: 'published' }, draft), {});
    wrap.onclick = async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'cancel') return ctrl.close();
      if (b.dataset.act === 'enrich') {
        const v = form.value;
        const urls = [v.sourceUrl].concat(v.downloads.map((x) => x.url), v.others.map((x) => x.url)).filter((u) => /^https?:/i.test(u || ''));
        if (!urls.length) return toast('没有可识别的链接', 'warn');
        b.disabled = true;
        try {
          const res = await Api.enrich(urls.slice(0, 8), true);
          const good = res.items.filter((x) => x.ok).map((x) => x.result);
          const patch = {};
          if (!v.summary && good[0]) patch.summary = String(good[0].description || good[0].textPreview || '').slice(0, 220);
          if (!v.content && good[0]) patch.content = String(good[0].text || good[0].textPreview || '').slice(0, 1200);
          const imgs = [];
          good.forEach((g) => (g.images || []).forEach((i) => imgs.push({ url: i.url, caption: g.title || '' })));
          if (imgs.length) patch.gallery = v.gallery.concat(imgs.filter((i) => !v.gallery.some((g) => g.url === i.url)));
          if (!v.cover && imgs.length) patch.cover = imgs[0].url;
          form.set(patch);
          toast('已补入识别结果', 'ok');
        } catch (err) { toast(err.message, 'bad'); }
        b.disabled = false;
        return;
      }
      if (b.dataset.act === 'save') { onSave(form.value); ctrl.close(); }
    };
  }
  function impModal(host) {
    let filter = 'all';
    const wrap = el(['<div>',
      '<div class="row row--wrap" style="gap:8px;margin-bottom:12px">',
      '<div class="pill-tabs"><button class="chip is-on" data-f="all">全部</button><button class="chip" data-f="bad">仅未完善</button><button class="chip" data-f="ok">仅完整</button></div>',
      '<button class="btn btn--sm btn--quiet" data-sel="all">全选</button><button class="btn btn--sm btn--quiet" data-sel="none">全不选</button><button class="btn btn--sm btn--quiet" data-sel="invert">反选</button>',
      '<span class="grow"></span><span class="badge badge--brand" id="mCount"></span></div>',
      '<div id="mRows" style="display:grid;gap:8px;max-height:52vh;overflow:auto;padding-right:4px"></div>',
      '<div class="divider"></div>',
      '<div class="row row--wrap" style="gap:10px"><button class="btn btn--primary" data-commit="all">全部导入</button><button class="btn btn--brand" data-commit="picked">导入勾选项</button><label class="switch" style="margin-left:auto"><input type="checkbox" id="mDraft"' + (imp.options.asDraft ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">存为草稿</span></label></div>',
      '<p class="tiny muted" style="margin-top:10px">导入后同名资源会自动合并下载链接与图片，不会产生重复条目。</p>',
      '</div>'].join(''));
    const ctrl = modal({ title: '导入预览 · 勾选导入', size: 'modal--wide', body: wrap });
    const rowsBox = wrap.querySelector('#mRows');
    const redraw = () => {
      rowsBox.innerHTML = '';
      const list = filter === 'bad' ? imp.drafts.filter((d) => !d.completeness || d.completeness.percent < 100) : filter === 'ok' ? imp.drafts.filter((d) => d.completeness && d.completeness.percent >= 100) : imp.drafts;
      if (!list.length) rowsBox.innerHTML = '<p class="muted small">该筛选下没有数据行</p>';
      list.forEach((d) => rowsBox.append(impRow(d, host, () => { ctrl.close(); draw(host); })));
      wrap.querySelector('#mCount').textContent = '已勾选 ' + imp.selected.size + ' / ' + imp.drafts.length;
    };
    wrap.querySelector('.pill-tabs').onclick = (e) => {
      const b = e.target.closest('[data-f]');
      if (!b) return;
      filter = b.dataset.f;
      Array.from(wrap.querySelectorAll('.pill-tabs .chip')).forEach((c) => c.classList.toggle('is-on', c === b));
      redraw();
    };
    wrap.onclick = (e) => {
      const sel = e.target.closest('[data-sel]');
      if (sel) {
        const k = sel.dataset.sel;
        if (k === 'all') imp.drafts.forEach((d) => imp.selected.add(d.id));
        if (k === 'none') imp.selected.clear();
        if (k === 'invert') imp.drafts.forEach((d) => (imp.selected.has(d.id) ? imp.selected.delete(d.id) : imp.selected.add(d.id)));
        redraw();
        return;
      }
      const cm = e.target.closest('[data-commit]');
      if (cm) { if (cm.dataset.commit === 'all') imp.drafts.forEach((d) => imp.selected.add(d.id)); commitDraw(host, cm, () => ctrl.close()); }
    };
    wrap.querySelector('#mDraft').onchange = (e) => { imp.options.asDraft = e.target.checked; };
    redraw();
  }
  async function commitDraw(host, btn, after) {
    if (!imp.selected.size) return toast('请先勾选要导入的行', 'warn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '导入中…';
    try {
      const res = await Api.admin.importCommit({ drafts: imp.drafts, selected: Array.from(imp.selected), batch: imp.batch, asDraft: imp.options.asDraft });
      modal({
        title: '导入完成', size: 'modal--narrow',
        body: '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)"><div class="stat-tile"><b>' + res.created + '</b><span>新建</span></div><div class="stat-tile"><b>' + res.merged + '</b><span>合并</span></div><div class="stat-tile"><b>' + res.skipped + '</b><span>跳过</span></div></div><p class="tiny muted" style="margin-top:12px">批次号 ' + escapeHtml(res.batch || imp.batch) + ' · 可在资源管理按批次检索</p>',
        foot: '<a class="btn btn--quiet" href="#/import" onclick="location.reload()">再导一份</a><a class="btn btn--primary" href="#/resources">查看资源</a>',
      });
      if (after) after();
      imp.drafts = [];
      imp.parsed = null;
      imp.report = null;
      imp.selected = new Set();
      imp.step = 0;
      draw(host);
      await reloadBootstrap();
      refreshBadges();
    } catch (err) { toast('导入失败：' + err.message, 'bad', 5000); }
    btn.disabled = false;
    btn.textContent = label;
  }
}
async function reloadBootstrap() {
  try { store.bootstrap = await Api.bootstrap(); } catch {}
}

/* ---------- 分类标签 ---------- */
async function viewTaxonomy(main) {
  main.innerHTML = head('分类与标签', '类型决定资源分组与配色；标签用于筛选与聚合', '<button class="btn btn--sm btn--primary" id="addType">+ 新增类型</button>')
    + '<div class="admin-cols"><div id="typeHost"></div><div id="tagHost" style="display:grid;gap:16px"></div></div>';
  await load();
  main.querySelector('#addType').onclick = () => typeEditor(null);
  async function load() {
    const data = await guard(Api.admin.taxonomy(), main);
    const th = main.querySelector('#typeHost');
    th.innerHTML = '<div class="panel-h"><h3>资源类型</h3><span class="grow"></span><span class="mono tiny muted">' + data.types.length + ' 个</span></div><div class="type-grid">'
      + data.types.map((t) => '<div class="type-card" data-key="' + escapeHtml(t.key) + '"><div class="type-card__top"><span class="type-card__ico" style="background:' + (t.color || '#7c5cff') + '22;color:' + (t.color || '#7c5cff') + ';border:1px solid ' + (t.color || '#7c5cff') + '55">' + escapeHtml(t.icon || '⊙') + '</span><div style="min-width:0"><b class="truncate">' + escapeHtml(t.name) + '</b><div class="mono tiny muted">' + escapeHtml(t.key) + '</div></div><span class="grow"></span><span class="badge">' + (t.count || 0) + '</span></div>'
        + '<div class="row row--tight"><button class="btn btn--sm btn--quiet" data-a="edit">编辑</button><button class="btn btn--sm btn--quiet" data-a="filter">查看资源</button><button class="btn btn--sm btn--danger" data-a="del">删除</button></div></div>').join('') + '</div>';
    th.onclick = (e) => {
      const card = e.target.closest('.type-card');
      const btn = e.target.closest('[data-a]');
      if (!card || !btn) return;
      const key = card.dataset.key;
      const t = data.types.find((x) => x.key === key);
      if (btn.dataset.a === 'edit') typeEditor(t);
      if (btn.dataset.a === 'filter') location.hash = '#/resources?type=' + encodeURIComponent(key);
      if (btn.dataset.a === 'del') delType(t);
    };
    const gh = main.querySelector('#tagHost');
    gh.innerHTML = card('标签', '<div class="row row--tight" style="margin-bottom:12px"><input class="input" id="newTag" placeholder="新增标签，回车提交" /></div><div class="table-wrap"><table class="table table--compact"><thead><tr><th>标签</th><th>引用</th><th style="text-align:right">操作</th></tr></thead><tbody>'
      + data.tags.map((t) => '<tr><td><span class="tag" style="border-color:' + (t.color || '#7c5cff') + '55;color:' + (t.color || '#c9bcff') + '">' + (t.pinned ? '★ ' : '') + escapeHtml(t.name) + '</span></td><td class="mono tiny">' + (t.count || 0) + '</td>'
        + '<td style="text-align:right"><div class="row row--tight" style="justify-content:flex-end"><button class="icon-btn icon-btn--sm" data-t="rename" data-name="' + escapeHtml(t.name) + '" title="重命名">✎</button><button class="icon-btn icon-btn--sm" data-t="pin" data-name="' + escapeHtml(t.name) + '" title="置顶">' + (t.pinned ? '◎' : '☆') + '</button><button class="icon-btn icon-btn--sm" data-t="color" data-name="' + escapeHtml(t.name) + '" title="改色">🎨</button><button class="icon-btn icon-btn--sm" data-t="del" data-name="' + escapeHtml(t.name) + '" title="删除">×</button></div></td></tr>').join('')
      + '</tbody></table></div>');
    const tagInput = gh.querySelector('#newTag');
    tagInput.onkeydown = async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const names = tagInput.value.split(/[,，\s]+/).filter(Boolean);
      if (!names.length) return;
      try { await Api.admin.saveTags(names); tagInput.value = ''; toast('已添加标签', 'ok'); load(); } catch (err) { toast(err.message, 'bad'); }
    };
    gh.querySelector('.table-wrap').onclick = async (e) => {
      const btn = e.target.closest('[data-t]');
      if (!btn) return;
      const name = btn.dataset.name;
      const act = btn.dataset.t;
      try {
        if (act === 'rename') {
          const next = window.prompt('把标签「' + name + '」重命名为：', name);
          if (!next || next === name) return;
          await Api.admin.patchTag(name, { rename: next.trim() });
        }
        if (act === 'pin') await Api.admin.patchTag(name, { pinned: !(data.tags.find((x) => x.name === name) || {}).pinned });
        if (act === 'color') {
          const c = window.prompt('标签颜色（十六进制）', '#7c5cff');
          if (c) await Api.admin.patchTag(name, { color: c.trim() });
        }
        if (act === 'del') {
          if (!(await confirmDialog({ title: '删除标签', text: '将把「' + name + '」从其下所有资源移除。', okText: '删除', danger: true }))) return;
          await Api.admin.patchTag(name, { remove: true });
        }
        toast('已更新', 'ok', 1800);
        load();
      } catch (err) { toast(err.message, 'bad'); }
    };
    reveal(main);
    rippleAll(main);
  }
  function typeEditor(t) {
    const isNew = !t;
    modal({
      title: isNew ? '新增类型' : '编辑类型：' + t.name, size: 'modal--narrow',
      body: '<div style="display:grid;gap:12px">'
        + '<div class="field"><label>标识（英文 key）</label><input class="input" id="tk" value="' + escapeHtml(t ? t.key : '') + '"' + (isNew ? '' : ' disabled') + ' placeholder="素材" /></div>'
        + '<div class="field"><label>显示名</label><input class="input" id="tn" value="' + escapeHtml(t ? t.name : '') + '" placeholder="设计素材" /></div>'
        + '<div class="field"><label>颜色</label><input class="input" id="tc" type="color" value="' + escapeHtml(t ? t.color : '#7c5cff') + '" style="height:44px;padding:4px" /></div>'
        + '<div class="field"><label>图标（单字符 / emoji）</label><input class="input" id="ti" maxlength="2" value="' + escapeHtml(t ? t.icon : '⊙') + '" /></div></div>',
      foot: '<button class="btn btn--quiet" data-x>取消</button><button class="btn btn--primary" data-ok>' + (isNew ? '创建' : '保存') + '</button>',
      onMount(node, close) {
        node.querySelector('[data-x]').onclick = close;
        node.querySelector('[data-ok]').onclick = async () => {
          const key = (node.querySelector('#tk').value || node.querySelector('#tn').value).trim();
          if (!key) return toast('请填写标识或显示名', 'warn');
          try {
            await Api.admin.saveType({ key, name: node.querySelector('#tn').value.trim() || key, color: node.querySelector('#tc').value, icon: node.querySelector('#ti').value });
            toast('已保存类型', 'ok');
            close();
            load();
            await reloadBootstrap();
          } catch (err) { toast(err.message, 'bad'); }
        };
      },
    });
  }
  async function delType(t) {
    if (!t) return;
    if (t.count) { if (!(await confirmDialog({ title: '删除类型', text: '「' + t.name + '」下还有 ' + t.count + ' 条资源，删除后会改归为「其他」。', okText: '继续删除', danger: true }))) return; }
    try { const r = await Api.admin.removeType(t.key); toast(r.message || '已删除', 'ok'); load(); await reloadBootstrap(); } catch (err) { toast(err.message, 'bad'); }
  }
}

/* ---------- 检索来源 ---------- */
async function viewSources(main) {
  main.innerHTML = head('检索来源', '聚合搜索的数据源：本地库 / JSON 接口 / RSS / HTML 抓取 / 跳转检索', '<button class="btn btn--sm btn--primary" id="addSrc">+ 新增来源</button>')
    + '<div class="hint-strip" style="margin-bottom:14px"><span>ℹ️</span><div><b>模式说明</b> · <span class="mono tiny">local</span> 查询本站资源库；<span class="mono tiny">api</span> 请求 JSON 接口（可配 listPath 与 map 字段映射）；<span class="mono tiny">xml</span> 解析 RSS/Atom；<span class="mono tiny">html</span> 抓取网页链接（需对方允许匿名访问）；<span class="mono tiny">url</span> 生成跳转检索按钮（新窗口打开，适合需要登录的网盘搜索站）。</div></div>'
    + '<div id="srcHost"></div>';
  await load();
  main.querySelector('#addSrc').onclick = () => edit(null);
  async function load() {
    const data = await guard(Api.admin.sources(), main);
    const host = main.querySelector('#srcHost');
    host.innerHTML = '<div class="table-wrap"><table class="table admin-table"><thead><tr><th style="width:34px"></th><th>名称</th><th>类别</th><th>模式</th><th>地址</th><th style="text-align:right">操作</th></tr></thead><tbody>'
      + data.sources.map((s) => '<tr data-id="' + escapeHtml(s.id) + '"><td><span class="dl-row__logo" style="background:' + escapeHtml(s.color || '#7c5cff') + '">' + escapeHtml(s.icon || providerInitial(s.name)) + '</span></td>'
        + '<td><b class="small">' + escapeHtml(s.name) + '</b>' + (s.note ? '<div class="tiny muted truncate" style="max-width:280px">' + escapeHtml(s.note) + '</div>' : '') + '</td>'
        + '<td><span class="badge">' + escapeHtml(s.kind) + '</span></td>'
        + '<td><span class="src-mode">' + escapeHtml(s.mode) + '</span></td>'
        + '<td class="mono tiny truncate" style="max-width:300px;color:var(--text-mute)">' + escapeHtml(s.apiUrl || s.searchUrl || '本站资源库') + '</td>'
        + '<td style="text-align:right"><div class="row row--tight" style="justify-content:flex-end">'
        + '<label class="switch" title="启用/停用"><input type="checkbox" data-a="toggle"' + (s.enabled ? ' checked' : '') + ' /><span class="switch__track"></span></label>'
        + '<button class="icon-btn icon-btn--sm" data-a="test" title="测试">⚡</button><button class="icon-btn icon-btn--sm" data-a="edit" title="编辑">✎</button><button class="icon-btn icon-btn--sm" data-a="del" title="删除">×</button></div></td></tr>').join('')
      + '</tbody></table></div>';
    host.onclick = async (e) => {
      const tr = e.target.closest('tr[data-id]');
      const btn = e.target.closest('[data-a]');
      if (!tr || !btn) return;
      const id = tr.dataset.id;
      const s = data.sources.find((x) => x.id === id);
      const act = btn.dataset.a;
      if (act === 'toggle') {
        try { await Api.admin.saveSource(Object.assign({}, s, { enabled: btn.checked !== false && !btn.closest('label').querySelector('input').checked ? true : !s.enabled })); toast('已切换', 'ok', 1600); load(); await reloadBootstrap(); } catch (err) { toast(err.message, 'bad'); btn.querySelector('input').checked = s.enabled; }
      }
      if (act === 'edit') edit(s);
      if (act === 'del') {
        if (!(await confirmDialog({ title: '删除来源', text: '删除「' + s.name + '」后聚合搜索不再查询它。', okText: '删除', danger: true }))) return;
        try { await Api.admin.saveSource({ id: s.id, remove: true }); toast('已删除', 'ok'); load(); await reloadBootstrap(); } catch (err) { toast(err.message, 'bad'); }
      }
      if (act === 'test') {
        btn.disabled = true;
        const q = window.prompt('测试关键词', 'design') || 'design';
        try {
          const r = await Api.admin.testSource(id, q);
          const t = r.test;
          modal({
            title: '来源测试：' + s.name, size: 'modal--wide',
            sub: (t.ok ? '<b style="color:var(--green)">成功</b>' : '<b style="color:var(--red)">失败</b>') + ' · ' + t.ms + 'ms · ' + (t.items || []).length + ' 条结果' + (t.error ? ' · ' + escapeHtml(t.error) : ''),
            body: (t.jumpUrl ? '<div class="hint-strip" style="margin-bottom:12px"><span>↗</span><div class="mono tiny">' + escapeHtml(t.jumpUrl) + '</div></div>' : '')
              + '<div class="dl-list">' + (t.items || []).slice(0, 20).map((it) => '<div class="dl-row"><span class="dl-row__logo" style="background:' + escapeHtml(it.color || s.color || '#7c5cff') + '">' + escapeHtml(providerInitial(it.title || s.name)) + '</span><div class="grow"><div class="dl-row__name truncate">' + escapeHtml(it.title) + '</div><div class="dl-row__url truncate">' + escapeHtml(it.url) + '</div></div></div>').join('') + '</div>'
              + (!(t.items || []).length ? '<p class="muted small">没有返回条目：多数外部站点会屏蔽匿名抓取，此时请改用 <b>url</b> 跳转模式。</p>' : ''),
          });
        } catch (err) { toast('测试失败：' + err.message, 'bad'); }
        btn.disabled = false;
      }
    };
    reveal(main);
    rippleAll(main);
  }
  function edit(s) {
    const v = s || { id: '', name: '', kind: '其他', mode: 'api', enabled: true, color: '#7c5cff', icon: '◎', note: '', apiUrl: '', searchUrl: '', listPath: '', map: {} };
    const kinds = store.bootstrap.sourceKinds || ['网站', '综合', '网盘', '磁力', '影视', '音乐', '游戏', '图书', '素材', '文档', '图片', '学术', '其他'];
    const b = el(['<div style="display:grid;gap:12px">',
      '<div class="form-grid">',
      '<div class="field"><label>名称 <span class="req">*</span></label><input class="input" data-f="name" value="' + escapeHtml(v.name) + '" /></div>',
      '<div class="field"><label>标识 id</label><input class="input" data-f="id" value="' + escapeHtml(v.id) + '"' + (s ? ' disabled' : '') + ' placeholder="留空自动生成" /></div>',
      '<div class="field"><label>类别</label><div class="select-wrap"><select class="select" data-f="kind">' + kinds.map((k) => '<option' + (k === v.kind ? ' selected' : '') + '>' + escapeHtml(k) + '</option>').join('') + '</select></div></div>',
      '<div class="field"><label>模式</label><div class="select-wrap"><select class="select" data-f="mode">' + [['local', 'local · 本站'], ['api', 'api · JSON 接口'], ['xml', 'xml · RSS'], ['html', 'html · 抓取链接'], ['url', 'url · 跳转检索']].map(([k, n]) => '<option value="' + k + '"' + (k === v.mode ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div></div>',
      '<div class="field"><label>颜色</label><input class="input" type="color" data-f="color" value="' + escapeHtml(v.color || '#7c5cff') + '" style="height:44px;padding:4px" /></div>',
      '<div class="field"><label>图标</label><input class="input" maxlength="2" data-f="icon" value="' + escapeHtml(v.icon || '◎') + '" /></div>',
      '<div class="field span-2"><label>接口 / 跳转地址（含 {query} 占位）</label><input class="input mono" data-f="apiUrl" value="' + escapeHtml(v.apiUrl) + '" placeholder="https://api.example.com/search?q={query}" /></div>',
      '<div class="field span-2"><label>跳转检索地址（url 模式使用）</label><input class="input mono" data-f="searchUrl" value="' + escapeHtml(v.searchUrl) + '" placeholder="https://example.com/s?q={query}" /></div>',
      '<div class="field"><label>结果列表路径 listPath</label><input class="input mono" data-f="listPath" value="' + escapeHtml(v.listPath) + '" placeholder="data.items" /></div>',
      '<div class="field span-2"><label>备注</label><input class="input" data-f="note" value="' + escapeHtml(v.note) + '" /></div>',
      '<div class="field span-2"><label>字段映射 map（JSON：title / url / snippet / date / size / image）</label><textarea class="textarea mono" data-f="map" style="min-height:92px;font-size:12px">' + escapeHtml(JSON.stringify(v.map || {}, null, 2)) + '</textarea></div>',
      '<label class="switch"><input type="checkbox" data-f="enabled"' + (v.enabled ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">启用该来源</span></label>',
      '</div>',
      '<div class="hint-strip"><span>🧩</span><div class="tiny">api 模式示例：<span class="mono">map = {"title":"name","url":"html_url","snippet":"description","image":"owner.avatar_url"}</span>；xml 模式使用标准 &lt;item&gt;/&lt;entry&gt;；url 模式只需填 searchUrl。</div></div>',
      '<div class="row" style="gap:8px;justify-content:flex-end"><button class="btn btn--quiet" data-x>取消</button><button class="btn btn--primary" data-ok>' + (s ? '保存' : '创建') + '</button></div>',
      '</div>'].join(''));
    modal({
      title: s ? '编辑来源：' + v.name : '新增检索来源', size: 'modal--wide', body: b,
      onMount(node, close) {
        node.querySelector('[data-x]').onclick = close;
        node.querySelector('[data-ok]').onclick = async () => {
          const get = (k) => { const n = node.querySelector('[data-f="' + k + '"]'); return n.type === 'checkbox' ? n.checked : n.value.trim(); };
          let map = {};
          try { map = JSON.parse(get('map') || '{}'); } catch { return toast('map 不是合法 JSON', 'bad'); }
          if (!get('name')) return toast('请填写名称', 'warn');
          try {
            await Api.admin.saveSource({ id: get('id') || (s ? s.id : ''), name: get('name'), kind: get('kind'), mode: get('mode'), enabled: get('enabled'), color: get('color'), icon: get('icon'), note: get('note'), apiUrl: get('apiUrl'), searchUrl: get('searchUrl'), listPath: get('listPath'), map });
            toast('已保存来源', 'ok');
            close();
            load();
            await reloadBootstrap();
          } catch (err) { toast('保存失败：' + err.message, 'bad'); }
        };
      },
    });
  }
}

/* ---------- 媒体库 ---------- */
async function viewMedia(main) {
  main.innerHTML = head('媒体库', '所有导入与上传的图片，可复制到资源表单', '<button class="btn btn--sm btn--primary" id="upBtn">上传图片</button><input type="file" id="upFile" accept="image/*" multiple hidden />')
    + '<div id="mediaHost"></div>';
  await load();
  main.querySelector('#upBtn').onclick = () => main.querySelector('#upFile').click();
  main.querySelector('#upFile').onchange = async (e) => {
    for (const f of Array.from(e.target.files)) {
      try {
        const b64 = await readB64(f);
        const r = await Api.admin.upload({ name: f.name, base64: b64 });
        toast('已上传 ' + (r.name || ''), 'ok', 1800);
      } catch (err) { toast(f.name + ' 上传失败：' + err.message, 'bad'); }
    }
    load();
  };
  async function load() {
    const host = main.querySelector('#mediaHost');
    host.innerHTML = '<div class="admin-boot"><span class="spinner"></span></div>';
    const data = await guard(Api.admin.media(), host);
    host.innerHTML = '<div class="row row--wrap tiny mono muted" style="gap:10px;margin-bottom:12px"><span>共 ' + data.items.length + ' 个文件</span><span>占用 ' + fmtBytes(data.used) + '</span><span>上传上限 12MB / 个</span></div>';
    if (!data.items.length) { host.innerHTML += emptyState({ icon: '🖼', title: '媒体库为空', desc: '导入 Excel 时勾选「图片转存本地」会自动填充这里。' }); return; }
    const grid = el('<div class="media-grid"></div>');
    data.items.forEach((m) => {
      const cell = el('<div class="media-cell" data-url="' + escapeHtml(m.url) + '"><img src="' + escapeHtml(m.url) + '" alt="' + escapeHtml(m.name) + '" loading="lazy" /><span class="tiny mono">' + escapeHtml(m.name) + '</span><span class="row row--between tiny muted"><span>' + fmtBytes(m.size) + '</span><span>' + relTime(m.at) + '</span></span></div>');
      const acts = el('<div class="row row--tight" style="margin-top:6px"><button class="btn btn--sm btn--quiet" data-a="copy">复制地址</button><button class="btn btn--sm btn--quiet" data-a="open">查看</button><button class="btn btn--sm btn--danger" data-a="del">删除</button></div>');
      acts.onclick = async (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        if (b.dataset.a === 'copy') copy(location.origin + m.url, '地址已复制');
        if (b.dataset.a === 'open') window.open(m.url, '_blank');
        if (b.dataset.a === 'del') {
          if (!(await confirmDialog({ title: '删除文件', text: '删除 ' + m.name + '？引用它的资源图片会失效。', okText: '删除', danger: true }))) return;
          try { await Api.admin.deleteMedia(m.name); toast('已删除', 'ok'); load(); } catch (err) { toast(err.message, 'bad'); }
        }
      };
      cell.append(acts);
      cell.querySelector('img').onclick = () => openLightbox([{ url: m.url, caption: m.name }], 0);
      grid.append(cell);
    });
    host.append(grid);
    reveal(host);
    rippleAll(host);
  }
}
function readB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('读取失败'));
    fr.readAsDataURL(file);
  });
}

/* ---------- 日志 ---------- */
async function viewLogs(main) {
  let kind = '';
  main.innerHTML = head('操作日志', '导入、审核、登录、异常等全部留痕', '<div class="select-wrap" id="kindWrap"></div>') + '<div id="logHost"></div>';
  await load();
  async function load() {
    const data = await guard(Api.admin.logs(kind), main);
    const wrap = main.querySelector('#kindWrap');
    wrap.innerHTML = '<select class="select" id="kindSel">' + ['', ...data.kinds].map((k) => '<option value="' + escapeHtml(k) + '"' + (k === kind ? ' selected' : '') + '>' + (k ? escapeHtml(k) : '全部类别') + '</option>').join('') + '</select>';
    wrap.querySelector('#kindSel').onchange = (e) => { kind = e.target.value; load(); };
    const host = main.querySelector('#logHost');
    host.innerHTML = data.items.length ? '<div class="tl card card--pad">' + data.items.map((l) => logLine(l)).join('') + '</div>' : emptyState({ icon: '🕘', title: '暂无日志' });
    reveal(host);
  }
}

/* ---------- 站点设置 ---------- */
async function viewSettings(main) {
  const data = await guard(Api.admin.settings(), main);
  const s = data.settings;
  const F = [
    ['siteName', '站点名称', 'input'], ['tagline', '标语', 'input'], ['homeTitle', '首页主标题（第一行）', 'input'], ['homeSubtitle', '首页主标题（第二行）', 'input'],
    ['announcement', '首页公告', 'textarea'], ['footerNote', '页脚说明', 'input'], ['icp', '备案 / 版权信息', 'input'], ['accent', '主色', 'color'],
    ['pageSize', '列表每页数量', 'number'], ['defaultScore', '默认分数', 'number'], ['searchHints', '搜索提示词（逗号分隔）', 'input'],
  ];
  main.innerHTML = [
    head('站点设置', '对外文案、展示参数与开关', '<span class="mono tiny muted">口令修改在下方</span>'),
    '<div class="admin-cols">',
    '<div style="display:grid;gap:16px">',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>站点信息</h3></div><div class="form-grid">'
      + F.map(([k, label, kind]) => {
        const val = k === 'searchHints' ? (s[k] || []).join(', ') : s[k] == null ? '' : s[k];
        if (kind === 'textarea') return '<div class="field span-2"><label>' + label + '</label><textarea class="textarea" data-s="' + k + '">' + escapeHtml(val) + '</textarea></div>';
        if (kind === 'color') return '<div class="field"><label>' + label + '</label><input class="input" type="color" data-s="' + k + '" value="' + escapeHtml(val || '#7c5cff') + '" style="height:44px;padding:4px" /></div>';
        return '<div class="field"><label>' + label + '</label><input class="input" type="' + (kind === 'number' ? 'number' : 'text') + '" data-s="' + k + '" value="' + escapeHtml(val) + '" /></div>';
      }).join('')
      + '</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn--primary" id="saveSet">保存设置</button></div></div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>危险操作</h3></div><div class="row row--wrap" style="gap:8px"><button class="btn btn--sm btn--quiet" data-m="recount">重算统计与索引</button><button class="btn btn--sm btn--quiet" data-m="dedupe">按标题去重合并</button><button class="btn btn--sm btn--quiet" data-m="check-all">检测全部链接</button><button class="btn btn--sm btn--danger" data-m="clear-logs">清空日志</button></div><p class="tiny muted" style="margin-top:10px">去重合并会把同名资源的下载与来源合并，并保留信息更完整的一条。</p></div>',
    '</div>',
    '<div style="display:grid;gap:16px">',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>采集与提交</h3></div>'
      + '<label class="switch" style="margin-bottom:12px"><input type="checkbox" data-b="allowUserSubmit"' + (s.allowUserSubmit ? ' checked' : '') + ' /><span class="switch__track"></span><span><b style="font-size:13.5px">开放前台投稿</b><br /><span class="tiny muted">关闭后前台提交按钮不可用</span></span></label>'
      + '<label class="switch" style="margin-bottom:12px"><input type="checkbox" data-b="requireReview"' + (s.requireReview ? ' checked' : '') + ' /><span class="switch__track"></span><span><b style="font-size:13.5px">投稿需审核</b><br /><span class="tiny muted">关闭则直接发布入库</span></span></label>'
      + '<label class="switch"><input type="checkbox" data-b="mirrorImagesByDefault"' + (s.mirrorImagesByDefault ? ' checked' : '') + ' /><span class="switch__track"></span><span><b style="font-size:13.5px">默认转存外链图片</b><br /><span class="tiny muted">避免防盗链与图片失效</span></span></label>'
      + '<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn btn--primary" id="saveSet2">保存开关</button></div></div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>修改管理员口令</h3></div><div style="display:grid;gap:12px"><div class="field"><label>当前口令</label><input class="input" type="password" id="oldPass" autocomplete="current-password" /></div><div class="field"><label>新口令（≥ 6 位）</label><input class="input" type="password" id="newPass" autocomplete="new-password" /></div><div class="field"><label>确认新口令</label><input class="input" type="password" id="newPass2" autocomplete="new-password" /></div><button class="btn btn--danger" id="savePass" style="justify-self:flex-end">修改口令</button></div></div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>账号</h3></div><div class="kv"><dt>登录名</dt><dd>' + escapeHtml(data.admin.user) + '</dd><dt>当前会话</dt><dd class="mono tiny">' + escapeHtml(data.admin.session || '—') + '</dd><dt>口令状态</dt><dd>' + (data.admin.hasDefaultSecret ? '<span class="badge badge--warn">仍是默认口令</span>' : '<span class="badge badge--ok">已自定义</span>') + '</dd></div></div>',
    '</div>',
    '</div>',
  ].join('');
  main.querySelector('#saveSet').onclick = () => saveSettings(main);
  main.querySelector('#saveSet2').onclick = () => saveSettings(main);
  main.querySelector('#savePass').onclick = async () => {
    const old = main.querySelector('#oldPass').value;
    const p1 = main.querySelector('#newPass').value;
    const p2 = main.querySelector('#newPass2').value;
    if (p1.length < 6) return toast('新口令至少 6 位', 'warn');
    if (p1 !== p2) return toast('两次输入不一致', 'bad');
    try { const r = await api('POST', '/api/admin/password', { old, pass: p1 }); toast(r.message || '口令已更新', 'ok'); main.querySelector('#oldPass').value = ''; main.querySelector('#newPass').value = ''; main.querySelector('#newPass2').value = ''; } catch (err) { toast(err.message, 'bad'); }
  };
  Array.from(main.querySelectorAll('[data-m]')).forEach((b) => {
    b.onclick = async () => {
      const action = b.dataset.m;
      if (action === 'clear-logs' && !(await confirmDialog({ title: '清空日志', text: '将删除全部操作日志记录。', okText: '清空', danger: true }))) return;
      b.disabled = true;
      const label = b.textContent;
      b.textContent = '执行中…';
      try { const r = await Api.admin.maintenance({ action }); toast(r.message || '完成', 'ok', 4200); } catch (err) { toast(err.message, 'bad'); }
      b.disabled = false;
      b.textContent = label;
    };
  });
  reveal(main);
  rippleAll(main);
}
async function saveSettings(main) {
  const payload = {};
  Array.from(main.querySelectorAll('[data-s]')).forEach((n) => {
    let v = n.value.trim();
    if (n.dataset.s === 'pageSize') v = Math.max(4, Math.min(96, Number(v) || 24));
    if (n.dataset.s === 'defaultScore') v = Math.max(0, Math.min(10, Number(v) || 0));
    if (n.dataset.s === 'searchHints') v = String(v).split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    payload[n.dataset.s] = v;
  });
  Array.from(main.querySelectorAll('[data-b]')).forEach((n) => { payload[n.dataset.b] = !!n.checked; });
  try {
    const r = await Api.admin.patchSettings(payload);
    toast(r.message || '设置已保存', 'ok');
    await reloadBootstrap();
  } catch (err) { toast('保存失败：' + err.message, 'bad'); }
}

/* ---------- 数据备份 ---------- */
async function viewBackup(main) {
  main.innerHTML = [
    head('数据备份', '整库 JSON 导出 / 导入，用于迁移与还原'),
    '<div class="admin-cols">',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>导出</h3></div><p class="small dim">导出内容包含资源、投稿、分类、来源与设置（不含图片文件本体）。</p><a class="btn btn--primary" href="/api/admin/export" style="margin-top:12px">⬇ 下载整库备份</a></div>',
    '<div class="card card--pad" data-reveal><div class="panel-h"><h3>导入还原</h3></div><div class="field"><label>选择备份文件（.json）</label><input type="file" id="bkFile" accept=".json,application/json" class="input" /></div><div class="field" style="margin-top:12px"><label>模式</label><div class="select-wrap"><select class="select" id="bkMode"><option value="merge">merge · 合并（按 id / 标题去重）</option><option value="replace">replace · 整库替换</option></select></div></div><button class="btn btn--danger" id="bkGo" style="margin-top:14px">上传并还原</button><p class="tiny muted" style="margin-top:10px">replace 会覆盖现有全部资源，建议先导出一份当前备份。</p></div>',
    '</div>',
  ].join('');
  let db = null;
  main.querySelector('#bkFile').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try { db = JSON.parse(String(fr.result)); toast('已读取备份：' + ((db.resources || []).length) + ' 条资源', 'ok'); } catch (err) { db = null; toast('不是合法 JSON', 'bad'); }
    };
    fr.readAsText(f);
  };
  main.querySelector('#bkGo').onclick = async () => {
    if (!db) return toast('先选择备份文件', 'warn');
    const mode = main.querySelector('#bkMode').value;
    if (mode === 'replace' && !(await confirmDialog({ title: '整库替换', text: '将用备份覆盖当前全部数据（' + ((db.resources || []).length) + ' 条资源），无法撤销。确定继续？', okText: '确认覆盖', danger: true }))) return;
    const btn = main.querySelector('#bkGo');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/admin/restore', { db, mode });
      toast(r.message || '还原完成', 'ok', 4600);
      await reloadBootstrap();
      route();
    } catch (err) { toast('还原失败：' + err.message, 'bad'); }
    btn.disabled = false;
  };
  reveal(main);
  rippleAll(main);
}

boot();

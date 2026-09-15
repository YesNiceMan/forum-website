/* 首页 / 发现 */
import { $, el, escapeHtml, Api, store, skeletonGrid, reveal, countUp, navigate, toast, openLightbox, imgSrc, emptyState } from '../core.js';
import { resourceCard, typeBadge } from '../ui.js';

export async function home(host) {
  const b = store.bootstrap;
  host.innerHTML = [
    '<section class="hero shell">',
    '<div class="hero__inner">',
    '<div class="hero__copy">',
    '<div class="hero__badges" data-reveal>',
    '<span class="badge badge--live"><i class="dot"></i>实时聚合 ' + b.stats.sources + ' 个检索来源</span>',
    '<span class="badge badge--brand">Excel 批量导入</span>',
    '<span class="badge">链接图文自动识别</span>',
    '</div>',
    '<h1 class="hero__title" data-reveal><span class="line"><span>' + escapeHtml(b.settings.homeTitle || '把散落各处的') + '</span></span><span class="line"><span class="grad-text">' + escapeHtml(b.settings.homeSubtitle || '好资源，一次收藏') + '</span></span></h1>',
    '<p class="hero__lede" data-reveal>' + escapeHtml(b.settings.tagline || '') + ' · 上传一份 Excel，系统会自动读取表格里每一条链接，抓回它们页面上的标题、正文与图片，缺的信息在弹窗里补全后一键入库。</p>',
    '<form class="search-hero" data-reveal id="heroSearch">',
    '<div class="search-hero__box">',
    '<svg viewBox="0 0 24 24" class="icon" style="color:var(--text-mute)"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5.5 13.5L20 21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    '<input id="heroInput" placeholder="输入标题 / 名字，回车同时搜遍网盘、网站与磁力" autocomplete="off" />' +
    '<button class="btn btn--primary btn--lg" type="submit">开始检索</button>',
    '</div>',
    '<div class="search-hero__hint"><span>试试：</span>' + (b.settings.searchHints || []).map((h) => '<button type="button" class="chip" data-q="' + escapeHtml(h) + '">' + escapeHtml(h) + '</button>').join('') + '<span class="grow"></span><span class="mono tiny muted">共 ' + b.stats.resources + ' 条站内资源</span></div>',
    '</form>',
    '<div class="hero__stats" data-reveal>',
    stat('站内资源', b.stats.resources, '条'),
    stat('下载直链', b.stats.downloads, '个'),
    stat('已抓图片', b.stats.images, '张'),
    stat('检索来源', b.stats.sources + b.stats.jump, '个'),
    '</div>',
    '</div>',
    '<div class="collage" data-reveal="blur">' + collage(b) + '</div>',
    '</div>',
    '</section>',
    '<div class="marquee" data-reveal><div class="marquee__track" id="tagMarquee"></div></div>',
    '<section class="shell section--tight" id="featuredSec">',
    '<div class="sec-head"><div><span class="eyebrow">Featured</span><h2>编辑精选</h2><p>由管理员标记的高质量资源，信息完整度均在 80% 以上。</p></div><a class="btn btn--quiet btn--sm" href="#/library?sort=score">按分数浏览 →</a></div>',
    '<div class="grid grid--wide" id="featuredGrid"></div>',
    '</section>',
    '<section class="shell section--tight">',
    '<div class="sec-head"><div><span class="eyebrow">Workflow</span><h2>两条入库路径</h2><p>批量走导入中心，单条走投稿补全，都会进入同一套完整度诊断。</p></div></div>',
    '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">',
    workflowCard('📈', 'Excel 导入中心', ['上传 .xlsx / .csv，自动识别表头并映射到「标题 / 类型 / 标签 / 分数 / 简介 / 内容 / 下载 / 其他来源」', '扫描每行链接，抓取页面文字与图片，缺项自动补全', '补全结果在弹窗内逐条勾选，支持全部导入或勾选导入'], '<a class="btn btn--primary btn--sm" href="#/import">进入导入中心</a>'),
    workflowCard('✍️', '手动添加 / 投稿', ['粘贴一段推广文案，自动拆出标题、链接、提取码、图片与标签', '信息不全时提交为待审投稿，管理员在后台补全后入库', '支持网盘、磁力、ed2k、迅雷、直链等类型自动分类'], '<a class="btn btn--quiet btn--sm" href="#/submit">去添加一条</a>'),
    workflowCard('🛰', '聚合搜索', ['输入名字，同时查询本站 + 网盘 / 网站 / 磁力来源', '对无法服务端抓取的站点提供跳转检索，结果可一键收藏进资源库', '检索结果可直接「补全入库」，形成资源闭环'], '<a class="btn btn--quiet btn--sm" href="#/search">试一次聚合搜索</a>'),
    '</div>',
    '</section>',
    '<section class="shell section--tight" id="latestSec">',
    '<div class="sec-head"><div><span class="eyebrow">Latest</span><h2>最新入库</h2></div><div class="tabs" id="latestTabs"><button class="is-on" data-sort="newest">最新</button><button data-sort="views">最热</button><button data-sort="score">高分</button></div></div>',
    '<div class="grid" id="latestGrid"></div>',
    '</section>',
  ].join('');

  bindHeroSearch(host, b);
  fillTagMarquee(host, b);
  loadFeatured(host);
  loadLatest(host, 'newest');
}

function stat(label, value, unit) {
  return '<div class="stat"><b data-count="' + Number(value || 0) + '">0</b><span>' + escapeHtml(label) + ' <em style="font-style:normal;opacity:.6" class="mono tiny">' + escapeHtml(unit || '') + '</em></span></div>';
}

function collage(b) {
  const featured = (b.spotlight || []).slice(0, 3);
  const cards = featured.length ? featured : [{ id: '-', title: '等待导入', cover: '', type: '' }];
  const html = ['<span class="collage__glow"></span>'];
  cards.forEach((r, i) => {
    html.push('<a class="collage__item collage__item--' + (i + 1) + '" href="#/resource/' + r.id + '" title="' + escapeHtml(r.title) + '">' + (r.cover ? '<img src="' + imgSrc(r.cover, r.title) + '" alt="' + escapeHtml(r.title) + '" />' : '<div class="rcard__noimg" style="height:100%">+</div>') + '</a>');
  });
  html.push('<span class="collage__badge"><i class="dot" style="color:var(--cyan)"></i>自动抓取图文 · ' + (b.stats.images || 0) + ' 张</span>');
  return html.join('');
}

function workflowCard(icon, title, bullets, cta) {
  return '<div class="card card--pad card--hover" data-reveal><div class="row" style="gap:12px;margin-bottom:10px"><span style="font-size:26px">' + icon + '</span><h3>' + escapeHtml(title) + '</h3></div><ul style="display:grid;gap:9px;margin:0 0 16px;padding:0;list-style:none">' + bullets.map((t) => '<li class="row" style="align-items:flex-start;gap:9px;font-size:13.4px;color:var(--text-dim)"><i style="margin-top:7px;width:5px;height:5px;border-radius:50%;background:var(--cyan);flex:none"></i><span>' + escapeHtml(t) + '</span></li>').join('') + '</ul>' + cta + '</div>';
}

function bindHeroSearch(host, b) {
  const form = host.querySelector('#heroSearch');
  const input = host.querySelector('#heroInput');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) { toast('先输入一个标题或名字'); input.focus(); return; }
    navigate('/search?q=' + encodeURIComponent(q));
  });
  host.querySelectorAll('[data-q]').forEach((chip) => chip.addEventListener('click', () => { input.value = chip.dataset.q; navigate('/search?q=' + encodeURIComponent(chip.dataset.q)); }));
}

function fillTagMarquee(host, b) {
  const track = host.querySelector('#tagMarquee');
  const tags = (b.tags || []).slice(0, 30);
  if (!tags.length) { track.closest('.marquee').remove(); return; }
  const one = tags.map((t) => '<a class="chip chip--static chip--tag" href="#/library?tag=' + encodeURIComponent(t.name) + '" style="--tc:' + escapeHtml(t.color || '#7c5cff') + '">' + escapeHtml(t.name) + '<b class="mono tiny muted">' + (t.count || 0) + '</b></a>').join('');
  track.innerHTML = one + one;
}

async function loadFeatured(host) {
  const grid = host.querySelector('#featuredGrid');
  grid.append(skeletonGrid(3, true));
  try {
    const res = await Api.resources({ sort: 'score', pageSize: 6 });
    const items = res.items.filter((r) => r.featured).concat(res.items.filter((r) => !r.featured)).slice(0, 3);
    grid.innerHTML = '';
    if (!items.length) { grid.innerHTML = emptyState({ title: '还没有精选资源', desc: '在后台勾选「精选」即可出现在这里。' }); return; }
    items.forEach((r) => grid.append(resourceCard(r)));
    reveal(grid);
  } catch (err) { grid.innerHTML = emptyState({ icon: '⚠️', title: '加载失败', desc: escapeHtml(err.message) }); }
}

async function loadLatest(host, sort) {
  const grid = host.querySelector('#latestGrid');
  grid.replaceChildren(skeletonGrid(8));
  try {
    const res = await Api.resources({ sort, pageSize: 8 });
    grid.innerHTML = '';
    if (!res.items.length) { grid.innerHTML = emptyState({ title: '资源库还是空的', desc: '上传一份 Excel 或手动添加一条资源开始使用。', action: '<a class="btn btn--primary btn--sm" href="#/import">导入 Excel</a><a class="btn btn--quiet btn--sm" href="#/submit">手动添加</a>' }); return; }
    res.items.forEach((r) => grid.append(resourceCard(r)));
    reveal(grid);
  } catch (err) { grid.innerHTML = emptyState({ icon: '⚠️', title: '加载失败', desc: escapeHtml(err.message) }); }
}

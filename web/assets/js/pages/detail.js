/* 资源详情页：标题 / 类型 / 标签 / 分数 / 简介 / 内容+图片 / 资源下载 / 其他来源 */
import { $, el, escapeHtml, Api, store, navigate, toast, reveal, rippleAll, fmtScore, fmtDate, relTime, imgSrc, copy, copyLink, openLink, Prefs, modal, emptyState, tilt, mdLite, reduceMotion, openLightbox } from '../core.js';
import { typeBadge, linkRow, galleryGrid, scoreRing, animateRing } from '../ui.js';

export async function detail(host, ctx) {
  const id = ctx.params.id;
  host.innerHTML = '<div class="shell section--tight"><div class="card card--pad" style="height:340px" data-reveal><div class="skeleton" style="height:100%;border-radius:18px"></div></div></div>';
  let data;
  try {
    data = await Api.resource(id);
  } catch (err) {
    host.innerHTML = '';
    host.append(el(emptyState({ icon: '🧊', title: '资源不存在或已下架', desc: escapeHtml(err.message || '') , action: '<a class="btn btn--primary btn--sm" href="#/library">返回资源库</a>' })));
    return;
  }
  const r = data.resource;
  Prefs.remember(r.title);
  document.title = r.title + ' · AURORA 资源库';
  const gallery = (r.gallery || []).slice();
  const images = (r.cover ? [{ url: r.cover, caption: '封面' }].concat(gallery) : gallery).filter((g, i, arr) => arr.findIndex((x) => x.url === g.url) === i);
  const fav = Prefs.isFav(r.id);

  host.innerHTML = [
    '<div class="shell" style="padding-top:22px;padding-bottom:10px"><nav class="row tiny mono muted" style="gap:8px;flex-wrap:wrap" aria-label="面包屑"><a href="#/" class="link-quiet">发现</a><span>/</span><a href="#/library" class="link-quiet">资源库</a><span>/</span><a href="#/library?type=' + encodeURIComponent(r.type) + '" class="link-quiet">' + escapeHtml(r.type || '未分类') + '</a><span>/</span><span style="color:var(--text-dim)">' + escapeHtml(r.title.slice(0, 24)) + (r.title.length > 24 ? '…' : '') + '</span></nav></div>',
    '<section class="shell detail">',
    '<div class="detail__main">',
    '<div class="hero-band" data-reveal>',
    '<div class="hero-band__bg">' + (images[0] ? '<img src="' + imgSrc(images[0].url, r.title) + '" alt="" />' : '') + '</div>',
    '<div class="hero-band__mask"></div>',
    '<div class="hero-band__inner">',
    '<div class="hero-band__cover">' + (r.cover ? '<img src="' + imgSrc(r.cover, r.title) + '" alt="' + escapeHtml(r.title) + ' 封面" />' : '<div class="rcard__noimg" style="height:100%">' + escapeHtml(r.title.slice(0, 2)) + '</div>') + '</div>',
    '<div class="hero-band__info">',
    '<div class="row row--wrap" style="gap:8px;margin-bottom:10px">' + typeBadge(r.type) + (r.featured ? '<span class="badge badge--brand">编辑精选</span>' : '') + (r.meta && r.meta.year ? '<span class="badge">' + escapeHtml(r.meta.year) + '</span>' : '') + (r.quality ? '<span class="badge">' + escapeHtml(r.quality) + '</span>' : '') + '</div>',
    '<h1>' + escapeHtml(r.title) + '</h1>',
    (r.altTitles && r.altTitles.length ? '<p class="tiny muted" style="margin:6px 0 0">别名：' + r.altTitles.map(escapeHtml).join(' / ') + '</p>' : ''),
    '<div class="tiny mono muted" style="margin:14px 0 5px;letter-spacing:.18em">简介 SUMMARY</div>',
    '<p class="dim" style="margin:0;max-width:72ch;font-size:14.5px">' + (r.summary ? escapeHtml(r.summary) : '<span class="muted">该资源还没有简介：点右上「找更多来源」，在结果里点一下「¶ 简介」小块就能直接插到这里。</span>') + '</p>',
    '<div class="row row--wrap" style="gap:8px;margin-top:14px">' + (r.tags || []).map((t) => '<a class="tag" href="#/library?tag=' + encodeURIComponent(t) + '">#' + escapeHtml(t) + '</a>').join('') + '</div>',
    '<div class="row row--wrap" style="gap:10px;margin-top:20px">',
    '<button class="btn btn--primary" id="topDownload"><svg viewBox="0 0 24 24" class="icon"><path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>查看下载</button>',
    '<button class="btn btn--quiet" id="copyAll">复制全部链接</button>',
    '<button class="btn btn--quiet" id="favBtn">' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>',
    '<button class="btn btn--quiet" id="searchMore">找更多来源</button>',
    '</div>',
    '</div>',
    scoreRing(r.score, r.votes),
    '</div>',
    '</div>',
    '<div class="card card--pad" style="margin-top:18px" data-reveal id="contentCard">',
    '<div class="row row--between" style="margin-bottom:14px"><div class="tabs" id="detailTabs"><button class="is-on" data-tab="content">内容 / 图文</button><button data-tab="gallery">图集 ' + (images.length ? '(' + images.length + ')' : '') + '</button><button data-tab="downloads">资源下载 ' + (r.downloads.length ? '(' + r.downloads.length + ')' : '') + '</button><button data-tab="others">其他来源 ' + (r.others.length ? '(' + r.others.length + ')' : '') + '</button></div><span class="tiny mono muted">更新时间 ' + relTime(r.updatedAt) + '</span></div>',
    '<div class="tab-panel is-on" data-panel="content">' + (r.content ? '<div class="prose">' + r.content + '</div>' : '<p class="muted">暂无正文内容。</p>') + (r.notes ? '<div class="divider"></div><p class="small dim">' + escapeHtml(r.notes) + '</p>' : '') + '</div>',
    '<div class="tab-panel" data-panel="gallery"><div id="galleryHost"></div></div>',
    '<div class="tab-panel" data-panel="downloads"><div class="dl-list" id="downloadHost"></div><div id="dlEmpty"></div></div>',
    '<div class="tab-panel" data-panel="others"><div class="dl-list" id="otherHost"></div><div id="otherEmpty"></div></div>',
    '</div>',
    '<div class="card card--pad" style="margin-top:18px" data-reveal id="relatedCard"></div>',
    '</div>',
    '<aside class="detail__side">',
    '<div class="card card--pad" data-reveal><div class="row row--between" style="margin-bottom:14px"><h3 style="font-size:16px">资源信息</h3><span class="tiny mono muted">#' + escapeHtml(r.id.slice(0, 10)) + '</span></div>',
    '<dl class="meta-list">',
    metaRow('类型', r.type),
    metaRow('标签', (r.tags || []).join(' / ') || '—'),
    metaRow('分数', fmtScore(r.score) + ' / 10（' + (r.votes || 0) + ' 人评）', 'scoreMeta'),
    metaRow('年份', r.meta && r.meta.year),
    metaRow('地区 / 语言', [r.meta && r.meta.region, r.meta && r.meta.language].filter(Boolean).join(' · ')),
    metaRow('格式 / 版本', r.meta && r.meta.format),
    metaRow('体积', r.meta && r.meta.size),
    metaRow('时长 / 集数', r.meta && r.meta.duration),
    metaRow('作者 / 制作', r.meta && (r.meta.developer || r.meta.publisher)),
    metaRow('浏览量', r.views || 0),
    metaRow('收藏量', r.favorites || 0, 'favCount'),
    metaRow('入库时间', fmtDate(r.createdAt)),
    '</dl>',
    (r.sourceUrl ? '<div class="divider"></div><a class="row tiny" style="gap:6px;color:var(--cyan)" href="' + escapeHtml(r.sourceUrl) + '" target="_blank" rel="noopener nofollow">↗ 查看来源页' + (r.sourceName ? '（' + escapeHtml(r.sourceName) + '）' : '') + '</a>' : ''),
    '</div>',
    '<div class="card card--pad" data-reveal><h3 style="font-size:15px;margin-bottom:10px">打个分</h3><div id="rateHost"></div><p class="tiny muted" style="margin:10px 0 0">当前平均 ' + fmtScore(r.score) + ' 分；同一浏览器只计一票，再点其他星级即为修改评分。</p></div>',
    '<div class="card card--pad" data-reveal><h3 style="font-size:15px;margin-bottom:10px">快捷复制</h3><div style="display:grid;gap:8px" id="quickHost"></div></div>',
    '</aside>',
    '</section>',
  ].join('');

  /* 图集 */
  const galHost = host.querySelector('#galleryHost');
  galHost.append(images.length ? galleryGrid(images) : el('<p class="muted">该资源暂无图片。导入时若来源页有图片，会自动抓取到这里。</p>'));

  /* 下载 / 来源 */
  const dlHost = host.querySelector('#downloadHost');
  if (r.downloads.length) r.downloads.forEach((l) => dlHost.append(linkRow(l, 'download')));
  else host.querySelector('#dlEmpty').innerHTML = '<div class="hint-strip warn-strip">未识别到可用下载地址。点<a class="link-quiet" href="#/search?q=' + encodeURIComponent(r.title) + '&id=' + r.id + '">找更多来源</a>，在搜索结果里点一下网盘 / 磁力链接就能插进这里；也可以在后台「批量补全空白」。</div>';
  const otHost = host.querySelector('#otherHost');
  if (r.others.length) r.others.forEach((l) => otHost.append(linkRow(l, 'other')));
  else host.querySelector('#otherEmpty').innerHTML = '<div class="hint-strip">暂无其他来源。<a class="link-quiet" href="#/search?q=' + encodeURIComponent(r.title) + '&id=' + r.id + '">找更多来源</a> 里点结果下方的「⛓ 其他来源」小块即可写入。</div>';

  /* 相关推荐 */
  const rel = host.querySelector('#relatedCard');
  if (data.related && data.related.length) {
    rel.innerHTML = '<h3 style="font-size:16px;margin-bottom:12px">同类推荐</h3><div style="display:grid;gap:8px">' + data.related.map((x) => '<a class="dl-row" href="#/resource/' + x.id + '"><span class="dl-row__logo dl-row__logo--rel">' + escapeHtml(x.title.slice(0, 2)) + '</span><div class="grow"><div class="dl-row__name truncate">' + escapeHtml(x.title) + '</div><div class="dl-row__url">' + escapeHtml(x.type) + ' · ' + x.tags.join(' / ') + '</div></div><span class="badge badge--ok">★ ' + fmtScore(x.score) + '</span></a>').join('') + '</div>';
  } else rel.remove();

  /* tabs */
  const tabs = host.querySelector('#detailTabs');
  tabs.onclick = (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    Array.from(tabs.children).forEach((b) => b.classList.toggle('is-on', b === btn));
    Array.from(host.querySelectorAll('[data-panel]')).forEach((p) => p.classList.toggle('is-on', p.dataset.panel === btn.dataset.tab));
  };
  if (ctx.query.tab) { const t = tabs.querySelector('[data-tab="' + ctx.query.tab + '"]'); if (t) t.click(); }

  /* 行为 */
  host.querySelector('#topDownload').onclick = () => {
    tabs.querySelector('[data-tab="downloads"]').click();
    host.querySelector('#contentCard').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  };
  host.querySelector('#copyAll').onclick = () => {
    const txt = r.downloads.map((d) => d.label + '：' + d.url + (d.code ? ' 提取码 ' + d.code : '')).join('\n');
    if (!txt) return toast('暂无可复制的链接', 'warn');
    copy(txt, '已复制 ' + r.downloads.length + ' 条下载链接');
  };
  const favBtn = host.querySelector('#favBtn');
  const syncFav = (on) => { favBtn.textContent = on ? '★ 已收藏' : '☆ 收藏'; };
  syncFav(Prefs.isFav(r.id) || !!r.liked);
  favBtn.onclick = (e) => {
    const on = Prefs.toggleFav({ id: r.id, title: r.title, cover: r.cover, type: r.type });
    syncFav(on);
    toast(on ? '已加入收藏（保存在本机）' : '已移出收藏', on ? 'ok' : 'info');
    // 收藏数同步到服务端（幂等开关，重复点不会一直 +1）
    Api.favorite(r.id, on).then((res) => {
      const span = host.querySelector('#favCount');
      if (span && res.resource) span.textContent = res.resource.favorites;
    }).catch(() => {});
  };
  host.querySelector('#searchMore').onclick = () => navigate('/search?q=' + encodeURIComponent(r.title) + '&id=' + r.id);

  /* 评分 */
  const rateHost = host.querySelector('#rateHost');
  renderRating(rateHost, r);

  /* 快捷复制 */
  const quick = host.querySelector('#quickHost');
  const items = [
    { label: '标题', value: r.title },
    { label: '分享链接', value: location.origin + '/#/resource/' + r.id },
  ].concat(r.downloads.slice(0, 4).map((d) => ({ label: d.label || d.provider, value: d.url + (d.code ? ' 提取码 ' + d.code : '') })));
  items.forEach((it) => {
    const b = el('<button class="btn btn--quiet btn--sm btn--block" style="justify-content:flex-start;gap:8px"><span class="mono tiny muted" style="width:58px;text-align:left;flex:none">' + escapeHtml(it.label) + '</span><span class="truncate grow" style="text-align:left">' + escapeHtml(it.value) + '</span></button>');
    b.onclick = () => copy(it.value, it.label + ' 已复制');
    quick.append(b);
  });

  animateRing(host);
  reveal(host);
  rippleAll(host);
  if (ctx.query.autoscroll) host.querySelector('#contentCard').scrollIntoView({ block: 'start' });
}

function metaRow(label, value, id) {
  if (!value && value !== 0) return '';
  return '<dt>' + escapeHtml(label) + '</dt><dd' + (id ? ' id="' + id + '"' : '') + '>' + escapeHtml(String(value)) + '</dd>';
}

function renderRating(host, r) {
  const myKey = 'aurora.rate.' + r.id;
  // 以服务端记录为准（换设备 / 清缓存也能认出来），本地留一份只作离线兜底
  let my = Number(r.myScore) || Number(localStorage.getItem(myKey)) || 0;
  let busy = false;
  const stars = 10;
  host.innerHTML = [
    '<div class="row" style="gap:4px" id="starRow">',
    Array.from({ length: stars }, (_, i) => '<button class="star' + (i < (my || 0) ? ' is-on' : '') + '" data-i="' + (i + 1) + '" type="button" title="打 ' + (i + 1) + ' 分" aria-label="打 ' + (i + 1) + ' 分">' + (i < (my || 0) ? '★' : '☆') + '</button>').join(''),
    '</div>',
    '<div class="row" style="margin-top:10px"><span class="tiny muted" id="rateHint">' + (my ? '你给了 ' + my + ' 分 · 点其他星级可改分' : '点按 10 分制打分') + '</span><span class="grow"></span><span class="mono tiny muted" id="rateVotes">' + (r.votes || 0) + ' 人</span></div>',
  ].join('');
  const row = host.querySelector('#starRow');
  const paint = (n, active) => Array.from(row.children).forEach((s, i) => {
    s.textContent = i < n ? '★' : '☆';
    s.classList.toggle('is-on', i < n);
    s.classList.toggle('is-preview', active && i < n);
  });
  row.addEventListener('pointerover', (e) => { const b = e.target.closest('.star'); if (b) paint(Number(b.dataset.i), true); });
  row.addEventListener('pointerleave', () => paint(my || 0, false));
  const syncScore = (score, votes) => {
    const ring = document.querySelector('.score-ring b');
    if (ring) { ring.textContent = fmtScore(score); ring.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.28)' }, { transform: 'scale(1)' }], { duration: 620, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
    const votesEl = host.querySelector('#rateVotes');
    if (votesEl) votesEl.textContent = (votes || 0) + ' 人';
    const meta = document.getElementById('scoreMeta');
    if (meta) meta.textContent = fmtScore(score) + ' / 10（' + (votes || 0) + ' 人评）';
  };
  if (my) paint(my, false);
  row.onclick = async (e) => {
    const b = e.target.closest('.star');
    if (!b || busy) return;
    const score = Number(b.dataset.i);
    if (score === my) {
      toast('你已经给过 ' + score + ' 分了，改个星级就能修改，不会重复计分', 'info', 3400);
      return;
    }
    busy = true;
    row.classList.add('is-busy');
    try {
      const res = await Api.rate(r.id, score);
      const next = res.resource || {};
      my = Number(res.myScore) || score;
      localStorage.setItem(myKey, String(my));
      paint(my, false);
      host.querySelector('#rateHint').textContent = '你给了 ' + my + ' 分 · 平均分 ' + fmtScore(next.score) + (res.mode === 'update' ? '（已改分）' : '');
      syncScore(next.score, next.votes);
      toast(res.message || (res.mode === 'update' ? '已更新你的评分' : '评分成功'), res.mode === 'same' ? 'info' : 'ok', 2600);
    } catch (err) {
      toast('评分失败：' + (err.message || '服务异常'), 'bad', 3600);
      paint(my || 0, false);
    } finally {
      busy = false;
      row.classList.remove('is-busy');
    }
  };
}

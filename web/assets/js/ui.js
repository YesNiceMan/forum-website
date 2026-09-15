/* 共用视图组件 */
import { escapeHtml, imgSrc, fmtScore, relTime, providerChips, providerInitial, store, openLightbox, copy, copyLink, openLink, tilt, navigate, Prefs, toast } from './core.js';

export function typeBadge(type) {
  const t = ((store.bootstrap && store.bootstrap.types) || []).find((x) => x.key === type) || { color: '#94a3b8', icon: '⊙', name: type || '未分类' };
  /* 颜色只给 --tc，底色/文字色交给 CSS 推导：徽章既要贴在封面上、也要出现在浅色后台表格里，
     内联写死的浅色文字在浅色模式会直接糊掉 */
  const tc = escapeHtml(t.color);
  return '<span class="badge rcard__type" style="--tc:' + tc + '"><i class="dot" style="color:' + tc + '"></i>' + escapeHtml(t.name) + '</span>';
}

export function resourceCard(r) {
  const fav = Prefs.isFav(r.id);
  const cover = r.cover || (r.gallery && r.gallery[0] && r.gallery[0].url) || '';
  const pct = r.completeness ? r.completeness.percent : null;
  const links = (r.downloads || []).concat(r.others || []);
  const href = '#/resource/' + r.id;
  const node = document.createElement('article');
  node.className = 'rcard card--hover';
  node.dataset.reveal = '';
  node.dataset.id = r.id;
  node.innerHTML = [
    '<div class="rcard__media">',
    cover
      ? '<img src="' + imgSrc(cover, r.title) + '" alt="' + escapeHtml(r.title) + '" loading="lazy" decoding="async" data-fallback="' + escapeHtml(providerInitial(r.title)) + '" />'
      : '<div class="rcard__noimg">' + escapeHtml(providerInitial(r.title)) + '</div>',
    '<span class="rcard__shine"></span>',
    '<div class="rcard__top">' + typeBadge(r.type) + (r.featured ? '<span class="badge badge--brand">精选</span>' : '') + '</div>',
    '<div class="rcard__score">' + fmtScore(r.score) + '<small>/10</small></div>',
    '<div class="rcard__providers">' + providerChips(links) + '</div>',
    '<span class="rcard__view"><b>查看详情 <svg viewBox="0 0 24 24" class="icon" style="width:14px;height:14px"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></b></span>',
    '</div>',
    pct !== null && pct < 100 ? '<div class="rcard__complete" title="信息完整度 ' + pct + '%"><b>' + pct + '</b></div>' : '',
    '<div class="rcard__body">',
    /* 标题保持真链接，并用 ::after 拉伸成整卡热区：点封面 / 简介 / 空白也能进详情，
       同时保留中键、右键新窗口、键盘 Enter 与朗读语义 */
    '<a class="rcard__title" href="' + href + '">' + escapeHtml(r.title) + '</a>',
    r.summary ? '<p class="rcard__sum">' + escapeHtml(r.summary) + '</p>' : '<p class="rcard__sum rcard__sum--empty muted">—— 简介待补全 ——</p>',
    '<div class="rcard__tags">' + (r.tags || []).slice(0, 4).map((t) => '<span class="tag" role="link" tabindex="0" data-tag="' + escapeHtml(t) + '">#' + escapeHtml(t) + '</span>').join('') + '</div>',
    '<div class="rcard__foot"><span>' + (r.downloads || []).length + ' 个下载</span><span>·</span><span>' + ((r.gallery || []).length) + ' 张图</span><span>·</span><span>' + ((r.others || []).length) + ' 个来源</span><span class="rcard__go">查看详情 ↗</span></div>',
    '</div>',
    '<button class="rcard__fav" type="button" data-fav aria-pressed="' + (fav ? 'true' : 'false') + '" title="收藏到我的库" aria-label="收藏《' + escapeHtml(r.title) + '》">' + (fav ? '★' : '☆') + '</button>',
  ].join('');
  const img = node.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      const holder = document.createElement('div');
      holder.className = 'rcard__noimg';
      holder.textContent = img.dataset.fallback || '?';
      img.replaceWith(holder);
    });
  }
  /* 卡片级点击：收藏 / 标签自己处理，其余（含标题拉伸热区漏掉的封面角标区域）都进详情 */
  node.addEventListener('click', (e) => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) { e.preventDefault(); toggleFav(favBtn); return; }
    const tagEl = e.target.closest('.tag[data-tag]');
    if (tagEl) { e.preventDefault(); goTag(tagEl.dataset.tag); return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button && e.button !== 0)) return;
    if (e.target.closest('a, button, input, select, textarea, label')) return;
    navigate('/resource/' + r.id);
  });
  const toggleFav = (btn) => {
    const on = Prefs.toggleFav({ id: r.id, title: r.title, cover: r.cover, type: r.type });
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    toast(on ? '已加入收藏' : '已移出收藏', on ? 'ok' : 'info', 1600);
  };
  const goTag = (t) => { location.hash = '#/library?tag=' + encodeURIComponent(t); };
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tagEl = e.target.closest('.tag[data-tag]');
    if (tagEl && e.key === 'Enter') { e.preventDefault(); goTag(tagEl.dataset.tag); }
  });
  tilt(node, { max: 4 });
  return node;
}
export function linkRow(link, kind) {
  const row = document.createElement('div');
  row.className = 'dl-row';
  const color = link.color || '#94a3b8';
  row.innerHTML = [
    '<span class="dl-row__logo" style="background:' + color + '">' + escapeHtml(providerInitial(link.label || link.provider || '链接')) + '</span>',
    '<div class="grow">',
    '<div class="dl-row__name truncate">' + escapeHtml(link.label || link.providerName || '下载链接')
      + (link.quality ? ' <span class="badge">' + escapeHtml(link.quality) + '</span>' : '')
      + (link.size ? ' <span class="mono small muted">' + escapeHtml(link.size) + '</span>' : '') + '</div>',
    '<div class="dl-row__url truncate">' + escapeHtml(link.url) + '</div>',
    link.note ? '<div class="small muted" style="margin-top:3px">' + escapeHtml(link.note) + '</div>' : '',
    '</div>',
    '<div class="dl-row__acts">',
    link.checkStatus === 'dead' ? '<span class="badge badge--bad">疑似失效</span>' : link.checkStatus === 'alive' ? '<span class="badge badge--ok">可访问</span>' : '',
    link.code ? '<button class="code-pill" data-code title="复制提取码">码 ' + escapeHtml(link.code) + '</button>' : '',
    '<button class="btn btn--sm btn--quiet" data-copy>复制</button>',
    '<button class="btn btn--sm btn--primary" data-open>' + (kind === 'other' ? '打开来源' : '去下载') + '</button>',
    '</div>',
  ].join('');
  row.querySelector('[data-copy]').onclick = () => copyLink(link);
  row.querySelector('[data-open]').onclick = () => openLink(link.url);
  const codeBtn = row.querySelector('[data-code]');
  if (codeBtn) codeBtn.onclick = () => copy(link.code, '提取码 ' + link.code + ' 已复制');
  return row;
}

export function galleryGrid(images) {
  const wrap = document.createElement('div');
  wrap.className = 'gallery';
  images.forEach((item, i) => {
    const url = typeof item === 'string' ? item : item.url;
    const cap = typeof item === 'string' ? '' : item.caption || item.alt || '';
    const b = document.createElement('button');
    b.innerHTML = '<img src="' + imgSrc(url, cap) + '" alt="' + escapeHtml(cap || '预览图 ' + (i + 1)) + '" loading="lazy" />' + (cap ? '<span>' + escapeHtml(cap) + '</span>' : '');
    b.title = '点击查看大图';
    b.querySelector('img').addEventListener('error', () => b.remove());
    b.onclick = () => openLightbox(images, i);
    wrap.append(b);
  });
  return wrap;
}

export function scoreRing(score, votes) {
  const v = Number(score) || 0;
  const pct = Math.max(0.05, v / 10);
  const R = 42;
  const C = 2 * Math.PI * R;
  return '<div class="score-ring" data-reveal="scale"><svg viewBox="0 0 92 92" aria-hidden="true"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c5cff"/><stop offset=".55" stop-color="#22d3ee"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs>'
    + '<circle cx="46" cy="46" r="' + R + '" fill="none" style="stroke:var(--veil-4)" stroke-width="6"/>'
    + '<circle class="ring" cx="46" cy="46" r="' + R + '" fill="none" stroke="url(#ringGrad)" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '" data-target="' + (C * (1 - pct)).toFixed(1) + '"/>'
    + '</svg><div><b>' + fmtScore(v) + '</b><small>' + (votes ? votes + ' 人评分' : '暂无评分') + '</small></div></div>';
}
export function animateRing(root) {
  const ring = root.querySelector('.ring');
  if (!ring) return;
  setTimeout(() => { ring.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.16,1,.3,1)'; ring.style.strokeDashoffset = ring.dataset.target; }, 140);
}
export function progressBar(pct) {
  return '<div class="progress"><i class="progress__bar" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div>';
}

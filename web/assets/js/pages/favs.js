/* 我的收藏（保存在本机 localStorage） */
import { el, escapeHtml, Api, Prefs, toast, emptyState, reveal, navigate, confirmDialog } from '../core.js';
import { resourceCard } from '../ui.js';

export async function favsView(host) {
  const list = Prefs.favList();
  host.innerHTML = [
    '<div class="shell section--tight" style="padding-top:26px">',
    '<div class="sec-head" style="margin-bottom:18px"><div><span class="eyebrow">My shelf</span><h2 data-page-title>我的收藏</h2><p>收藏保存在本机浏览器，不上传服务器；换设备后需要重新收藏。</p></div>',
    '<div class="row" style="gap:8px">' + (list.length ? '<button class="btn btn--sm btn--quiet" id="clearFav">清空</button>' : '') + '<a class="btn btn--sm btn--primary" href="#/library">去资源库</a></div></div>',
    '<div class="grid grid--wide" id="favGrid"></div>',
    '</div>',
  ].join('');
  const grid = host.querySelector('#favGrid');
  if (!list.length) {
    grid.innerHTML = emptyState({ icon: '☆', title: '还没有收藏', desc: '在资源卡片或详情页点 ★ 即可加入收藏夹。', action: '<a class="btn btn--primary btn--sm" href="#/library">浏览资源库</a>' });
    reveal(host);
    return;
  }
  grid.append(el('<div class="skeleton" style="height:220px;border-radius:22px"></div>'));
  try {
    const res = await Api.resources({ pageSize: 200 });
    const byId = new Map(res.items.map((r) => [r.id, r]));
    const ids = list.map((f) => f.id);
    const missing = ids.filter((id) => !byId.has(id));
    for (const id of missing) {
      try { const d = await Api.resource(id); byId.set(id, d.resource); } catch { Prefs.toggleFav({ id }); }
    }
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    list.forEach((f) => {
      const r = byId.get(f.id);
      if (!r) return;
      const card = resourceCard(r);
      const time = el('<span class="rcard__stamp tiny mono">' + new Date(f.at).toLocaleDateString() + '</span>');
      card.append(time);
      frag.append(card);
    });
    grid.append(frag);
    reveal(grid);
  } catch (err) {
    grid.innerHTML = emptyState({ icon: '⚠️', title: '读取失败', desc: escapeHtml(err.message) });
  }
  const clear = host.querySelector('#clearFav');
  if (clear) clear.onclick = async () => {
    if (await confirmDialog({ title: '清空收藏', text: '将移除本机保存的全部 ' + list.length + ' 条收藏，确定继续？', okText: '清空', danger: true })) {
      Prefs.set({ favorites: [] });
      toast('已清空收藏', 'ok');
      navigate('/favs');
    }
  };
}

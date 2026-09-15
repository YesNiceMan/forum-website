/* 聚合搜索：站内 + 网盘 / 网站 / 磁力 多来源 */
import { $, el, escapeHtml, Api, store, skeletonGrid, reveal, toast, copy, openLink, providerInitial, fmtBytes, relTime, navigate, emptyState, modal, Prefs, rippleAll } from '../core.js';
import { pickStrip, openInsertPanel, piecesOfItem, onResourceChange } from './insert.js';

const KINDS = [
  { key: 'all', name: '全部', icon: '◎' },
  { key: 'netdisk', name: '网盘', icon: '☁' },
  { key: 'magnet', name: '磁力', icon: '⚉' },
  { key: 'web', name: '网站', icon: '↗' },
  { key: 'doc', name: '文档', icon: '❐' },
  { key: 'image', name: '图片', icon: '◈' },
];

export async function search(host, ctx) {
  const q = ctx.query.q || '';
  const bindId = ctx.query.id || '';
  host.innerHTML = [
    '<div class="shell" style="padding-top:26px">',
    '<div class="sec-head" style="margin-bottom:14px"><div><span class="eyebrow">Cross-source</span><h2 data-page-title>聚合搜索</h2><p>输入资源标题 / 名字，同时检索本站资源库与网盘、网站、磁力等外部来源；命中结果可一键收藏或回填补全。</p></div></div>',
    '<form class="search-hero" id="aggForm" style="margin-top:0">',
    '<div class="search-hero__box">',
    '<svg viewBox="0 0 24 24" class="icon" style="color:var(--text-mute)"><path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5.5 13.5L20 21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    '<input id="aggInput" placeholder="例如：极光之境 / Rust 系统编程 / 午夜黑胶" value="' + escapeHtml(q) + '" autocomplete="off" />',
    '<button class="btn btn--primary btn--lg" type="submit">检索全部来源</button>',
    '</div>',
    '<div class="search-hero__hint" id="kindRow">',
    KINDS.map((k) => '<button type="button" class="chip' + (k.key === 'all' ? ' is-on' : '') + '" data-kind="' + k.key + '"><span style="opacity:.7">' + k.icon + '</span>' + k.name + '</button>').join(''),
    '<span class="grow"></span><span class="mono tiny muted">来源：' + store.bootstrap.sources.length + ' 个</span>',
    '</div>',
    '</form>',
    bindId ? '<div class="hint-strip hint-strip--bind" style="margin-top:14px"><span style="flex:none">⤴</span><span>正在为《<b id="bindTitle">…</b>》查找补充来源：<b>点结果里的文字 / 图片小块，就直接插进它的对应位置</b>（简介 / 正文 / 封面 / 图集 / 下载 / 其他来源 / 元数据），要改落点或一次插多条就点「✚ 选位置插入」。<span id="bindNote">正在确认站点设置…</span></span><span class="grow"></span><span class="bind-count" id="bindCount" hidden>本次已插入 <b>0</b> 项</span></div>' : '',
    '<div id="aggBody" style="margin-top:22px"></div>',
    '</div>',
  ].join('');

  const body = host.querySelector('#aggBody');
  // ?sources=site,github 可只看指定来源（资源页「找更多来源」默认锁定「本站 + 全部」）
  const state = { kinds: ['all'], sources: String(ctx.query.sources || '').split(',').map((s) => s.trim()).filter(Boolean) };
  let bound = null;              // 绑定模式下的资源快照：插入后由服务端回传刷新
  let insertedCount = 0;
  const bumpCount = () => {
    const node = host.querySelector('#bindCount');
    if (!node || !insertedCount) return;
    node.hidden = false;
    node.querySelector('b').textContent = String(insertedCount);
  };
  // 每次写入后服务端会回传资源快照：更新本地快照，后续芯片的「空位 / 追加」判定立即跟上
  if (bindId) onResourceChange((id, snapshot) => { if (!snapshot || (id && id !== bindId)) return; bound = { ...bound, ...snapshot }; boundResource = bound; });
  host.querySelector('#kindRow').onclick = (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    const k = btn.dataset.kind;
    if (k === 'all') state.kinds = ['all'];
    else {
      state.kinds = state.kinds.includes(k) ? state.kinds.filter((x) => x !== k) : [...state.kinds, k];
      if (!state.kinds.length) state.kinds = ['all'];
      state.kinds = state.kinds.filter((x) => x !== 'all' && state.kinds.length > 1 ? true : true);
    }
    Array.from(e.currentTarget.querySelectorAll('.chip')).forEach((c) => c.classList.toggle('is-on', state.kinds.includes(c.dataset.kind) || state.kinds.includes('all') && c.dataset.kind === 'all'));
    if (host.querySelector('#aggInput').value.trim()) run();
  };
  host.querySelector('#aggForm').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  if (bindId) {
    try {
      const d = await Api.resource(bindId);
      const t = host.querySelector('#bindTitle');
      if (t) t.textContent = d.resource.title;
      bound = d.resource;
      boundResource = d.resource;
      const note = host.querySelector('#bindNote');
      note.textContent = (store.bootstrap.settings || {}).requireReview
        ? '本站开启了审核：访客插入先进待审队列，管理员确认后才并入。'
        : '本站允许直接入库：点一下就能看到内容出现在资源的对应位置里。';
    } catch {
      const t = host.querySelector('#bindTitle');
      if (t) t.textContent = '未知资源';
      const note = host.querySelector('#bindNote');
      if (note) note.textContent = '该资源可能已下架，仍可查看搜索结果。';
    }
  }
  if (q) run();
  else {
    body.innerHTML = [
      '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">',
      tipCard('☁', '网盘来源', '内置百度 / 阿里 / 夸克 / 蓝奏 / 115 / 天翼 / UC / 123 / PikPak 等识别，粘贴链接即可自动分类并抽取提取码。'),
      tipCard('⚉', '磁力 / P2P', 'magnet / ed2k / thunder 自动识别，可解析 dn 文件名与 BTIH 哈希，点击直接唤起下载器。'),
      tipCard('↗', '开放接口聚合', 'GitHub / Open Library / Crossref / iTunes / Openverse / Nyaa 等真实接口在服务端并发检索（后台可增删来源）。'),
      '</div>',
      '<div class="card card--pad" style="margin-top:22px"><h3 style="font-size:16px;margin-bottom:10px">最近搜索</h3><div class="pill-list" id="recentSearch"></div></div>',
    ].join('');
    const rec = (store.recentSearches || []).length ? store.recentSearches : ['极光', 'Rust', '采样', '图鉴', '地牢'];
    body.querySelector('#recentSearch').innerHTML = rec.map((r) => '<button class="chip" data-q="' + escapeHtml(r) + '">' + escapeHtml(r) + '</button>').join('');
    body.onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) { host.querySelector('#aggInput').value = b.dataset.q; run(); } };
  }

  async function run() {
    const query = host.querySelector('#aggInput').value.trim();
    if (!query) return toast('请输入标题或名字');
    history.replaceState(null, '', '#/search?q=' + encodeURIComponent(query) + (bindId ? '&id=' + bindId : ''));
    store.recentSearches = [query, ...(store.recentSearches || []).filter((x) => x !== query)].slice(0, 10);
    body.innerHTML = '<div class="row muted" style="margin-bottom:16px"><span class="spinner"></span><span class="small">正在并发检索 ' + store.bootstrap.sources.length + ' 个来源…</span></div>' + skeletonGrid(4, true);
    try {
      const res = await Api.search({ q: query, kinds: state.kinds, sources: state.sources, limit: 12 });
      renderResults(res, query);
    } catch (err) {
      body.innerHTML = emptyState({ icon: '⚠️', title: '检索失败', desc: escapeHtml(err.message || '服务异常'), action: '<button class="btn btn--sm btn--quiet" onclick="location.reload()">重试</button>' });
    }
  }

  function renderResults(res, query) {
    const frag = document.createDocumentFragment();
    const head = el('<div class="row row--wrap" style="gap:10px;margin-bottom:18px"><span class="badge badge--live">' + res.counts.local + ' 条站内</span><span class="badge">' + res.counts.external + ' 条外部结果</span><span class="badge">' + res.groups.length + ' 个在线来源</span><span class="badge badge--brand">' + res.jumps.length + ' 个跳转检索</span><span class="grow"></span><button class="btn btn--sm btn--quiet" id="reSearch">重新检索</button></div>');
    head.querySelector('#reSearch').onclick = run;
    frag.append(head);

    if (!res.groups.some((g) => g.items.length)) {
      frag.append(el('<div class="hint-strip warn-strip">在线来源暂时没有返回可用结果（多为对方站点限制）。可右键下方「跳转检索」在新窗口搜索，找到分享链接后用<b>「粘贴补全」</b>入库。</div>'));
    }

    /* 跳转检索 */
    if (res.jumps.length) {
      const jumpBox = el('<div class="card card--pad" style="margin-bottom:22px"><h3 style="font-size:15px;margin-bottom:12px">跳转检索（网盘 / 磁力 / 站点）</h3><div class="jump-grid" id="jumpGrid"></div></div>');
      const grid = jumpBox.querySelector('#jumpGrid');
      res.jumps.forEach((j) => {
        const b = el('<button class="jump-btn"><i style="background:' + escapeHtml(j.color || '#7c5cff') + '"></i>' + escapeHtml(j.name) + '<span class="mono tiny muted">↗</span></button>');
        b.title = j.note || j.jumpUrl;
        b.onclick = () => window.open(j.jumpUrl, '_blank', 'noopener');
        grid.append(b);
      });
      frag.append(jumpBox);
    }

    /* 分组结果 */
    res.groups.forEach((g) => {
      if (!g.items.length && !g.error) return;
      const gcolor = escapeHtml(g.color || '#7c5cff');
      const group = el('<section class="group"><div class="group__head"><span class="badge group__badge" style="--tc:' + gcolor + '">' + escapeHtml(g.icon || '◎') + ' ' + escapeHtml(g.name) + '</span><span class="tiny mono muted">' + (g.ok ? g.items.length + ' 条 · ' + g.ms + 'ms' : '失败') + '</span><span class="group__bar"></span></div><div class="dl-list" id="g-' + escapeHtml(g.id) + '"></div></section>');
      const list = group.querySelector('.dl-list');
      if (g.error) list.innerHTML = '<div class="hint-strip bad-strip tiny">该来源未返回结果：' + escapeHtml(g.error) + '</div>';
      g.items.slice(0, 12).forEach((it) => {
        if (bindId && bound) list.append(resultBlock(it, query, bound, () => { insertedCount++; bumpCount(); }));
        else list.append(resultRow(it, query, bindId));
      });
      frag.append(group);
    });
    body.innerHTML = '';
    body.append(frag);
    reveal(body);
    rippleAll(body);
  }
}

let boundResource = null;   // 绑定模式下的资源快照（resultBlock 写入，resultRow 读取）

function resultRow(it, query, bindId) {
  const row = el('<div class="result" data-reveal><div class="result__thumb">' + (it.image ? '<img src="' + escapeHtml(it.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : escapeHtml(providerInitial(it.title || '?'))) + '</div><div class="grow" style="min-width:0"><h4 class="truncate"></h4><div class="result__meta"></div></div><div class="row" style="gap:6px"></div></div>');
  row.querySelector('h4').textContent = it.title || it.url;
  const meta = row.querySelector('.result__meta');
  const bits = [];
  bits.push('<span class="src-dot" style="--tc:' + escapeHtml(it.color || '#94a3b8') + '">● ' + escapeHtml(it.providerName || it.sourceName || '') + '</span>');
  if (it.kind) bits.push('<span>' + escapeHtml(it.kind) + '</span>');
  if (it.size) bits.push('<span>' + escapeHtml(fmtBytes(it.size) || String(it.size)) + '</span>');
  if (it.time) bits.push('<span>' + escapeHtml(it.time) + '</span>');
  if (it.extra) bits.push('<span>' + escapeHtml(String(it.extra)) + '</span>');
  bits.push('<span class="truncate" style="max-width:340px">' + escapeHtml((it.url || '').slice(0, 64)) + '</span>');
  meta.innerHTML = bits.join('');
  const acts = row.querySelector('.row:last-child');
  const mk = (label, cls, fn, title) => { const b = el('<button class="btn btn--sm ' + cls + '">' + label + '</button>'); if (title) b.title = title; b.onclick = fn; return b; };
  if (it.kind === 'local' && it.id) {
    acts.append(mk('查看', 'btn--primary', () => navigate('/resource/' + it.id)));
  } else {
    acts.append(mk('打开', bindId ? 'btn--quiet' : 'btn--primary', () => openLink(it.url)));
    acts.append(mk('复制', 'btn--quiet', () => copy(it.url, '链接已复制')));
    if (bindId) {
      // 绑定模式下给「整套插入」入口：文字 / 图片 / 链接一起挑落点
      const btn = mk('✚ 插入到资源', 'btn--primary', () => {
        const pieces = piecesOfItem(it, bindId);
        if (!pieces.length) return toast('这条结果里没有可提取的文字 / 图片，试试「⇣ 抓正文与图片」', 'warn', 4200);
        openInsertPanel({ item: it, resource: boundResource || {}, pieces, onPanelClose: () => onInserted && onInserted() });
      }, '把这条结果里的文字 / 图片 / 链接挑几条写进资源');
      acts.append(btn);
    } else if (['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes(it.kind)) {
      acts.append(mk('补全入库', 'btn--quiet', () => quickAdd(it), '生成一条待审投稿，管理员补全后入库'));
    }
  }
  return row;
}

/**
 * 绑定模式（详情页「找更多来源」跳过来）的一整块：
 * 结果行 + 点选插入芯片条。芯片一点就写进资源的对应位置，行内的按钮打开「选位置插入」面板。
 */
function resultBlock(it, query, resource, onInserted) {
  boundResource = resource;
  const wrap = el('<div class="result-block"></div>');
  wrap.append(resultRow(it, query, resource.id));
  const strip = pickStrip(it, resource, {
    onDone: (res) => {
      if (res && res.mode === 'inserted' && res.report) {
        const n = (res.report.filled || []).length + (res.report.appended || []).length;
        if (n) onInserted && onInserted(n);
      } else if (res && res.mode === 'pending') onInserted && onInserted(1);
    },
  });
  wrap.append(strip);
  return wrap;
}

async function quickAdd(it) {
  const m = modal({
    title: '补全并入库', sub: '已从搜索结果带入链接，可继续填写缺失信息后提交。', size: 'modal--wide',
    body: '<div id="quickForm"></div>',
    foot: '<span class="tiny muted mono">提交后进入后台「投稿审核」，管理员补全后即可发布</span><span class="grow"></span><button class="btn btn--quiet" data-cancel>取消</button><button class="btn btn--primary" data-ok>提交入库</button>',
    onMount(node, close) {
      node.querySelector('[data-cancel]').onclick = close;
      const form = QuickForm(node.querySelector('#quickForm'), {
        title: it.title && !/^(未命名|结果)/.test(it.title) ? it.title : '',
        summary: it.snippet || '',
        downloads: [{ url: it.url, label: it.providerName || '', kind: it.kind, code: '', size: '', quality: '', note: '来自聚合搜索' }],
        others: [],
        sourceUrl: /^https?:/.test(it.url || '') ? '' : it.url,
        tags: [],
      });
      node.querySelector('[data-ok]').onclick = async () => {
        const payload = form.value();
        if (!payload.title) return toast('请填写标题', 'bad');
        try {
          const res = await Api.submit(payload);
          toast(res.message || '已提交', 'ok');
          close();
        } catch (err) { toast('提交失败：' + err.message, 'bad'); }
      };
    },
  });
}

/* 手动添加表单（与 submit 页共用） */
export function QuickForm(host, initial = {}) {
  const value = {
    title: initial.title || '', type: initial.type || '', tags: initial.tags || [], score: initial.score || '',
    summary: initial.summary || '', content: initial.content || '', cover: initial.cover || '', gallery: initial.gallery || [],
    downloads: initial.downloads || [], others: initial.others || [], sourceUrl: initial.sourceUrl || '',
    year: initial.year || '', region: initial.region || '', size: initial.size || '', format: initial.format || '', author: initial.author || '',
    contact: initial.contact || '', notes: initial.notes || '',
  };
  const b = store.bootstrap;
  host.innerHTML = [
    '<div class="form-grid">',
    '<div class="field span-2"><label>标题 <span class="req">*</span></label><input class="input" data-k="title" value="' + escapeHtml(value.title) + '" placeholder="资源 / 作品 / 软件名称" /></div>',
    '<div class="field"><label>类型</label><select class="select" data-k="type"><option value="">自动判断</option>' + b.types.map((t) => '<option' + (value.type === t.key ? ' selected' : '') + '>' + escapeHtml(t.key) + '</option>').join('') + '</select></div>',
    '<div class="field"><label>分数（0-10）</label><input class="input" data-k="score" type="number" min="0" max="10" step="0.1" value="' + escapeHtml(value.score) + '" placeholder="7.5" /></div>',
    '<div class="field span-2"><label>标签（回车添加）</label><div class="tag-input" id="tagBox"><input id="tagInput" placeholder="科幻 / 蓝光 / 无损…" /></div></div>',
    '<div class="field span-2"><label>简介</label><textarea class="textarea" data-k="summary" style="min-height:80px" placeholder="一两句话说明这个资源是什么、包含什么">' + escapeHtml(value.summary) + '</textarea></div>',
    '<div class="field span-2"><label>内容 / 图文（支持简版 Markdown）</label><textarea class="textarea" data-k="content" placeholder="详细介绍、目录、更新日志…支持 **加粗**、- 列表、![图片](链接)">' + escapeHtml(value.content) + '</textarea></div>',
    '<div class="field"><label>年份</label><input class="input" data-k="year" value="' + escapeHtml(value.year) + '" placeholder="2024" /></div>',
    '<div class="field"><label>地区 / 语言</label><input class="input" data-k="region" value="' + escapeHtml(value.region) + '" placeholder="日本 / 中英双字" /></div>',
    '<div class="field"><label>大小</label><input class="input" data-k="size" value="' + escapeHtml(value.size) + '" placeholder="12.4 GB" /></div>',
    '<div class="field"><label>格式 / 版本</label><input class="input" data-k="format" value="' + escapeHtml(value.format) + '" placeholder="MKV / v2.4.1" /></div>',
    '<div class="field"><label>作者 / 制作</label><input class="input" data-k="author" value="' + escapeHtml(value.author) + '" /></div>',
    '<div class="field"><label>昵称 / 联系方式</label><input class="input" data-k="contact" value="' + escapeHtml(value.contact) + '" placeholder="便于回访（可选）" /></div>',
    '</div>',
    '<div class="divider"></div>',
    '<div class="row row--between" style="margin-bottom:8px"><h4 style="font-size:14px">资源下载 <span class="muted tiny">网盘 / 磁力 / 直链</span></h4><button class="btn btn--sm btn--quiet" data-add="downloads">+ 添加一行</button></div>',
    '<div class="dl-list" id="dlList"></div>',
    '<div class="row row--between" style="margin:16px 0 8px"><h4 style="font-size:14px">其他来源 <span class="muted tiny">在线站点 / 详情页 / 镜像</span></h4><button class="btn btn--sm btn--quiet" data-add="others">+ 添加一行</button></div>',
    '<div class="dl-list" id="otherList"></div>',
  ].join('');

  const tagBox = host.querySelector('#tagBox');
  let tags = [...value.tags];
  const renderTags = () => {
    Array.from(tagBox.querySelectorAll('.tag-pill')).forEach((n) => n.remove());
    tags.forEach((t, i) => tagBox.prepend(el('<span class="tag-pill">' + escapeHtml(t) + '<button type="button" aria-label="删除">×</button></span>')));
    tagBox.onclick = (e) => { if (e.target.tagName === 'BUTTON') { tags.splice([...tagBox.querySelectorAll('.tag-pill')].indexOf(e.target.closest('.tag-pill')), 1); renderTags(); } };
  };
  renderTags();
  const tagInput = host.querySelector('#tagInput');
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault();
      const v = tagInput.value.trim().replace(/[,，]/g, '');
      if (v && !tags.includes(v)) { tags.push(v); tagInput.value = ''; renderTags(); }
    } else if (e.key === 'Backspace' && !tagInput.value && tags.length) { tags.pop(); renderTags(); }
  });

  const lists = { downloads: host.querySelector('#dlList'), others: host.querySelector('#otherList') };
  const rows = { downloads: [...value.downloads], others: [...value.others] };
  const renderList = (kind) => {
    const box = lists[kind];
    box.innerHTML = '';
    if (!rows[kind].length) box.innerHTML = '<p class="tiny muted">' + (kind === 'downloads' ? '至少提供一个下载地址' : '暂无其他来源') + '</p>';
    rows[kind].forEach((item, idx) => {
      const line = el('<div class="link-line"><div><input data-f="url" placeholder="粘贴网盘 / 磁力链接" value="' + escapeHtml(item.url || '') + '" />' + (item.label ? '<span class="tiny muted">识别为 ' + escapeHtml(item.label) + (item.code ? ' · 提取码 ' + escapeHtml(item.code) : '') + '</span>' : '') + '</div><div class="row" style="gap:4px"><button class="link-line__del" data-del="' + idx + '" title="删除">×</button></div></div>');
      const input = line.querySelector('[data-f="url"]');
      input.addEventListener('change', () => {
        const v = input.value.trim();
        rows[kind][idx].url = v;
        const c = classifyLocal(v);
        if (c) { rows[kind][idx].label = c.providerName; rows[kind][idx].kind = c.kind; rows[kind][idx].color = c.color; rows[kind][idx].provider = c.provider; if (c.code) rows[kind][idx].code = c.code; }
        renderList(kind);
      });
      line.querySelector('[data-del]').onclick = () => { rows[kind].splice(idx, 1); renderList(kind); };
      box.append(line);
    });
  };
  renderList('downloads');
  renderList('others');
  host.querySelectorAll('[data-add]').forEach((btn) => { btn.onclick = () => { const k = btn.dataset.add; rows[k].push({ url: '', label: '' }); renderList(k); }; });

  host.querySelectorAll('[data-k]').forEach((input) => { input.addEventListener('input', () => { value[input.dataset.k] = input.value; }); });

  return {
    value() {
      host.querySelectorAll('[data-k]').forEach((input) => { value[input.dataset.k] = input.value; });
      return {
        ...value,
        tags,
        score: Number(value.score) || 0,
        downloads: rows.downloads.filter((x) => x.url),
        others: rows.others.filter((x) => x.url),
        gallery: rows.downloads.filter((x) => x.kind === 'image' && x.url).map((x) => ({ url: x.url })),
      };
    },
    set(patch) { Object.assign(value, patch); },
  };
}

function classifyLocal(url) {
  if (!url) return null;
  const map = [
    [/pan\.baidu\.com/i, { providerName: '百度网盘', provider: 'baidu', kind: 'netdisk', color: '#4f7cff' }],
    [/alipan|aliyundrive/i, { providerName: '阿里云盘', provider: 'alipan', kind: 'netdisk', color: '#ff6a00' }],
    [/pan\.quark\.cn/i, { providerName: '夸克网盘', provider: 'quark', kind: 'netdisk', color: '#3d7bff' }],
    [/lanzou|lanzn/i, { providerName: '蓝奏云', provider: 'lanzou', kind: 'netdisk', color: '#22a7f0' }],
    [/115\.com/i, { providerName: '115网盘', provider: '115', kind: 'netdisk', color: '#00a870' }],
    [/cloud\.189\.cn/i, { providerName: '天翼云盘', provider: 'tianyi', kind: 'netdisk', color: '#e6484d' }],
    [/drive\.uc\.cn/i, { providerName: 'UC网盘', provider: 'uc', kind: 'netdisk', color: '#f97316' }],
    [/123pan|123684/i, { providerName: '123云盘', provider: '123', kind: 'netdisk', color: '#2563eb' }],
    [/mypikpak/i, { providerName: 'PikPak', provider: 'pikpak', kind: 'netdisk', color: '#7c5cff' }],
    [/onedrive|1drv\.ms/i, { providerName: 'OneDrive', provider: 'onedrive', kind: 'netdisk', color: '#0364b1' }],
    [/drive\.google/i, { providerName: 'Google Drive', provider: 'gdrive', kind: 'netdisk', color: '#29b65b' }],
    [/dropbox/i, { providerName: 'Dropbox', provider: 'dropbox', kind: 'netdisk', color: '#0061fe' }],
    [/^magnet:/i, { providerName: '磁力链接', provider: 'magnet', kind: 'magnet', color: '#f43f5e' }],
    [/^ed2k:/i, { providerName: 'eD2k', provider: 'ed2k', kind: 'ed2k', color: '#fb7185' }],
    [/^thunder:/i, { providerName: '迅雷', provider: 'thunder', kind: 'thunder', color: '#22d3ee' }],
    [/\.(zip|rar|7z|iso|exe|dmg|apk|pdf|epub|mp4|mkv)(\?|$)/i, { providerName: '直链下载', provider: 'httpdl', kind: 'direct', color: '#94a3b8' }],
    [/^https?:/i, { providerName: '网页来源', provider: 'web', kind: 'web', color: '#94a3b8' }],
  ];
  for (const [re, out] of map) if (re.test(url)) {
    const pwd = /[?&](?:pwd|password|code)=([\w-]{2,10})/i.exec(url);
    return { ...out, code: pwd ? pwd[1] : '' };
  }
  return null;
}

function tipCard(icon, title, text) {
  return '<div class="card card--pad card--hover" data-reveal><div class="row" style="gap:10px;margin-bottom:8px"><span style="font-size:22px">' + icon + '</span><h3 style="font-size:15px">' + title + '</h3></div><p class="small dim" style="margin:0">' + text + '</p></div>';
}

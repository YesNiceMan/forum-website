/* 「找更多来源」的点选插入：把检索到的文字 / 图片 / 链接写回资源的对应位置。
   单击片段 = 直接插进自动判定的落点；「选位置插入」面板里可以改落点、改文字、批量写入。 */
import { Api, el, escapeHtml, toast, modal, store, fmtBytes } from '../core.js';

/* ---------- 位置字典 ---------- */
export const SLOTS = {
  title: '标题', type: '类型', tags: '标签', score: '分数', summary: '简介', content: '内容 / 正文',
  notes: '备注', cover: '封面图', gallery: '图集', downloads: '资源下载', others: '其他来源',
  sourceUrl: '来源地址', 'meta.year': '年份', 'meta.region': '地区', 'meta.size': '体积',
  'meta.format': '格式 / 版本', 'meta.duration': '时长 / 集数', 'meta.developer': '作者 / 制作', 'meta.publisher': '制作方', 'meta.language': '语言',
};
const TEXT_SLOTS = ['summary', 'content', 'notes'];
const IMAGE_SLOTS = ['cover', 'gallery'];
const LINK_SLOTS = ['downloads', 'others', 'sourceUrl'];
const slotLabel = (key) => SLOTS[key] || key;
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** 片段 → 用于「空位 / 已有」判定的位置键 */
export function slotKeyOf(p) {
  if (p.kind === 'meta') return 'meta.' + Object.keys(p.value || {})[0];
  return p.field;
}

/* ---------- 资源哪些位置还空着（与服务端 isBlank 同口径，只给前端打标记用） ---------- */
export function slotBlank(r = {}, field) {
  const meta = r.meta || {};
  if (field.startsWith('meta.')) return !meta[field.slice(5)];
  switch (field) {
    case 'summary': return String(r.summary || '').trim().length < 12;
    case 'content': return !String(r.content || '').trim() && !(r.gallery || []).length && !r.cover;
    case 'cover': return !r.cover;
    case 'gallery': return !(r.gallery || []).length;
    case 'tags': return !(r.tags || []).length;
    case 'type': return !r.type || r.type === '其他';
    case 'score': return !(Number(r.score) > 0);
    case 'notes': return !r.notes;
    case 'title': return !r.title;
    case 'sourceUrl': return !r.sourceUrl;
    case 'others': return !(r.others || []).length && !r.sourceUrl;
    case 'downloads': return !(r.downloads || []).length;
    default: return true;
  }
}
/** 一段文字适合放哪：优先填空位，满了就往「正文 / 备注」追加 */
export function autoTarget(resource, p) {
  if (p.kind === 'meta') return 'meta';
  if (p.kind === 'image') return slotBlank(resource, 'cover') ? 'cover' : 'gallery';
  if (p.kind === 'link') return p.field;
  if (p.field === 'title') return slotBlank(resource, 'title') ? 'title' : 'notes';
  if (p.field === 'tags') return 'tags';
  if (p.field === 'summary') return slotBlank(resource, 'summary') ? 'summary' : (slotBlank(resource, 'content') ? 'content' : 'notes');
  if (p.field === 'content') return slotBlank(resource, 'content') ? 'content' : 'notes';
  return p.field;
}
/** 目标下拉的可选值（meta 只有一格，不给下拉） */
export function targetsOf(p) {
  if (p.kind === 'meta') return ['meta'];
  if (p.kind === 'image') return IMAGE_SLOTS;
  if (p.kind === 'link') return LINK_SLOTS;
  return p.targets || TEXT_SLOTS;
}

/* ---------- 已插入状态（本机记忆：刷新 / 翻页不重复点） ---------- */
const INS_KEY = 'aurora.inserts';
const insState = (() => { try { return JSON.parse(localStorage.getItem(INS_KEY) || '{}') || {}; } catch { return {}; } })();
function pieceSig(p) {
  const v = p.value;
  if (typeof v === 'string') return v.slice(0, 90);
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : (x && x.url) || '')).join(',').slice(0, 90);
  if (v && typeof v === 'object') return String(v.url || Object.values(v).join(',')).slice(0, 90);
  return String(v == null ? '' : v).slice(0, 90);
}
const insKey = (resourceId, p) => resourceId + '|' + (p.kind === 'meta' ? 'meta' : p.field) + '|' + pieceSig(p);
export function insertMark(resourceId, p) { return insState[insKey(resourceId, p)]; }
function insertSave(resourceId, p, mode) {
  insState[insKey(resourceId, p)] = mode;
  const keys = Object.keys(insState);
  if (keys.length > 600) keys.slice(0, keys.length - 600).forEach((k) => delete insState[k]);
  try { localStorage.setItem(INS_KEY, JSON.stringify(insState)); } catch {}
}

/* ---------- 片段工厂 ---------- */
const textPiece = (field, value, opts = {}) => ({
  kind: 'text', field, value: clean(value), icon: field === 'tags' ? '＃' : '¶', targets: TEXT_SLOTS, ...opts,
});
const imagePiece = (url, caption) => ({ kind: 'image', field: 'cover', value: { url: clean(url), caption: clean(caption).slice(0, 60) }, icon: '▣' });
const linkPiece = (url, label, extra = {}) => ({ kind: 'link', field: 'others', value: { url: clean(url), label: clean(label).slice(0, 40), ...extra }, icon: '⛓' });
const metaPiece = (key, value) => ({ kind: 'meta', field: 'meta', value: { [key]: clean(value) }, icon: '≡' });
const isDownloadish = (kind, url) => ['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes(kind)
  || /\.(zip|rar|7z|iso|exe|dmg|apk|pdf|epub|mobi|mp4|mkv|torrent)(\?|$)/i.test(String(url || ''));

export function hasValue(p) {
  if (!p) return false;
  const v = p.value;
  if (typeof v === 'string') return !!v.trim();
  if (Array.isArray(v)) return !!v.length;
  if (v && typeof v === 'object') return !!(v.url || Object.values(v).some((x) => clean(x)));
  return false;
}
/** 展示用一行文本 */
export function pieceText(p) {
  if (p.kind === 'image') return clean(p.value.caption) || String(p.value.url || '').split('/').pop().slice(0, 40);
  if (p.kind === 'link') return clean(p.value.label) || String(p.value.url || '').slice(0, 46);
  if (p.kind === 'meta') return Object.values(p.value).map(clean).join(' · ');
  if (Array.isArray(p.value)) return p.value.join(' / ');
  return clean(p.value);
}

/** 一条检索结果 → 可插入片段清单（含站内结果：从兄弟条目搬运） */
export function piecesOfItem(it = {}, selfId = '') {
  if (!it) return [];
  if (it.kind === 'local') return piecesFromLocal(it, selfId);
  const out = [];
  const title = clean(it.title);
  const snippet = clean(it.snippet || it.description);
  const preview = clean(it.preview);
  if (title) out.push(textPiece('title', title, { label: '标题文字', targets: ['title', 'notes', 'content'] }));
  if (snippet) out.push(textPiece('summary', snippet, { label: snippet.length > 90 ? '摘要' : '简介文字' }));
  if (preview && preview !== snippet) out.push(textPiece('content', preview, { label: '页面正文' }));
  if (it.image) out.push(imagePiece(it.image, title));
  const tagLike = clean(it.extra).split(/[,，、|]+/).map(clean).filter((x) => x.length >= 2 && x.length <= 14);
  if (tagLike.length > 1) out.push({ kind: 'text', field: 'tags', value: tagLike.slice(0, 8), icon: '＃', label: '标签', targets: ['tags'] });
  else if (tagLike.length === 1) out.push(metaPiece('developer', tagLike[0]));
  if (it.time) out.push(metaPiece('year', String(it.time).slice(0, 10)));
  if (it.size) out.push(metaPiece('size', typeof it.size === 'number' ? fmtBytes(it.size) : it.size));
  const seed = (it.magnet && it.magnet !== it.url) ? { url: it.magnet, label: title || '磁力链接' } : null;
  if (seed) out.push(linkPiece(seed.url, seed.label, { note: '来自聚合搜索' }));
  const url = clean(it.url);
  if (/^(https?:|magnet:|ed2k:|thunder:)/i.test(url)) {
    out.push(linkPiece(url, title || it.providerName, {
      code: it.code || '', note: '来自聚合搜索 · ' + (clean(it.providerName || it.sourceName) || '外部来源'),
      field: isDownloadish(it.kind, url) ? 'downloads' : 'others',
    }));
    out[out.length - 1].field = isDownloadish(it.kind, url) ? 'downloads' : 'others';
  }
  return out.filter(hasValue);
}

/** 站内命中项：后端只带了摘要级信息，够补简介 / 封面 / 标签 / 类型 */
function piecesFromLocal(it, selfId) {
  if (selfId && String(it.id) === String(selfId)) return [];
  const out = [];
  const meta = it.meta || {};
  if (clean(it.snippet)) out.push(textPiece('summary', it.snippet, { label: '站内简介' }));
  if (it.image) out.push(imagePiece(it.image, it.title));
  if ((meta.tags || []).length) out.push({ kind: 'text', field: 'tags', value: meta.tags.slice(0, 8), icon: '＃', label: '站内标签', targets: ['tags'] });
  if (clean(it.extra)) out.push(textPiece('notes', it.extra, { label: '站内类型', targets: ['notes', 'content'] }));
  const url = clean(it.url);
  if (/^#\//.test(url) === false && url) out.push(linkPiece(url, it.title, { note: '来自站内资源' }));
  return out.filter(hasValue);
}

/** 一次「抓取该页」的结果 → 段落级文字 + 图片 + 页内链接 */
export function piecesFromFetch(res = {}, sourceName = '') {
  const out = [];
  const site = clean(sourceName || res.siteName || res.providerName);
  if (clean(res.description)) out.push(textPiece('summary', res.description, { label: '页面简介' }));
  const paras = String(res.text || '').split(/\n+/).map(clean).filter((s) => s.length >= 12).slice(0, 14);
  paras.forEach((p, i) => out.push(textPiece('content', p, { label: '正文段落 ' + (i + 1), targets: ['content', 'summary', 'notes'] })));
  if (!paras.length && clean(res.textPreview)) out.push(textPiece('content', res.textPreview, { label: '正文预览' }));
  (res.images || []).slice(0, 12).forEach((im) => {
    const url = clean(im.url || im.remote);
    if (/^(https?:|\/uploads\/)/.test(url)) out.push(imagePiece(url, im.alt || res.title));
  });
  const kw = clean(res.keywords).split(/[,，|]/).map(clean).filter((x) => x.length >= 2 && x.length <= 14);
  if (kw.length) out.push({ kind: 'text', field: 'tags', value: kw.slice(0, 10), icon: '＃', label: '关键词标签', targets: ['tags'] });
  if (res.published) out.push(metaPiece('year', String(res.published).slice(0, 10)));
  if (clean(res.author)) out.push(metaPiece('developer', res.author));
  if (clean(res.title)) out.push(textPiece('notes', res.title, { label: '页面标题', targets: ['notes', 'title', 'summary', 'content'] }));
  (res.links || []).slice(0, 8).forEach((u) => {
    const link = linkPiece(u, site || '页面内链接', { note: '来自页面抓取' });
    link.field = isDownloadish('', u) ? 'downloads' : 'others';
    out.push(link);
  });
  return out.filter(hasValue);
}

/* ---------- 提交 ---------- */
/** 片段 → 服务端 inserts（sourceUrl 取字符串；meta:* 合成 meta 对象） */
export function toInserts(pieces = []) {
  return pieces.filter(hasValue).map((p) => {
    if (p.kind === 'meta') return { field: 'meta', value: p.value };
    if (p.field === 'sourceUrl') return { field: 'sourceUrl', value: typeof p.value === 'string' ? p.value : clean(p.value.url) };
    if (p.kind === 'text' && p.field === 'tags') {
      return { field: 'tags', value: Array.isArray(p.value) ? p.value : clean(p.value).split(/[,，|]/).map(clean).filter(Boolean) };
    }
    if (p.kind === 'text') return { field: p.field, value: clean(p.value) };
    return { field: p.field, value: p.value };
  });
}

/** 写入资源并把服务端返回的资源快照广播出去（芯片上的「空位 / 已插入」立即翻牌） */
const listeners = new Set();
export function onResourceChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce(id, snapshot) { listeners.forEach((fn) => { try { fn(id, snapshot); } catch {} }); }

export async function insertPieces(resourceId, pieces, { source = '聚合搜索', overwrite = false } = {}) {
  const list = toInserts(pieces);
  if (!list.length) return { mode: 'empty', message: '没有可插入的内容' };
  const res = await Api.insert(resourceId, { inserts: list, source, overwrite, pageUrl: location.href });
  pieces.filter(hasValue).forEach((p) => insertSave(resourceId, p, res.mode === 'pending' ? 'pending' : 'inserted'));
  if (res.resource) announce(resourceId, res.resource);
  const kind = res.mode === 'pending' ? 'info' : res.mode === 'noop' ? 'warn' : 'ok';
  toast(res.message || (res.mode === 'pending' ? '已提交，等待管理员并入' : '已插入该资源'), kind, 4200);
  return res;
}
export const isAdminSession = () => !!(store.bootstrap && store.bootstrap.session && store.bootstrap.session.authed);
const reviewOn = () => !!((store.bootstrap || {}).settings || {}).requireReview;

/* ---------- 芯片条：点一下直接插入 ---------- */
export function pickStrip(item, resource, { onDone } = {}) {
  const pieces = piecesOfItem(item, resource.id);
  const wrap = el('<div class="pick-strip"></div>');
  const label = el('<span class="pick-strip__label">点一下直接插入</span>');
  wrap.append(label);
  pieces.forEach((src) => {
    const slot = autoTarget(resource, src);
    const piece = { ...src, field: slot };
    const done = insertMark(resource.id, piece);
    const blank = slotBlank(resource, slotKeyOf(piece));
    const txt = pieceText(piece);
    const chip = el('<button type="button" class="pick' + (piece.kind === 'image' ? ' pick--img' : '') + (done ? ' is-done' : '') + '" title="'
      + escapeHtml(done ? '这条已经' + (done === 'pending' ? '提交待审' : '写入过了') : '插入到《' + resource.title + '》的「' + (piece.kind === 'meta' ? '资源信息 · ' + slotLabel(slotKeyOf(piece)) : slotLabel(piece.field)) + '」' + (blank ? '（空位）' : '（追加）') + ' · 按住 ⌥/Alt 可换落点') + '"></button>');
    if (piece.kind === 'image') chip.append(el('<img src="' + escapeHtml(piece.value.url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.opacity=.25" />'));
    else chip.append(el('<span class="pick__icon">' + piece.icon + '</span>'));
    const slotNode = el('<span class="pick__slot"></span>');
    slotNode.textContent = piece.kind === 'meta' ? slotLabel(slotKeyOf(piece)) : slotLabel(piece.field);
    chip.append(slotNode);
    const text = el('<span class="pick__text"></span>');
    text.textContent = txt.length > 32 ? txt.slice(0, 32) + '…' : txt;
    chip.append(text);
    const state = el('<span class="pick__state"></span>');
    state.textContent = done === 'pending' ? '待审' : done ? '已插入' : blank ? '空位' : '追加';
    chip.append(state);
    chip.onclick = (e) => {
      if (e.altKey) { openInsertPanel({ item, resource, pieces, focus: src }); return; }
      if (done || chip.dataset.busy) return;
      chip.dataset.busy = '1';
      chip.classList.add('is-busy');
      insertPieces(resource.id, [piece], { source: '聚合搜索 · ' + (clean(item.providerName || item.sourceName) || '外部来源') })
        .then((res) => {
          chip.classList.remove('is-busy');
          if (res.mode !== 'empty') {
            chip.classList.add('is-done');
            state.textContent = res.mode === 'pending' ? '待审' : res.mode === 'noop' ? '已有' : '已插入';
            text.textContent = '✓ ' + (txt.length > 30 ? txt.slice(0, 30) + '…' : txt);
          }
          onDone && onDone(res, piece);
        })
        .catch((err) => { chip.classList.remove('is-busy'); delete chip.dataset.busy; toast('插入失败：' + (err.message || '服务异常'), 'bad', 4600); });
    };
    wrap.append(chip);
  });
  if (!pieces.length) {
    const hint = el('<span class="pick-strip__hint tiny muted">这条结果没有可直接插入的文字 / 图片，试试「抓正文与图片」。</span>');
    wrap.append(hint);
  }
  const more = el('<button type="button" class="btn btn--sm btn--quiet pick-more">✚ 选位置…</button>');
  more.title = '打开面板：改落点、编辑文字、一次插入多条';
  more.onclick = () => openInsertPanel({ item, resource, pieces });
  wrap.append(more);
  if (/^https?:/i.test(item.url || '')) wrap.append(fetchButton(item, resource, onDone));
  return wrap;
}

function fetchButton(item, resource, onDone) {
  const b = el('<button type="button" class="btn btn--sm btn--ghost pick-fetch">⇣ 抓正文与图片</button>');
  b.title = '服务端抓取这条链接的页面，把正文段落、图片、页内链接列出来点选插入';
  b.onclick = async () => {
    if (b.dataset.busy) return;
    b.dataset.busy = '1';
    b.textContent = '抓取中…';
    try {
      const res = await Api.enrich([item.url], true);
      const one = (res.items || [])[0] || {};
      if (!one.ok || !one.result) throw new Error(one.error || '没有抓到内容');
      const got = piecesFromFetch(one.result, item.providerName || one.result.siteName);
      if (!got.length) throw new Error('页面里没有可提取的文字或图片');
      openInsertPanel({ item, resource, pieces: got, fetched: true });
      onDone && onDone({ fetched: got.length });
    } catch (err) {
      toast('抓取失败：' + (err.message || '对方站点不配合'), 'bad', 4600);
    }
    b.textContent = '⇣ 抓正文与图片';
    delete b.dataset.busy;
  };
  return b;
}

/* ---------- 「选位置插入」面板 ---------- */
export function openInsertPanel({ item = {}, resource, pieces = [], fetched = false, focus = null, onPanelClose = null } = {}) {
  const rows = pieces.map((p) => {
    const targets = targetsOf(p);
    const auto = autoTarget(resource, p);
    const field = targets.includes(auto) ? auto : targets[0];
    return {
      p, on: true, field, targets,
      value: p.kind === 'text' ? (Array.isArray(p.value) ? p.value.join('，') : p.value) : pieceText(p),
      editing: false,
    };
  });
  if (focus) {
    const hit = rows.find((r) => pieceSig(r.p) === pieceSig(focus));
    if (hit) hit.field = autoTarget(resource, { ...focus, field: focus.field }) === 'meta' ? hit.field : focus.field;
  }
  const host = el(['<div class="ins-panel">',
    '<div class="ins-panel__head"><span class="tiny mono muted">目标资源：《' + escapeHtml(resource.title) + '》</span><span class="grow"></span>',
    '<button type="button" class="btn btn--sm btn--quiet" data-all>全选</button>',
    '<button type="button" class="btn btn--sm btn--quiet" data-none>全不选</button>',
    isAdminSession() ? '<label class="check-label tiny"><input type="checkbox" class="check" data-ow /> 覆盖已有内容</label>' : '',
    '</div>',
    '<div class="ins-list"></div>',
    '<p class="tiny muted ins-panel__note">' + (fetched
      ? '内容抓自来源页正文：段落可逐条挑，写入时正文按追加处理，不会覆盖已有内容。'
      : '落点默认为「空位优先」：空着就直接填，已有内容则追加并标注出处。图片会顺手镜像到本站媒体库。') + '</p>',
    '</div>'].join(''));
  const list = host.querySelector('.ins-list');
  const rowValue = (row) => (row.p.kind === 'text' ? row.value : row.p.value);
  const paint = () => {
    list.innerHTML = '';
    rows.forEach((row, idx) => {
      const key = row.p.kind === 'meta' ? slotKeyOf(row.p) : row.field;
      const blank = slotBlank(resource, key);
      const mark = insertMark(resource.id, row.p.kind === 'meta' ? row.p : { ...row.p, field: row.field });
      const node = el(['<div class="ins-row' + (row.on ? ' is-on' : '') + (blank ? ' is-blank' : '') + '">',
        '<label class="ins-row__pick"><input type="checkbox" class="check" data-on="' + idx + '"' + (row.on ? ' checked' : '') + ' /><span class="ins-row__icon">' + row.p.icon + '</span></label>',
        '<div class="ins-row__main">',
        '<div class="ins-row__text"></div>',
        '<div class="ins-row__sub tiny mono muted">' + escapeHtml(row.p.label || (row.p.kind === 'meta' ? '资源信息' : '')) + ' · ' + escapeHtml(slotLabel(row.p.kind === 'meta' ? slotKeyOf(row.p) : row.field)) + (blank ? '（空位）' : '（追加）') + '</div>',
        '</div>',
        row.p.kind === 'image' ? '<img class="ins-row__thumb" src="' + escapeHtml(row.p.value.url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '',
        '<div class="ins-row__slot">',
        row.targets.length > 1
          ? '<select class="select select--sm" data-target="' + idx + '">' + row.targets.map((t) => '<option value="' + t + '"' + (t === row.field ? ' selected' : '') + '>' + escapeHtml(slotLabel(t)) + '</option>').join('') + '</select>'
          : '<span class="tiny mono muted ins-row__fixed">' + escapeHtml(slotLabel(row.p.kind === 'meta' ? slotKeyOf(row.p) : row.field)) + '</span>',
        '<span class="ins-row__state tiny mono">' + (mark === 'pending' ? '待审' : mark ? '已插入' : blank ? '空位' : '追加') + '</span>',
        row.p.kind === 'text' ? '<button type="button" class="icon-btn icon-btn--sm" data-edit="' + idx + '" title="编辑这段文字">✎</button>' : '',
        '</div>',
        '</div>'].join(''));
      const text = node.querySelector('.ins-row__text');
      const v = String(row.value || '');
      text.textContent = v.length > 140 ? v.slice(0, 140) + '…' : v;
      list.append(node);
      if (row.editing) {
        const box = el('<div class="ins-row-edit"></div>');
        const ta = el('<textarea class="textarea" rows="3"></textarea>');
        ta.value = row.value;
        ta.addEventListener('input', () => { row.value = ta.value; });
        box.append(ta);
        list.append(box);
      }
    });
    syncFoot();
  };
  const syncFoot = () => {
    if (!footNode) return;
    const n = rows.filter((r) => r.on).length;
    footNode.textContent = '已选 ' + n + ' / ' + rows.length + ' 个片段 · ' + (isAdminSession() ? '管理员会话：立即写入' : reviewOn() ? '开启审核：提交后进待审队列' : '免审核：立即写入');
  };
  let footNode = null;
  host.onclick = (e) => {
    const on = e.target.closest('[data-on]');
    if (on) { rows[Number(on.dataset.on)].on = on.checked; paint(); return; }
    const ed = e.target.closest('[data-edit]');
    if (ed) { const i = Number(ed.dataset.edit); rows[i].editing = !rows[i].editing; paint(); return; }
    if (e.target.closest('[data-all]')) { rows.forEach((r) => { r.on = true; }); paint(); return; }
    if (e.target.closest('[data-none]')) { rows.forEach((r) => { r.on = false; }); paint(); }
  };
  host.addEventListener('change', (e) => {
    const t = e.target.closest('[data-target]');
    if (!t) return;
    rows[Number(t.dataset.target)].field = t.value;
    paint();
  });
  paint();
  const ctrl = modal({
    title: '插入到《' + (resource.title.length > 16 ? resource.title.slice(0, 16) + '…' : resource.title) + '》',
    sub: fetched ? '抓自来源页的内容，挑好落点一次写入。' : '这条检索结果里的文字 / 图片 / 链接，挑好落点一次写入。',
    size: 'modal--wide', body: host,
    foot: '<span class="tiny mono muted grow" id="insFoot"></span><button class="btn btn--quiet" data-cancel>关闭</button><button class="btn btn--primary" data-ok>插入所选</button>',
    onMount(node, close) {
      footNode = node.querySelector('#insFoot');
      node.querySelector('[data-cancel]').onclick = close;
      const btn = node.querySelector('[data-ok]');
      btn.onclick = async () => {
        const chosen = rows.filter((r) => r.on).map((r) => ({ ...r.p, field: r.field === 'meta' ? 'meta' : r.field, value: rowValue(r) }));
        if (!chosen.length) return toast('先勾选要插入的内容', 'warn');
        btn.disabled = true;
        btn.textContent = '插入中…';
        try {
          const ow = node.querySelector('[data-ow]');
          const res = await insertPieces(resource.id, chosen, {
            source: '聚合搜索 · ' + (clean(item.providerName || item.sourceName) || '外部来源'),
            overwrite: !!(ow && ow.checked),
          });
          if (res.mode === 'inserted' || res.mode === 'pending' || res.mode === 'noop') close();
        } catch (err) {
          toast('插入失败：' + (err.message || '服务异常'), 'bad', 4600);
        }
        btn.disabled = false;
        btn.textContent = '插入所选';
      };
      syncFoot();
    },
    onClose: () => { if (typeof onPanelClose === 'function') onPanelClose(); },
  });
  return ctrl;
}

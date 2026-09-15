// 缺失空白位置：字段模型 + 批量补全（后台「批量补全空白」用，抓取来源与聚合检索共用）
import { mapLimit, truncate, uniq, stripTags, textToHtml, num } from './util.mjs';
import { classify, extractUrls } from './links.mjs';
import { enrichUrl } from './enrich.mjs';
import { runSources } from './sources.mjs';
import { normalizeLink, linkKey, DOWNLOAD_TARGETS } from './store.mjs';

/** 可补全的「位置」，与详情页分区一一对应；后台按这份列表出勾选框 */
export const GAP_FIELDS = [
  { key: 'summary', label: '简介', group: '文字' },
  { key: 'content', label: '内容 / 正文', group: '文字' },
  { key: 'cover', label: '封面图', group: '图片' },
  { key: 'gallery', label: '图集', group: '图片' },
  { key: 'tags', label: '标签', group: '归类' },
  { key: 'type', label: '类型', group: '归类' },
  { key: 'score', label: '分数', group: '归类' },
  { key: 'year', label: '年份', group: '元数据' },
  { key: 'author', label: '作者 / 制作', group: '元数据' },
  { key: 'size', label: '体积', group: '元数据' },
  { key: 'format', label: '格式 / 版本', group: '元数据' },
  { key: 'sourceUrl', label: '来源地址', group: '链接' },
  { key: 'others', label: '其他来源', group: '链接' },
  { key: 'downloads', label: '资源下载', group: '链接' },
];
export const GAP_KEYS = GAP_FIELDS.map((f) => f.key);
export const GAP_GROUPS = ['文字', '图片', '归类', '元数据', '链接'];
const labelOf = (key) => (GAP_FIELDS.find((f) => f.key === key) || {}).label || key;

/** 某个位置是否还是空的（「内容 / 正文」按详情页口径：正文、封面、图集全空才算空） */
export function isBlank(r = {}, key) {
  const meta = r.meta || {};
  switch (key) {
    case 'summary': return String(r.summary || '').trim().length < 12;
    case 'content': return !String(r.content || '').trim() && !(r.gallery || []).length && !r.cover;
    case 'cover': return !r.cover;
    case 'gallery': return !(r.gallery || []).length;
    case 'tags': return !(r.tags || []).length;
    case 'type': return !r.type || r.type === '其他';
    case 'score': return !(Number(r.score) > 0);
    case 'year': return !meta.year;
    case 'author': return !meta.developer && !meta.publisher;
    case 'size': return !meta.size;
    case 'format': return !meta.format;
    case 'sourceUrl': return !r.sourceUrl;
    case 'others': return !(r.others || []).length && !r.sourceUrl;
    case 'downloads': return !(r.downloads || []).length;
    default: return false;
  }
}
export const blankFields = (r = {}) => GAP_KEYS.filter((k) => isBlank(r, k));

/** 全库缺口统计，后台补全面板的「哪里还空着」清单 */
export function gapReport(resources = []) {
  const fields = GAP_FIELDS.map((f) => ({ ...f, count: resources.filter((r) => isBlank(r, f.key)).length }));
  const groups = {};
  for (const g of GAP_GROUPS) groups[g] = fields.filter((f) => f.group === g);
  return {
    fields,
    groups,
    allComplete: resources.filter((r) => !blankFields(r).length).length,
    emptyCells: resources.reduce((n, r) => n + blankFields(r).length, 0),
  };
}

/** 资源自带的候选链接：来源页 → 下载 → 其他来源 → 正文 / 备注里的 http 链接 */
export function candidateUrls(r = {}, { limit = 6 } = {}) {
  const out = [];
  const push = (u) => { const s = String(u || '').trim(); if (/^https?:\/\//i.test(s) && !out.includes(s)) out.push(s); };
  push(r.sourceUrl);
  (r.downloads || []).forEach((d) => push(d.url));
  (r.others || []).forEach((d) => push(d.url));
  extractUrls(String(r.content || '') + ' ' + String(r.notes || '')).forEach(push);
  return out.slice(0, limit);
}

const TYPE_HINTS = [
  ['影视', /(movie|film|剧集|电视剧|电影|蓝光|1080p|2160p|mkv|mp4)/i],
  ['二次元', /(anime|动漫|番剧|ova|bd-?rip|nyaa)/i],
  ['游戏', /(game|游戏|steam|switch|repack|mod)/i],
  ['应用', /(app|software|软件|工具|sdk|api|exe|dmg|apk)/i],
  ['图书', /(book|e-book|pdf|epub|mobi|书|文档|论文)/i],
  ['教程', /(tutorial|course|教程|课程|讲座|培训)/i],
  ['音乐', /(music|album|flac|mp3|vinyl|专辑|音乐)/i],
  ['素材', /(asset|ui kit|素材|模板|font|字体|icon|图标|psd)/i],
];
const textScore = (x = {}) => String(x.text || '').length + String(x.description || '').length * 2 + (x.title ? 40 : 0);
function titleLooksLike(title = '', cand = '') {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '');
  const a = norm(title); const b = norm(cand);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || (a.length > 6 && b.length > 6 && a.slice(0, 6) === b.slice(0, 6));
}
const splitWords = (s = '') => uniq(String(s).split(/[,，、;；|\/\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 12 && !/^(首页|更多|登录|注册|关于我们|cookie|版权|下载)/i.test(x)));

/**
 * 补全一条资源的空白位置。
 * 数据来源依次尝试：① 资源自带链接的抓取结果；②（可选）按标题联网检索到的结果。
 * 只写还空着的位置，已有内容一律不动；dryRun 只回将要写入的内容不落库。
 */
export async function fillOne(resource, {
  fields = GAP_KEYS, uploadDir, mirrorImages = true, imageLimit = 6, timeout = 9000,
  maxUrls = 4, sources = [], useSearch = true, searchLimit = 8, searchTimeout = 7000,
  allowLinks = true, actor = 'admin', dryRun = false, store = null,
} = {}) {
  const want = uniq(fields).filter((k) => GAP_KEYS.includes(k));
  const blank = want.filter((k) => isBlank(resource, k));
  const out = { id: resource.id, title: resource.title, applied: false, filled: [], skipped: [], notes: [], tried: [] };
  if (!want.length) { out.notes.push('没有勾选要补的位置'); return out; }
  if (!blank.length) { out.skipped.push({ key: '—', label: '—', reason: '勾到的位置都已经填好了' }); return out; }
  out.blank = blank.map((k) => ({ key: k, label: labelOf(k) }));

  const urls = candidateUrls(resource, { limit: Math.max(1, maxUrls) });
  const fetched = urls.length
    ? await mapLimit(urls, 2, (u) => enrichUrl(u, { mirrorImages, imageLimit, timeout, uploadDir }))
    : [];
  const results = [];
  fetched.forEach((x, i) => {
    const v = x && x.ok ? x.value : null;
    out.tried.push({ url: truncate(urls[i], 90), ok: !!v, warn: v ? truncate(v.warn || '', 70) : truncate(String((x && x.error) || '抓取异常'), 70) });
    if (v) results.push(v);
  });
  const good = results.filter((x) => !x.metadataOnly && (x.title || x.text || x.description || (x.images || []).length));
  const best = good.slice().sort((a, b) => textScore(b) - textScore(a))[0] || null;
  const corpus = [best && best.title, best && best.description, best && best.text, best && best.siteName, resource.title].filter(Boolean).join(' ');

  let searchItems = [];
  const wantLinks = allowLinks && (blank.includes('downloads') || blank.includes('others'));
  if ((useSearch || wantLinks) && sources.length && (!good.length || wantLinks)) {
    try {
      const run = await runSources(sources.filter((s) => s.enabled && ['api', 'xml', 'html'].includes(s.mode)), resource.title, { limit: searchLimit, timeout: searchTimeout, concurrency: 5 });
      searchItems = (run.items || []).filter((it) => it && /^https?:/i.test(it.url || ''));
      out.notes.push('联网检索到 ' + searchItems.length + ' 条候选');
    } catch (err) {
      out.notes.push('联网检索失败：' + truncate(String((err && err.message) || err), 60));
    }
  } else if ((useSearch || wantLinks) && !sources.length) {
    out.notes.push('没有启用的可抓取检索来源，联网补全已跳过');
  }

  const images = [];
  for (const g of good) {
    for (const im of (g.images || [])) {
      const url = String(im.local || im.url || '');
      if (!/^(https?:|\/uploads\/)/.test(url)) continue;
      if (!images.some((x) => linkKey(x.url) === linkKey(url))) images.push({ url, caption: truncate(im.alt || g.title || '', 60) });
    }
  }

  const patch = {};
  const take = (key, value) => { patch[key] = value; out.filled.push({ key, label: labelOf(key), count: Array.isArray(value) ? value.length : undefined }); };
  const miss = (key, reason) => out.skipped.push({ key, label: labelOf(key), reason });

  if (blank.includes('summary')) {
    const v = truncate(stripTags(String((best && (best.description || best.textPreview || best.text)) || (searchItems[0] && searchItems[0].snippet) || '')).replace(/\s+/g, ' ').trim(), 400);
    v.length >= 12 ? take('summary', v) : miss('summary', '没抓到简介文字');
  }
  if (blank.includes('content')) {
    const paras = uniq(String((best && best.text) || '').split(/\n+/).map((s) => s.trim()).filter((s) => s.length >= 12)).slice(0, 24);
    paras.length ? take('content', textToHtml(paras.join('\n\n')).slice(0, 12000)) : miss('content', '正文文字不足');
  }
  if (blank.includes('cover') || blank.includes('gallery')) {
    const seen = new Set((resource.gallery || []).map((g) => linkKey(g.url)));
    const merged = [...(resource.gallery || [])];
    let added = 0;
    for (const im of images) {
      const k = linkKey(im.url);
      if (seen.has(k)) continue;
      seen.add(k); merged.push({ url: im.url, caption: im.caption }); added++;
      if (merged.length >= 40) break;
    }
    if (added) take('gallery', merged);
    if (blank.includes('cover')) {
      const cover = (merged.find((g) => g.url) || {}).url || '';
      cover ? (patch.cover = cover, out.filled.push({ key: 'cover', label: '封面图' })) : miss('cover', '没有可用图片');
    }
    if (!added && blank.includes('gallery')) miss('gallery', '没有可用图片');
  }
  if (blank.includes('tags')) {
    const kw = splitWords(String((best && best.keywords) || '') + ',' + String((best && best.siteName) || '') + ',' + String((searchItems[0] && searchItems[0].sourceName) || ''));
    kw.length ? take('tags', uniq([...(resource.tags || []), ...kw]).slice(0, 24)) : miss('tags', '没有解析到关键词');
  }
  if (blank.includes('type')) {
    const hit = TYPE_HINTS.find(([, re]) => re.test(corpus));
    hit ? take('type', hit[0]) : miss('type', '无法判断类型');
  }
  if (blank.includes('score')) {
    const m = /([0-9](?:\.[0-9])?)\s*(?:\/\s*10|分|评分|rating|imdb|douban)/i.exec(corpus);
    const v = m ? num(m[1], { min: 0, max: 10, dflt: 0 }) : 0;
    v ? take('score', v) : miss('score', '页面里没有分数');
  }
  const metaPatch = {};
  if (blank.includes('year')) {
    const y = /((?:19|20)\d{2})/.exec(String((best && best.published) || '') + ' ' + corpus.slice(0, 900));
    y ? (metaPatch.year = y[1]) : miss('year', '没有年份线索');
  }
  if (blank.includes('author')) {
    const a = truncate(String((best && best.author) || (searchItems[0] && searchItems[0].author) || ''), 60);
    a ? (metaPatch.developer = a) : miss('author', '没有作者信息');
  }
  if (blank.includes('size')) {
    const m = /([0-9]+(?:\.[0-9]+)?\s*(?:TB|GB|MB|KB))/i.exec(corpus);
    m ? (metaPatch.size = m[1].toUpperCase()) : miss('size', '没有体积信息');
  }
  if (blank.includes('format')) {
    const m = /(1080[pP]|2160[pP]|720[pP]|4K|BluRay|WEB-?Rip|x26[45]|v\d+(?:\.\d+)+|PDF|EPUB|MOBI|ZIP|RAR|APK|DMG)/i.exec(corpus);
    m ? (metaPatch.format = m[1]) : miss('format', '没有格式信息');
  }
  if (Object.keys(metaPatch).length) {
    patch.meta = { ...(resource.meta || {}), ...metaPatch };
    for (const k of Object.keys(metaPatch)) out.filled.push({ key: k, label: labelOf(k) });
  }
  if (blank.includes('sourceUrl')) {
    const u = String((best && best.finalUrl) || (results[0] && results[0].finalUrl) || '');
    /^https?:/i.test(u) ? take('sourceUrl', truncate(u, 300)) : miss('sourceUrl', '没有可用的来源页地址');
  }
  if (blank.includes('others')) {
    const base = resource.others || [];
    const seen = new Set(base.map((x) => linkKey(x.url)));
    const adds = [];
    const push = (url, label, note) => {
      const link = normalizeLink({ url, label, note });
      if (!link || seen.has(linkKey(link.url)) || !['web', 'site', 'doc', 'video'].includes(link.kind)) return;
      seen.add(linkKey(link.url)); adds.push(link);
    };
    searchItems.forEach((it) => push(it.url, truncate(it.title || it.providerName || '网页来源', 30), '批量补全 · 检索所得'));
    for (const g of good) (g.links || []).slice(0, 6).forEach((u) => push(u, truncate(g.siteName || g.title || '来源页', 30), '批量补全 · 来源页提取'));
    adds.length ? take('others', [...base, ...adds].slice(0, 60)) : miss('others', '没找到可靠的网页来源');
  }
  if (blank.includes('downloads') && allowLinks) {
    const base = resource.downloads || [];
    const seen = new Set(base.map((x) => linkKey(x.url)));
    const adds = [];
    for (const it of searchItems) {
      const cls = classify(it.url) || {};
      if (!DOWNLOAD_TARGETS.has(cls.kind) && !DOWNLOAD_TARGETS.has(it.kind)) continue;
      if (!titleLooksLike(resource.title, it.title || it.providerName || '')) continue;
      const link = normalizeLink({ url: it.url, label: truncate(it.title || it.providerName || '下载链接', 40), code: it.code || '', note: '批量补全 · 检索所得' });
      if (!link || seen.has(linkKey(link.url))) continue;
      seen.add(linkKey(link.url)); adds.push(link);
      if (adds.length >= 4) break;
    }
    adds.length ? take('downloads', [...base, ...adds].slice(0, 60)) : miss('downloads', '检索结果里没有可确认的分享链接');
  }

  if (!Object.keys(patch).length) { out.notes.push('没有可写入的内容'); return out; }
  if (dryRun || !store) { out.applied = false; out.patch = patch; return out; }
  const rec = store.updateResource(resource.id, patch, actor);
  if (patch.tags) store.addTags(patch.tags);
  if (patch.type) store.ensureType(patch.type);
  out.applied = true;
  out.resource = rec;
  return out;
}

/** 批量补全：逐条走 fillOne，限制并发，返回可直接渲染的报告 */
export async function batchFill(store, resources, opts = {}) {
  const { concurrency = 2, onProgress } = opts;
  const total = resources.length;
  let done = 0;
  const raw = await mapLimit(resources, Math.max(1, Math.min(4, concurrency)), async (r) => {
    const one = await fillOne(r, opts);
    done++;
    if (onProgress) try { onProgress({ done, total, id: r.id, title: r.title, filled: one.filled.length }); } catch {}
    return one;
  });
  // mapLimit 回传的是 {ok,value|error}：单条抛异常也只让它变成报告里的一行「抓取失败」，不拖垮整批
  const items = raw.map((res, i) => {
    if (res && res.ok && res.value) return res.value;
    const r = resources[i] || {};
    return {
      id: r.id || '', title: r.title || '(无标题)', type: r.type || '其他', before: 0, after: 0, applied: false,
      filled: [], appended: [], skipped: [], duplicate: [], invalid: [], tried: [],
      notes: ['这一条抓取异常：' + ((res && res.error) || '未知错误')],
    };
  });
  const filledCount = items.filter((x) => x.applied && x.filled.length).length;
  return {
    items,
    scanned: total,
    changed: filledCount,
    unchanged: total - filledCount,
    cells: items.reduce((n, x) => n + x.filled.length, 0),
    errors: items.filter((x) => !x.filled.length).map((x) => ({ id: x.id, title: x.title, reason: (x.skipped[0] || {}).reason || (x.notes[0] || '无可补内容') })),
  };
}

// JSON 文件存储：资源 / 用户投稿 / 来源配置 / 站点设置 / 统计 / 日志
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { newId, NOW, normalizeTitle, uniq, fnv, sanitizeHtml, textToHtml } from './util.mjs';
import { classify, extractUrls } from './links.mjs';
import { DEFAULT_SOURCES } from './sources.mjs';

const SCHEMA_VERSION = 1;

/** 这些链接类型算「真正的下载源」，其余（网页 / 文档 / 站点）归到「其他来源」 */
export const DOWNLOAD_TARGETS = new Set(['netdisk', 'magnet', 'ed2k', 'thunder', 'direct']);

/**
 * 来源去重用的 URL 键：忽略首尾空白，以及末尾常见的括号 / 中文标点 / 斜杠。
 * 聚合搜索里抓回来的链接经常带尾斜杠或跟着一个「，」，不去一致就会重复入库。
 */
const LINK_TAIL_TRIM = ' 	)]}，,。;；/';
export function linkKey(u) {
  let s = String(u || '').trim();
  while (s.length && LINK_TAIL_TRIM.includes(s[s.length - 1])) s = s.slice(0, -1);
  return s;
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.db = null;
    this.writing = null;
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.db = normalizeDb(parsed);
      this.db.meta.loadedFrom = this.file;
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error('读取 data/db.json 失败：' + err.message + '（可删除该文件或执行 npm run reset）');
      this.db = normalizeDb({});
      await this.flush();
    }
    return this;
  }

  async flush() {
    const snapshot = JSON.stringify({ ...this.db, meta: { ...this.db.meta, savedAt: NOW(), version: SCHEMA_VERSION } }, null, 2);
    const tmp = this.file + '.tmp-' + Date.now().toString(36);
    this.writing = (async () => {
      await writeFile(tmp, snapshot, 'utf8');
      await rename(tmp, this.file);
    })().catch((err) => {
      console.error('[store] 写入失败：', err.message);
      throw err;
    });
    await this.writing;
    return this;
  }

  /** 写入合并：150ms 内的多次写请求合并成一次落盘 */
  save() {
    if (this._timer) return this._pending || (this._pending = new Promise((res) => { this._resolve = res; }));
    this._pending = new Promise((res) => { this._resolve = res; });
    this._timer = setTimeout(async () => {
      this._timer = null;
      try { await this.flush(); } finally {
        const r = this._resolve; this._pending = null; this._resolve = null; r && r(this);
      }
    }, 150);
    return this._pending;
  }

  /** 立刻落盘：Serverless（Vercel）在 handler 返回后会冻结实例，防抖计时器不会有机会触发 */
  async drain() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const done = this._resolve;
    this._pending = null;
    this._resolve = null;
    await this.flush();
    done && done(this);
    return this;
  }

  log(kind, message, meta = {}) {
    this.db.logs.unshift({ id: newId('l'), kind, message, meta, at: NOW() });
    if (this.db.logs.length > 600) this.db.logs.length = 600;
    return this;
  }
  track(event, meta = {}) {
    const s = this.db.stats;
    s.counters[event] = (s.counters[event] || 0) + 1;
    const day = NOW().slice(0, 10);
    s.daily[day] = s.daily[day] || {};
    s.daily[day][event] = (s.daily[day][event] || 0) + 1;
    s.recent.push({ event, meta: { q: meta.q, id: meta.id }, at: NOW() });
    if (s.recent.length > 400) s.recent.length = 400;
    return this;
  }

  // ---------- 资源 ----------
  get resourceList() { return this.db.resources; }
  findResource(id) {
    return this.db.resources.find((r) => r.id === id || r.slug === id) || null;
  }
  createResource(input, actor = 'admin') {
    const rec = this.normalizeResource(input);
    rec.id = input.id || newId('r');
    rec.slug = makeSlug(rec.title, rec.id);
    rec.createdAt = rec.createdAt || NOW();
    rec.updatedAt = NOW();
    rec.history = [{ at: NOW(), actor, action: 'create', summary: diffSummary({}, rec) }];
    this.db.resources.unshift(rec);
    return rec;
  }
  updateResource(id, patch, actor = 'admin') {
    const cur = this.findResource(id);
    if (!cur) return null;
    const next = this.normalizeResource({ ...cur, ...patch, id: cur.id, slug: cur.slug, createdAt: cur.createdAt });
    const summary = diffSummary(cur, next);
    next.history = [{ at: NOW(), actor, action: 'update', summary }, ...(cur.history || [])].slice(0, 40);
    next.updatedAt = NOW();
    Object.assign(cur, next);
    return cur;
  }
  deleteResource(id) {
    const i = this.db.resources.findIndex((r) => r.id === id);
    if (i < 0) return false;
    const [gone] = this.db.resources.splice(i, 1);
    this.db.archive.push({ at: NOW(), resource: gone });
    if (this.db.archive.length > 100) this.db.archive.shift();
    delete this.db.ratings[id]; // 名册跟着资源走，回收站恢复后也不留旧票
    delete this.db.favs[id];
    return gone;
  }
  restoreResource(id) {
    const i = this.db.archive.findIndex((a) => a.resource?.id === id);
    if (i < 0) return null;
    const [item] = this.db.archive.splice(i, 1);
    this.db.resources.unshift(item.resource);
    return item.resource;
  }

  normalizeResource(input = {}) {
    const settings = this.db.settings;
    const cleanTags = uniq([
      ...asList(input.tags),
      ...splitTags(input.tagText || ''),
    ]).map((t) => String(t).trim()).filter(Boolean).slice(0, 24);
    const type = resolveType(input.type, this.db.types);
    const downloads = asList(input.downloads).map((d) => normalizeLink(d)).filter(Boolean);
    const others = asList(input.others).map((d) => normalizeLink(d)).filter(Boolean);
    for (const url of extractUrls(String(input.notes || '') + ' ' + String(input.content || ''))) {
      const c = classify(url);
      if (c && ['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes(c.kind)) {
        if (!downloads.some((d) => d.url === url) && !others.some((d) => d.url === url)) downloads.push(normalizeLink({ url }));
      }
    }
    const gallery = asList(input.gallery).map((g) => (typeof g === 'string' ? { url: g, caption: '' } : { url: g.url || '', caption: g.caption || '' })).filter((g) => g.url);
    const cover = String(input.cover || '').trim() || gallery[0]?.url || pickLocal(imagesOf(downloads, others)) || '';
    const score = clampScore(input.score ?? settings.defaultScore);
    return {
      id: input.id || '',
      slug: input.slug || '',
      title: String(input.title || '').trim().slice(0, 160),
      altTitles: uniq(asList(input.altTitles).map((s) => String(s).trim())).slice(0, 8),
      type,
      tags: cleanTags,
      score: Number(score),
      votes: Math.max(0, Number(input.votes) || 0),
      ratingSum: Number(input.ratingSum) || 0,
      myScore: Number(input.myScore) || 0,
      summary: String(input.summary || '').trim().slice(0, 4000),
      content: toRichHtml(input.content).slice(0, 40000),
      cover,
      gallery: gallery.slice(0, 40),
      downloads: downloads.slice(0, 60),
      others: others.slice(0, 60),
      imagesFromLinks: uniq([...imagesOf(downloads, others), ...(input.imagesFromLinks || []).map(String)].filter(Boolean)).slice(0, 40),
      linksFromText: uniq(asList(input.linksFromText).map(String).filter(Boolean).map((u) => { const c = classify(u); return c ? { url: u, kind: c.kind, provider: c.provider, providerName: c.providerName, color: c.color, code: c.code } : null; }).filter(Boolean)).slice(0, 60),
      meta: { year: String(input.year || input.meta?.year || ''), region: input.region || input.meta?.region || '', size: input.size || input.meta?.size || '', language: input.language || input.meta?.language || '', duration: input.duration || input.meta?.duration || '', developer: input.developer || input.meta?.developer || '', format: input.format || input.meta?.format || '', ...sanitizeMeta(input.meta) },
      status: ['draft', 'published', 'archived'].includes(input.status) ? input.status : 'published',
      featured: !!input.featured,
      views: Number(input.views) || 0,
      favorites: Number(input.favorites) || 0,
      sourcePage: String(input.sourcePage || '').slice(0, 300),
      sourceName: String(input.sourceName || '').slice(0, 120),
      sourceUrl: String(input.sourceUrl || input.url || '').slice(0, 300),
      batch: input.batch || '',
      quality: input.quality || '',
      notes: String(input.notes || '').slice(0, 4000),
      createdAt: input.createdAt || NOW(),
      updatedAt: input.updatedAt || NOW(),
      history: Array.isArray(input.history) ? input.history.slice(0, 40) : [],
    };
  }

  // ---------- 用户投稿 ----------
  createSubmission(input) {
    const sub = {
      id: newId('s'),
      // kind=source：给已有资源补来源，审核通过后并入原条目；kind=resource：全新投稿
      kind: input.kind === 'source' ? 'source' : 'resource',
      title: String(input.title || '').trim().slice(0, 160),
      type: resolveType(input.type, this.db.types),
      tags: uniq(asList(input.tags).map(String)).slice(0, 20),
      score: clampScore(input.score),
      summary: String(input.summary || '').slice(0, 2000),
      content: String(input.content || '').slice(0, 20000),
      downloads: asList(input.downloads).map((d) => normalizeLink(d)).filter(Boolean).slice(0, 40),
      others: asList(input.others).map((d) => normalizeLink(d)).filter(Boolean).slice(0, 40),
      cover: String(input.cover || '').slice(0, 400),
      sourceUrl: String(input.sourceUrl || '').slice(0, 300),
      contact: String(input.contact || '').slice(0, 120),
      enrich: input.enrich || null,
      status: 'pending',
      at: NOW(),
      reviewedAt: '',
      reviewNote: '',
      resourceId: String(input.resourceId || '').slice(0, 40),
      resourceTitle: String(input.resourceTitle || '').slice(0, 200),
      note: String(input.note || '').slice(0, 500),
      ip: input.ip || '',
    };
    this.db.submissions.unshift(sub);
    if (this.db.submissions.length > 500) this.db.submissions.length = 500;
    return sub;
  }
  updateSubmission(id, patch) {
    const s = this.db.submissions.find((x) => x.id === id);
    if (!s) return null;
    Object.assign(s, patch, { reviewedAt: NOW() });
    return s;
  }
  removeSubmission(id) {
    const i = this.db.submissions.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.db.submissions.splice(i, 1);
    return true;
  }

  /**
   * 把外部找到的来源并入已有资源 —— 详情页「找更多来源 → 加入该资源」的落点。
   * 网盘 / 磁力 / ed2k / 迅雷算「资源下载」，其余（网页 / 文档 / 站点）算「其他来源」；
   * 同一条 URL（忽略尾斜杠与尾标点）重复出现直接跳过，并回传各项处置结果供前端提示。
   */
  mergeLinks(id, links = [], actor = 'system') {
    const cur = this.findResource(id);
    if (!cur) return null;
    const key = linkKey; // 见 store.mjs：忽略尾部斜杠 / 标点后比较
    const seen = new Set([...(cur.downloads || []), ...(cur.others || [])].map((d) => key(d.url)));
    const downloads = [...(cur.downloads || [])];
    const others = [...(cur.others || [])];
    const report = { added: 0, duplicate: 0, invalid: 0, toDownloads: 0, toOthers: 0 };
    for (const raw of (Array.isArray(links) ? links : [links]).slice(0, 40)) {
      const link = normalizeLink(raw);
      if (!link) { report.invalid++; continue; }
      const k = key(link.url);
      if (seen.has(k)) { report.duplicate++; continue; }
      seen.add(k);
      if (DOWNLOAD_TARGETS.has(link.kind)) { downloads.push(link); report.toDownloads++; }
      else { others.push(link); report.toOthers++; }
      report.added++;
    }
    if (!report.added) return { resource: cur, report };
    const resource = this.updateResource(id, { downloads: downloads.slice(0, 60), others: others.slice(0, 60) }, actor);
    this.addTags(resource.tags || []);
    this.save();
    return { resource, report };
  }

  // ---------- 标签 / 分类 ----------
  addTags(list = []) {
    for (const raw of asList(list)) {
      const tag = String(raw).trim();
      if (!tag) continue;
      const found = this.db.tags.find((t) => t.name.toLowerCase() === tag.toLowerCase());
      if (found) found.pinned = found.pinned || false;
      else this.db.tags.push({ name: tag, pinned: false, color: colorFor(tag) });
    }
    return this.db.tags;
  }
  ensureType(name) {
    const t = resolveType(name, this.db.types);
    if (!this.db.types.some((x) => x.key === t)) {
      this.db.types.push({ key: t, name: t, color: colorFor(t), icon: '' });
    }
    return t;
  }

  // ---------- 来源 ----------
  get sources() { return this.db.sources; }
  setSources(list) {
    this.db.sources = list.map((s) => ({ ...s, id: s.id || newId('src') }));
    return this.db.sources;
  }

  // ---------- 检索 ----------
  search({ q = '', types = [], tags = [], providers = [], status = 'published', sort = 'relevance', page = 1, pageSize = 24 } = {}) {
    const terms = tokenize(q);
    const typeSet = types.filter(Boolean).map(String);
    const tagSet = uniq(tags.map(String));
    const provSet = uniq(providers.map(String));
    let list = this.db.resources.filter((r) => (status === 'all' ? true : r.status === status));
    const scored = [];
    for (const r of list) {
      if (typeSet.length && !typeSet.includes(r.type)) continue;
      if (tagSet.length && !tagSet.every((t) => r.tags.some((x) => x.toLowerCase() === t.toLowerCase()))) continue;
      if (provSet.length && !allProviders(r).some((p) => provSet.includes(p))) continue;
      let score = 0;
      if (terms.length) {
        const hay = {
          title: normalizeTitle(r.title),
          alt: r.altTitles.map(normalizeTitle).join(' '),
          tags: r.tags.join(' ').toLowerCase(),
          type: (r.type || '').toLowerCase(),
          summary: (r.summary || '').toLowerCase(),
          content: stripForIndex(r.content),
          links: allProviders(r).join(' ') + ' ' + r.downloads.map((d) => d.url).join(' ').toLowerCase(),
          author: (r.meta.developer || '').toLowerCase(),
        };
        for (const term of terms) {
          const nt = normalizeTitle(term);
          if (hay.title === nt) score += 120;
          else if (hay.title.includes(nt)) score += 60;
          else if (hay.alt.includes(nt)) score += 25;
          if (hay.tags.includes(term)) score += 18;
          if (hay.type.includes(term)) score += 12;
          if (hay.summary.includes(term)) score += 10;
          if (hay.links.includes(term)) score += 8;
          if (hay.content.includes(term)) score += 3;
          if (hay.author.includes(term)) score += 5;
        }
        if (!score) continue;
      }
      score += (r.score || 0) * 2 + Math.log1p(r.views || 0) * 1.5 + (r.featured ? 20 : 0) + (r.downloads.length * 3) + completeness(r).percent / 10;
      scored.push({ r, score });
    }
    const total = scored.length;
    const sorters = {
      relevance: (a, b) => b.score - a.score,
      score: (a, b) => b.r.score - a.r.score,
      newest: (a, b) => String(b.r.createdAt).localeCompare(String(a.r.createdAt)),
      updated: (a, b) => String(b.r.updatedAt).localeCompare(String(a.r.updatedAt)),
      views: (a, b) => (b.r.views || 0) - (a.r.views || 0),
      title: (a, b) => String(a.r.title).localeCompare(String(b.r.title), 'zh'),
    };
    scored.sort(sorters[sort] || sorters.relevance);
    const start = (page - 1) * pageSize;
    return {
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: scored.slice(start, start + pageSize).map((s) => publicResource(s.r)),
    };
  }
}

export function publicResource(r) {
  return { ...r, completeness: completeness(r) };
}

/** 完整度：按 8 个资源页字段的填充情况计算 */
export function completeness(r = {}) {
  // 补源投稿只看链接本身，别拿「缺封面」这类标准去要求它
  if (r && r.kind === 'source') {
    const n = (r.downloads || []).length + (r.others || []).length;
    return { percent: n ? 100 : 60, missing: n ? [] : [{ key: 'downloads', label: '链接' }] };
  }
  const fields = [
    { key: 'title', label: '标题', weight: 16, filled: !!r.title },
    { key: 'type', label: '类型', weight: 10, filled: !!r.type },
    { key: 'tags', label: '标签', weight: 10, filled: (r.tags || []).length > 0 },
    { key: 'score', label: '分数', weight: 8, filled: Number(r.score) > 0 },
    { key: 'summary', label: '简介', weight: 14, filled: String(r.summary || '').length >= 10 },
    { key: 'content', label: '内容/图片', weight: 18, filled: !!r.content || (r.gallery || []).length > 0 || !!r.cover },
    { key: 'downloads', label: '资源下载', weight: 16, filled: (r.downloads || []).length > 0 },
    { key: 'others', label: '其他来源', weight: 8, filled: (r.others || []).length > 0 || !!r.sourceUrl },
  ];
  const percent = Math.round(fields.reduce((n, f) => n + (f.filled ? f.weight : 0), 0));
  return { percent, missing: fields.filter((f) => !f.filled).map(({ key, label }) => ({ key, label })) };
}

function resolveType(name, types) {
  const raw = String(name || '').trim();
  if (!raw) {
    const kw = types.find((t) => t.key === '其他');
    return kw ? kw.key : '其他';
  }
  const hit = types.find((t) => t.key === raw || t.name === raw);
  if (hit) return hit.key;
  const alias = { 电影: '影视', 剧集: '影视', 电视剧: '影视', 动漫: '二次元', 番剧: '二次元', 软件: '应用', APP: '应用', 游戏: '游戏', 书籍: '图书', 电子书: '图书', 教程: '教程', 音乐: '音乐', 素材: '素材' };
  if (alias[raw] && types.some((t) => t.key === alias[raw])) return alias[raw];
  return raw.slice(0, 20);
}

export function normalizeLink(d) {
  if (!d) return null;
  if (typeof d === 'string') d = { url: d };
  const url = String(d.url || '').trim();
  if (!url) return null;
  const c = classify(url, d.label || d.code || '');
  return {
    url,
    label: String(d.label || (c ? c.providerName : '链接')).slice(0, 60),
    provider: c ? c.provider : 'web',
    kind: c ? c.kind : 'web',
    color: c ? c.color : '#94a3b8',
    code: String(d.code || (c ? c.code : '') || '').slice(0, 24),
    size: String(d.size || '').slice(0, 40),
    quality: String(d.quality || '').slice(0, 40),
    note: String(d.note || '').slice(0, 200),
    checkedAt: d.checkedAt || '',
    ok: d.ok,
    status: d.status || '',
    dead: d.dead === true,
  };
}

const imagesOf = (...groups) => uniq(groups.flat().map((l) => (l && l.images ? l.images : [])).flat().map((i) => i.local || i.url || '').filter((u) => /^https?:|^\/uploads\//.test(u)));
const pickLocal = (list) => (list || []).find((u) => String(u).startsWith('/uploads/')) || '';

/** 富文本入库：含标签则清洗，纯文本则转段落 */
function toRichHtml(v = '') {
  const s = String(v || '');
  if (!s.trim()) return '';
  return /<[a-z][\s\S]*>/i.test(s) ? sanitizeHtml(s) : textToHtml(s);
}

function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/[\n,，、;；|]+/);
  return [v];
}
function splitTags(v) { return String(v).split(/[,，、;；|\s]+/).filter(Boolean); }
/** 分数统一为 0-10；<=5 视为五星制自动换算 */
function clampScore(v) {
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const ten = n <= 5 ? n * 2 : n;
  return Math.round(Math.min(10, Math.max(0, ten)) * 10) / 10;
}
function sanitizeMeta(meta = {}) {
  const out = {};
  for (const k of ['year', 'region', 'size', 'language', 'duration', 'developer', 'format', 'platform', 'publisher', 'updated']) {
    if (meta && meta[k]) out[k] = String(meta[k]).slice(0, 120);
  }
  return out;
}
function allProviders(r) {
  return uniq([...(r.downloads || []), ...(r.others || [])].map((d) => d.provider).filter(Boolean));
}
function stripForIndex(html = '') {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase().slice(0, 4000);
}
function tokenize(q = '') {
  return uniq(String(q).toLowerCase().split(/[\s,，、|]+/).map((s) => s.trim()).filter((s) => s.length >= 1)).slice(0, 8);
}
function makeSlug(title, id) {
  const base = String(title).toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '');
  return (base.slice(0, 24) || 'res') + '-' + String(id).slice(-6);
}
function colorFor(tag = '') {
  const palette = ['#7c5cff', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#f97316', '#a78bfa', '#22d3ee'];
  return palette[fnv(String(tag)) % palette.length];
}
function diffSummary(before, after) {
  const keys = ['title', 'type', 'tags', 'score', 'summary', 'content', 'cover', 'gallery', 'downloads', 'others', 'status', 'featured'];
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return changed.length ? changed.join('、') : '无字段变化';
}

function normalizeDb(input = {}) {
  const db = {
    meta: { version: SCHEMA_VERSION, createdAt: input.meta?.createdAt || NOW(), savedAt: NOW(), installedBy: 'aurora-vault' },
    settings: {
      siteName: 'AURORA 资源库', tagline: '极昼之下，好资源自带光', accent: '#7c5cff', theme: 'dark',
      defaultScore: 7.5, pageSize: 24, heroStats: true, allowUserSubmit: true, requireReview: true,
      mirrorImagesByDefault: true, icp: '', announcement: '', ...input.settings,
    },
    types: uniqTypes(input.types),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => ({ name: String(t.name || t), pinned: !!t.pinned, color: t.color || colorFor(t.name || t) })) : [],
    resources: Array.isArray(input.resources) ? input.resources : [],
    submissions: Array.isArray(input.submissions) ? input.submissions : [],
    sources: Array.isArray(input.sources) && input.sources.length ? input.sources : DEFAULT_SOURCES.map((s) => ({ ...s })),
    logs: Array.isArray(input.logs) ? input.logs : [],
    // 投票名册：{ 资源 id: { 访客令牌: 分数 } } / { 资源 id: { 访客令牌: 时间戳 } }
    // 用于「同一访客不能重复打分 / 重复收藏」，不进 publicResource
    ratings: input.ratings && typeof input.ratings === 'object' ? input.ratings : {},
    favs: input.favs && typeof input.favs === 'object' ? input.favs : {},
    archive: Array.isArray(input.archive) ? input.archive : [],
    stats: { counters: {}, daily: {}, recent: [], ...input.stats },
    admin: { user: input.admin?.user || 'admin', passHash: input.admin?.passHash || '', secret: input.admin?.secret || '', isDefault: input.admin?.isDefault !== false, sessions: {} },
  };
  return db;
}
function uniqTypes(list) {
  const base = [
    { key: '影视', name: '影视', color: '#f472b6', icon: '▶' },
    { key: '二次元', name: '二次元', color: '#38bdf8', icon: '✦' },
    { key: '游戏', name: '游戏', color: '#a78bfa', icon: '⎈' },
    { key: '应用', name: '应用', color: '#34d399', icon: '❏' },
    { key: '图书', name: '图书', color: '#fbbf24', icon: '❐' },
    { key: '教程', name: '教程', color: '#f97316', icon: '◉' },
    { key: '音乐', name: '音乐', color: '#22d3ee', icon: '♬' },
    { key: '素材', name: '素材', color: '#94a3b8', icon: '◈' },
    { key: '其他', name: '其他', color: '#cbd5e1', icon: '⊙' },
  ];
  const merged = [...base, ...(Array.isArray(list) ? list : [])];
  const seen = new Set();
  return merged.filter((t) => (seen.has(t.key) ? false : (seen.add(t.key), true)));
}
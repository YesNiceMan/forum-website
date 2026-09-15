// HTTP 服务：静态资源 + JSON API（零依赖：node:http / fs / crypto）
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, stat, mkdir, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

import { Store, completeness, normalizeLink, DOWNLOAD_TARGETS, linkKey } from './lib/store.mjs';
import { parseXlsx, parseCsv, toTable } from './lib/xlsx.mjs';
import { enrichDrafts, tableToDrafts, IMPORT_FIELDS } from './lib/importer.mjs';
import { enrichUrl, mirrorImage, safeUrl } from './lib/enrich.mjs';
import { runSources, SOURCE_KINDS } from './lib/sources.mjs';
import { classify, extractUrls, extractImages, PROVIDERS } from './lib/links.mjs';
import { registerAdmin } from './lib/admin-routes.mjs';
import { json, readJson, text, mimeOf, newId, NOW, truncate, uniq, mapLimit, clampInt, num, stripTags, sanitizeHtml, textToHtml, normalizeTitle } from './lib/util.mjs';

const publicify = (r) => ({ ...r, completeness: undefined });

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const WEB = path.join(ROOT, 'web');
/**
 * Serverless（Vercel）里应用目录是只读的，只有 /tmp 可写，
 * 所以云端把「数据文件」和「上传目录」指到临时盘，本地开发仍用仓库里的 data/ 与 web/uploads/。
 * 注意：/tmp 属于单个实例的临时盘，冷启动即清空，不能当数据库用（见 README「部署」一节）。
 */
const ON_SERVERLESS = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV);
const DATA = process.env.AURORA_DATA_DIR || (ON_SERVERLESS ? path.join(os.tmpdir(), 'aurora-data') : path.join(ROOT, 'data'));
const UPLOADS = process.env.AURORA_UPLOADS_DIR || (ON_SERVERLESS ? path.join(os.tmpdir(), 'aurora-uploads') : path.join(WEB, 'uploads'));
const PORT = Number(process.env.PORT || 5180);
const HOST = process.env.HOST || (ON_SERVERLESS ? '0.0.0.0' : '127.0.0.1');
const DEFAULT_ADMIN = { user: 'admin', pass: process.env.AURORA_ADMIN_PASS || 'aurora888' };

if (ON_SERVERLESS) await primeFromSnapshot();
const store = await new Store(DATA).init();

/**
 * Serverless 冷启动时 /tmp 是空的。若仓库里提交了 data/db.json（可选，见 README），
 * 就把它复制进临时盘，让云端至少能展示这份数据；写操作仍然只活在当前实例里。
 */
async function primeFromSnapshot() {
  try {
    const snapshot = path.join(ROOT, 'data', 'db.json');
    const target = path.join(DATA, 'db.json');
    if (!(await stat(snapshot).catch(() => null))) return;
    if (await stat(target).catch(() => null)) return;
    await mkdir(DATA, { recursive: true });
    await copyFile(snapshot, target);
    console.log('[serverless] 已从仓库快照初始化数据：' + path.relative(ROOT, snapshot));
  } catch (err) {
    console.warn('[serverless] 快照初始化跳过：' + err.message);
  }
}
if (!store.db.admin.passHash) {
  store.db.admin.user = DEFAULT_ADMIN.user;
  store.db.admin.secret = randomUUID();
  store.db.admin.passHash = hashPass(DEFAULT_ADMIN.pass, store.db.admin.secret);
  store.db.admin.isDefault = !process.env.AURORA_ADMIN_PASS;
  store.log('system', '已创建默认管理员账号 ' + DEFAULT_ADMIN.user + '（首次启动使用默认口令，请尽快在后台「站点设置」中修改）');
  await store.save();
  await ensureSeed();
}

function hashPass(pass, secret) {
  return createHash('sha256').update(secret + '::' + pass).digest('hex');
}

async function ensureSeed() {
  if (store.db.resources.length) return;
  let seed;
  try {
    seed = await import('./seed.mjs');
  } catch (err) {
    console.warn('[seed] 跳过示例数据：' + err.message);
    return;
  }
  const { seedResources, seedSubmissions, seedLogs } = seed;
  for (const r of seedResources()) {
    const rec = store.createResource(r, 'seed');
    rec.views = r.views || 0;
    rec.favorites = r.favorites || 0;
    rec.votes = r.votes || 0;
    rec.slug = r.slug || rec.slug;
    rec.id = r.id || rec.id;
  }
  for (const s of seedSubmissions()) store.db.submissions.push(s);
  for (const l of seedLogs()) store.db.logs.unshift(l);
  store.addTags(store.db.resources.flatMap((r) => r.tags));
  store.db.types.forEach((t) => { t.count = store.db.resources.filter((r) => r.type === t.key).length; });
  store.db.tags.forEach((t) => { t.count = store.db.resources.filter((r) => r.tags.includes(t.name)).length; });
  await store.flush();
}

// ---------- 速率限制（抓取类接口） ----------
const buckets = new Map();
function rateOk(key, perWindow = 30, windowMs = 60000) {
  const now = Date.now();
  const b = buckets.get(key) || { hits: [], };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= perWindow) return false;
  b.hits.push(now);
  buckets.set(key, b);
  return true;
}

// ---------- 会话 ----------
/**
 * 会话令牌是自包含的签名串（HMAC-SHA256），不再依赖「某一台实例的某一份 db.json」。
 * 旧实现只在库里存一个随机 sid，于是这三种情况都会「刷新即掉线」：
 *   1) 本地重启 / npm run dev（--watch）—— 读库时 sessions 被重置成空表；
 *   2) Vercel 冷启动 —— /tmp 被清空，sid 找不回来；
 *   3) 多实例 / 频繁扩缩容 —— A 实例发的 cookie 到 B 实例查无此人。
 * 现在令牌自带「谁、何时签发、能用到什么时候」，服务端只留一张吊销名册管退出登录；
 * 库里的 sessions 退化成「在线会话」视图，丢了也不影响继续登录。
 */
const SESSION_COOKIE = 'aurora_sid';
const SESSION_TTL_MS = 12 * 3600 * 1000;          // 默认 12 小时
const REMEMBER_TTL_MS = 30 * 24 * 3600 * 1000;    // 勾选「记住登录」= 30 天
function cookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
const b64url = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64url = (s) => { try { return Buffer.from(String(s), 'base64url').toString('utf8'); } catch { return ''; } };
/** 签名密钥 = 口令 salt（改口令即全体作废）+ 可选的部署级固定密钥（多实例共享同一密钥） */
function sessionSecret() {
  return createHash('sha256')
    .update((process.env.AURORA_SESSION_SECRET || '') + '|' + (store.db.admin.secret || '') + '|aurora-session-v1')
    .digest();
}
function issueToken(user, ttlMs) {
  const now = Date.now();
  const payload = { u: user, j: randomUUID().replace(/-/g, ''), iat: now, exp: now + ttlMs, ttl: ttlMs, r: ttlMs > SESSION_TTL_MS ? 1 : 0 };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verifyToken(token) {
  const full = String(token || '');
  const dot = full.indexOf('.');
  if (dot < 0) return null;
  const body = full.slice(0, dot);
  const sig = full.slice(dot + 1);
  const want = Buffer.from(createHmac('sha256', sessionSecret()).update(body).digest('base64url'), 'utf8');
  const got = Buffer.from(sig, 'utf8');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p;
  try { p = JSON.parse(unb64url(body)); } catch { return null; }
  if (!p || typeof p.u !== 'string' || !Number(p.exp)) return null;
  if (p.exp < Date.now()) return null;
  // 改口令 / 一键下线：按签发时间整批作废；退出登录：按 jti 单个作废
  if ((Number(store.db.admin.invalidBefore) || 0) > Number(p.iat || 0)) return null;
  if (isRevoked(p.j)) return null;
  return { sid: p.j, user: p.u, created: Number(p.iat) || 0, expires: Number(p.exp) || 0, last: Date.now(), ttl: Number(p.ttl) || SESSION_TTL_MS, remember: !!p.r };
}
function isRevoked(jti) {
  const list = store.db.admin.revoked || [];
  return list.some((r) => r.j === jti);
}
function revoke(jti, exp) {
  if (!jti) return;
  const list = (store.db.admin.revoked || (store.db.admin.revoked = []));
  if (!list.some((r) => r.j === jti)) list.push({ j: jti, exp: Number(exp) || Date.now() + REMEMBER_TTL_MS });
  const now = Date.now();
  store.db.admin.revoked = list.filter((r) => r.exp > now).slice(-200);
  store.save();
}
function sessionOf(req) {
  const raw = (req && req.headers && (cookie(req, SESSION_COOKIE) || req.headers['x-aurora-session'])) || '';
  if (!raw) return null;
  if (raw.indexOf('.') > 0) return verifyToken(raw);
  // 升级前的随机 sid cookie：库里查得到就继续放行（下次登录自动换成签名令牌）
  const legacy = (store.db.admin.sessions || {})[raw];
  if (!legacy) return null;
  if (legacy.expires < Date.now()) {
    delete store.db.admin.sessions[raw];
    store.save();
    return null;
  }
  return { sid: raw, user: legacy.user, created: legacy.created || Date.now(), expires: legacy.expires, last: legacy.last || Date.now(), ttl: SESSION_TTL_MS, remember: !!legacy.remember };
}
/** 给前端看的会话视图：只有「是不是登录了 / 用到什么时候」，不发令牌 */
function sessionView(req) {
  const s = sessionOf(req);
  return { authed: !!s, user: s ? s.user : null, expires: s ? s.expires : 0, remember: s ? !!s.remember : false };
}
function createSession(user, options = {}) {
  const ttl = options.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const token = issueToken(user, ttl);
  const s = verifyToken(token);
  const book = (store.db.admin.sessions || (store.db.admin.sessions = {}));
  book[s.sid] = { user, created: s.created, expires: s.expires, last: Date.now(), remember: !!options.remember };
  for (const [k, v] of Object.entries(book)) if (v.expires < Date.now()) delete book[k];
  store.save();
  return { token, ttl };
}
function secureFlag(req) {
  const proto = String((req && req.headers && req.headers['x-forwarded-proto']) || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' ? '; Secure' : '';
}
function setSession(res, token, req, ttlMs = SESSION_TTL_MS) {
  const maxAge = Math.max(1, Math.round((Number(ttlMs) || SESSION_TTL_MS) / 1000));
  addCookie(res, SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + secureFlag(req));
}
/**
 * 滑动续期：只要还在用就把过期时间推回去（剩余不足 1/3 时续一次），
 * 不会填表填到一半被踢下线；续期通过 Set-Cookie 完成，前端无感。
 */
function touchSession(req, res) {
  const s = sessionOf(req);
  if (!s || !(s.ttl > 0)) return s;
  if (s.expires - Date.now() > s.ttl / 3) return s;
  const next = s.remember ? REMEMBER_TTL_MS : SESSION_TTL_MS;
  const token = issueToken(s.user, next);
  if (res) setSession(res, token, req, next);
  const n = verifyToken(token);
  if (store.db.admin.sessions) store.db.admin.sessions[n.sid] = { user: n.user, created: n.created, expires: n.expires, last: Date.now(), remember: !!s.remember };
  store.save();
  return n;
}
function clearSession(req, res, sid) {
  const s = sessionOf(req);
  if (s) revoke(s.sid, s.expires);
  if (sid && store.db.admin.sessions) delete store.db.admin.sessions[sid];
  store.save();
  addCookie(res, SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secureFlag(req));
}
/**
 * 访客身份：只用来判断「这台设备有没有投过票」。
 * 随机 uuid 放在 HttpOnly cookie 里，服务端只存它的 sha1 短令牌，
 * 不落 IP / UA / 任何可识别信息，也不用登录。
 */
const VID_COOKIE = 'aurora_vid';
function addCookie(res, pair) {
  const prev = res.getHeader('set-cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [String(prev)]) : [];
  res.setHeader('set-cookie', list.concat(pair));
}
function visitorOf(req, res, issue = true) {
  const raw = cookie(req, VID_COOKIE);
  if (/^[0-9a-f]{32}$/.test(raw)) return raw;
  if (!issue || !res) return '';
  const vid = randomUUID().replace(/-/g, '');
  addCookie(res, VID_COOKIE + '=' + vid + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000');
  return vid;
}
const voteKey = (vid) => createHash('sha1').update(vid + '|aurora-vote').digest('hex').slice(0, 20);
/** 打分：同一访客再次提交 = 改分，票数只加一次（原来每点一次星星就多一票） */
function voteResource(id, vid, score) {
  const r = store.findResource(id);
  if (!r) return null;
  const book = store.db.ratings[id] || (store.db.ratings[id] = {});
  const key = voteKey(vid);
  const prev = Number(book[key]) || 0;
  if (prev && prev === score) return { resource: r, mode: 'same', myScore: score };
  const votes = Math.max(0, Number(r.votes) || 0);
  // 老数据没有 ratingSum，用 score×votes 反推总分
  const sum = Number(r.ratingSum) || Math.round((Number(r.score) || 0) * votes * 10) / 10;
  const nextSum = prev ? sum - prev + score : sum + score;
  const nextVotes = prev ? votes : votes + 1;
  book[key] = score;
  r.ratingSum = Math.round(nextSum * 10) / 10;
  r.votes = nextVotes;
  r.score = Math.min(10, Math.max(0, Math.round((r.ratingSum / Math.max(1, nextVotes)) * 10) / 10));
  r.updatedAt = NOW();
  if (!prev) store.track('rate', { id: r.id });
  store.save();
  return { resource: r, mode: prev ? 'update' : 'new', myScore: score };
}
/** 收藏：改成幂等开关，刷新页面反复点不会再水+a 收藏数 */
function favResource(id, vid, on) {
  const r = store.findResource(id);
  if (!r) return null;
  const book = store.db.favs[id] || (store.db.favs[id] = {});
  const key = voteKey(vid);
  const had = !!book[key];
  const want = on === undefined ? !had : !!on;
  if (want !== had) {
    if (want) book[key] = NOW(); else delete book[key];
    r.favorites = Math.max(0, (Number(r.favorites) || 0) + (want ? 1 : -1));
    store.save();
  }
  return { resource: r, liked: want, changed: want !== had };
}
function requireAdmin(req, res) {
  const s = touchSession(req, res);
  if (!s) {
    json(res, 401, { ok: false, error: 'unauthorized', message: '登录状态已过期，请在后台重新登录' });
    return null;
  }
  return s;
}

// ---------- 统计刷新 ----------
function recomputeCounts() {
  const pub = store.db.resources;
  store.db.types.forEach((t) => { t.count = pub.filter((r) => r.type === t.key).length; });
  store.db.tags.forEach((t) => { t.count = pub.filter((r) => r.tags.includes(t.name)).length; });
}

function publicSettings() {
  const s = store.db.settings;
  return {
    siteName: s.siteName, tagline: s.tagline, accent: s.accent, pageSize: s.pageSize,
    allowUserSubmit: s.allowUserSubmit, requireReview: s.requireReview, announcement: s.announcement,
    defaultScore: s.defaultScore, mirrorImagesByDefault: s.mirrorImagesByDefault, footerNote: s.footerNote || '',
    homeTitle: s.homeTitle || '', homeSubtitle: s.homeSubtitle || '', searchHints: s.searchHints || [],
  };
}
function dashboardStats() {
  const rs = store.db.resources;
  const counts = store.db.stats.counters;
  const week = NOW().slice(0, 10);
  return {
    resources: rs.length,
    published: rs.filter((r) => r.status === 'published').length,
    drafts: rs.filter((r) => r.status === 'draft').length,
    archived: rs.filter((r) => r.status === 'archived').length,
    submissions: store.db.submissions.filter((s) => s.status === 'pending').length,
    tags: store.db.tags.length,
    types: store.db.types.length,
    downloads: rs.reduce((n, r) => n + r.downloads.length, 0),
    others: rs.reduce((n, r) => n + r.others.length, 0),
    images: rs.reduce((n, r) => n + r.gallery.length, 0),
    incomplete: rs.filter((r) => completeness(r).percent < 70).length,
    avgScore: rs.length ? Math.round((rs.reduce((n, r) => n + (r.score || 0), 0) / rs.length) * 10) / 10 : 0,
    views: rs.reduce((n, r) => n + (r.views || 0), 0),
    searches: counts.search || 0,
    todaySearches: (store.db.stats.daily[week] || {}).search || 0,
    providers: countBy(rs.flatMap((r) => r.downloads.map((d) => d.providerName || d.provider))),
    typeCounts: store.db.types.map((t) => ({ key: t.key, name: t.name, color: t.color, icon: t.icon, count: t.count || 0 })),
    topViewed: [...rs].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8).map((r) => ({ id: r.id, title: r.title, views: r.views || 0, type: r.type })),
    hotTags: store.db.tags.slice().sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 18).map((t) => ({ name: t.name, count: t.count || 0, color: t.color })),
    daily: Object.entries(store.db.stats.daily).sort((a, b) => a[0].localeCompare(b[0])).slice(-14).map(([day, v]) => ({ day, ...v })),
  };
}
function countBy(list) {
  const m = new Map();
  for (const k of list.filter(Boolean)) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

// ---------- 路由 ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, opts });
const RE = {
  resource: /^\/api\/resources(?:\/([\w-]+))?$/,
  rate: /^\/api\/resources\/([\w-]+)\/(rate|like|favorite)$/,
  admin: /^\/api\/admin\/([\w-]+(?:\/[\w-]+)*)(?:\/([\w-]+))?$/,
};

async function handle(req, res) {
  const rawUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let pathname = rawUrl.pathname;
  try { pathname = decodeURIComponent(pathname); } catch {}
  const url = { pathname, searchParams: rawUrl.searchParams, href: rawUrl.href };
  const p = pathname;
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const ip = (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim();
  res.setHeader('x-powered-by', 'AuroraVault');
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': 'content-type,x-aurora-session', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-max-age': '600' });
    return res.end();
  }
  try {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern instanceof RegExp ? r.pattern.exec(p) : p === r.pattern ? [p] : null;
      if (!m) continue;
      if (r.opts.auth && !requireAdmin(req, res)) return;
      const body = method === 'POST' || method === 'PATCH' || method === 'PUT' ? await readJson(req) : {};
      const ctx = { url, query: url.searchParams, body, params: m.slice(1), ip, req, res };
      const out = await r.handler(ctx);
      if (out !== undefined && !res.headersSent) json(res, 200, { ok: true, ...toResponse(out) });
      return;
    }
    if (p.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not_found', message: '接口不存在：' + p });
    return await serveStatic(req, res, p);
  } catch (err) {
    const status = err.status || (err.code === 'ENOENT' ? 404 : 500);
    if (p.startsWith('/api/')) return json(res, status, { ok: false, error: err.code || 'server_error', message: err.message || '服务异常' });
    return text(res, status, '错误 ' + status + '：' + (err.message || '服务异常'), { 'content-type': 'text/plain; charset=utf-8' });
  }
}
function toResponse(v) {
  if (v == null) return {};
  if (Array.isArray(v)) return { items: v };
  if (typeof v === 'object') return v;
  return { value: v };
}

// ---------- 公共接口 ----------
route('GET', /^\/api\/bootstrap$/, ({ req, res }) => {
  // 首屏就发访客令牌，之后刷新页面也能知道自己那票还在不在
  visitorOf(req, res);
  // 顺手给后台做滑动续期。这里原来是 sessionOf({ headers: {} })，永远读不到 Cookie，
  // 于是后台每次刷新、或从前台切回来都判定「没登录」，只能重新输口令。
  touchSession(req, res);
  return {
  settings: publicSettings(),
  types: store.db.types.map((t) => ({ key: t.key, name: t.name, color: t.color, icon: t.icon, count: t.count || 0 })),
  tags: store.db.tags.slice().sort((a, b) => (b.count || 0) - (a.count || 0) || a.name.localeCompare(b.name, 'zh')).slice(0, 60),
  fields: IMPORT_FIELDS,
  providers: PROVIDERS.map((p) => ({ key: p.key, name: p.name, kind: p.kind, color: p.color })),
  sourceKinds: SOURCE_KINDS,
  sources: store.db.sources.filter((s) => s.enabled).map((s) => ({ id: s.id, name: s.name, kind: s.kind, mode: s.mode, color: s.color, icon: s.icon, note: s.note || '' })),
  stats: {
    resources: store.db.resources.filter((r) => r.status === 'published').length,
    downloads: store.db.resources.reduce((n, r) => n + r.downloads.length, 0),
    images: store.db.resources.reduce((n, r) => n + r.gallery.length, 0),
    tags: store.db.tags.length,
    sources: store.db.sources.filter((s) => s.enabled && s.mode !== 'url').length,
    jump: store.db.sources.filter((s) => s.enabled && s.mode === 'url').length,
  },
  session: sessionView(req),
  spotlight: store.db.resources
    .filter((r) => r.status === 'published')
    .sort((x, y) => (y.featured ? 1 : 0) - (x.featured ? 1 : 0) || (y.score || 0) - (x.score || 0))
    .slice(0, 3)
    .map((r) => ({ id: r.id, title: r.title, cover: r.cover, type: r.type, score: r.score })),
    version: '1.0.0',
  };
});

route('GET', /^\/api\/resources$/, ({ query }) => {
  const result = store.search({
    q: query.get('q') || '',
    types: csv(query.get('type')),
    tags: csv(query.get('tag')),
    providers: csv(query.get('provider')),
    status: query.get('status') || 'published',
    sort: query.get('sort') || (query.get('q') ? 'relevance' : 'newest'),
    page: clampInt(query.get('page'), 1, 500, 1),
    pageSize: clampInt(query.get('pageSize') || store.db.settings.pageSize, 1, 100, 24),
  });
  return { ...result, fields: null, types: store.db.types.map((t) => ({ key: t.key, count: store.db.resources.filter((r) => r.type === t.key).length })) };
});

route('GET', RE.resource, ({ params, req, res }) => {
  const id = params[0];
  if (!id) return json(res, 400, { ok: false, message: '缺少资源 ID' });
  const r = store.findResource(id);
  if (!r) return json(res, 404, { ok: false, error: 'not_found', message: '资源不存在或已删除' });
  r.views = (r.views || 0) + 1;
  store.track('view', { id: r.id });
  store.save();
  const related = store.db.resources
    .filter((x) => x.id !== r.id && x.status === 'published')
    .map((x) => ({ x, s: x.tags.filter((t) => r.tags.includes(t)).length * 3 + (x.type === r.type ? 2 : 0) }))
    .filter((y) => y.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, 6)
    .map((y) => ({ id: y.x.id, title: y.x.title, cover: y.x.cover, type: y.x.type, score: y.x.score, tags: y.x.tags.slice(0, 4) }));
  // 只读访客 cookie（不在 GET 上发 cookie），把「我自己打过几分 / 收没收藏」带回前端
  const key = visitorOf(req, null, false);
  const token = key ? voteKey(key) : '';
  return {
    resource: { ...publicify(r), ratingSum: undefined, myScore: token ? Number((store.db.ratings[id] || {})[token]) || 0 : 0, liked: token ? !!(store.db.favs[id] || {})[token] : false },
    related,
    completeness: completeness(r),
  };
});

route('POST', RE.rate, ({ params, body, req, res }) => {
  const r = store.findResource(params[0]);
  if (!r) return json(res, 404, { ok: false, message: '资源不存在' });
  const action = params[1];
  const vid = visitorOf(req, res);
  if (!vid) return json(res, 400, { ok: false, message: '需要浏览器允许 Cookie 才能计分' });
  if (action === 'rate') {
    const score = num(body.score, { min: 1, max: 10, dflt: 0 });
    if (!score) return json(res, 400, { ok: false, message: '分数需在 1-10' });
    if (!rateOk('rate:' + voteKey(vid) + ':' + r.id, 6, 60000)) return json(res, 429, { ok: false, message: '评分过于频繁，请稍后再试' });
    const out = voteResource(r.id, vid, score);
    const message = out.mode === 'same'
      ? '你已经给这部作品打过 ' + out.myScore + ' 分了，不会重复计数'
      : out.mode === 'update' ? '已按你的新评分更新，票数不变' : '评分成功，已计入';
    return { resource: { id: out.resource.id, score: out.resource.score, votes: out.resource.votes }, myScore: out.myScore, mode: out.mode, message };
  }
  const out = favResource(r.id, vid, body.on);
  return { resource: { id: out.resource.id, favorites: out.resource.favorites }, liked: out.liked, changed: out.changed, message: out.liked ? '已计入收藏' : '已取消收藏' };
});

// ---------- 访客给已有资源补充来源（详情页「找更多来源 → 加入该资源」） ----------
route('POST', /^\/api\/resources\/([\w-]+)\/contribute$/, async ({ params, body, req, res, ip }) => {
  const r = store.findResource(params[0]);
  if (!r || r.status !== 'published') return json(res, 404, { ok: false, message: '资源不存在或已下架' });
  const url = String(body.url || '').trim().slice(0, 500);
  if (!/^(https?:\/\/|magnet:|ed2k:\/\/|thunder:\/\/)/i.test(url)) return json(res, 400, { ok: false, message: '只接受 http(s) / 磁力 / ed2k / 迅雷链接' });
  const sess = sessionOf(req);
  if (!sess && !store.db.settings.allowUserSubmit) return json(res, 403, { ok: false, message: '站点已关闭投稿' });
  if (!rateOk('contribute:' + (sess ? 'admin' : voteKey(ip || 'anon')), 20, 60000)) return json(res, 429, { ok: false, message: '提交过于频繁，请稍后再试' });
  const link = normalizeLink({ url, label: body.label, code: body.code, size: body.size, quality: body.quality, note: body.note || (sess ? '管理员追加' : '访客补充') });
  if (!link) return json(res, 400, { ok: false, message: '无法解析该链接' });
  const into = DOWNLOAD_TARGETS.has(link.kind) ? '资源下载' : '其他来源';
  // 先按 URL（忽略尾部斜杠 / 尾标点）挡掉重复，省得访客白提交一条待审
  const key = linkKey; // 见 store.mjs：忽略尾部斜杠 / 标点后比较
  const mine = key(link.url);
  if ([...r.downloads, ...r.others].some((x) => key(x.url) === mine)) {
    return { mode: 'duplicate', field: into, message: '这条来源已经在资源里了', resource: { id: r.id, downloads: r.downloads.length, others: r.others.length } };
  }
  // 管理员、或站点设为「无需审核」时直接并入；其余进待审队列，由后台「并入该资源」落库
  if (sess || !store.db.settings.requireReview) {
    const out = store.mergeLinks(r.id, [link], sess ? sess.user : 'visitor:' + (body.contact || '匿名'));
    if (!out) return json(res, 404, { ok: false, message: '资源不存在' });
    if (!out.report.added) {
      return { mode: 'duplicate', field: into, message: '这条来源已经在资源里了', resource: { id: r.id, downloads: out.resource.downloads.length, others: out.resource.others.length } };
    }
    recomputeCounts();
    store.log('resource', (sess ? '管理员' : '访客') + '补充来源：' + out.resource.title, { id: out.resource.id, url, field: into });
    store.track('contribute', { id: out.resource.id });
    await store.save();
    return { mode: 'appended', field: into, message: '已加入该资源的「' + into + '」', resource: { id: out.resource.id, downloads: out.resource.downloads.length, others: out.resource.others.length, updatedAt: out.resource.updatedAt } };
  }
  const toDownloads = DOWNLOAD_TARGETS.has(link.kind);
  const sub = store.createSubmission({
    kind: 'source',
    resourceId: r.id,
    resourceTitle: r.title,
    title: r.title,
    type: r.type,
    tags: r.tags,
    summary: '补充' + into + '：' + (link.label || link.providerName || url),
    contact: body.contact || '',
    sourceUrl: url,
    downloads: toDownloads ? [link] : [],
    others: toDownloads ? [] : [link],
    note: String(body.note || '').slice(0, 300),
    ip,
  });
  store.log('submission', '收到来源补充待审：' + r.title, { id: sub.id, resourceId: r.id, url });
  await store.save();
  return { mode: 'pending', field: into, submission: { id: sub.id }, message: '已提交，管理员确认后会并入《' + r.title + '》' };
});

/**
 * 详情页「找更多来源」的写入接口：把在聚合搜索里点到的文字 / 图片
 * 直接插进资源的对应位置（简介 / 正文 / 封面 / 图集 / 标签 / 下载 / 其他来源 / 元数据）。
 * 管理员会话 -> 立即写入；访客 -> 按站点设置，走待审队列，后台点「应用」才落库。
 */
route('POST', /^\/api\/resources\/([\w-]+)\/insert$/, async ({ params, body, req, res, ip }) => {
  const r = store.findResource(params[0]);
  if (!r) return json(res, 404, { ok: false, message: '资源不存在或已删除' });
  const rawInserts = body.inserts || body.insert || body;
  const inserts = normalizeInserts(rawInserts);
  // 白名单外的位置不静默丢弃：明确回传「这一格写不进去」
  const dropped = droppedFields(rawInserts, inserts);
  if (!inserts.length) return json(res, 400, { ok: false, message: '没有可插入的内容（请先选中要写入的文字或图片）' });
  const sess = sessionOf(req);
  const source = truncate(String(body.source || r.sourceName || '聚合搜索'), 60);
  if (!sess && !store.db.settings.allowUserSubmit) return json(res, 403, { ok: false, message: '站点已关闭前台投稿' });
  if (!rateOk('insert:' + (sess ? 'admin' : voteKey(ip || 'anon')), 24, 60000)) return json(res, 429, { ok: false, message: '插入过于频繁，请稍后再试' });
  if (r.status !== 'published' && !sess) return json(res, 403, { ok: false, message: '该资源未发布，暂不接受补充' });
  // 外链图片先镜像到本地再入库：省得资源里躺着一堆会被防盗链掐掉的地址
  const mirrored = await mirrorInsertImages(inserts);
  // 管理员、或站点关闭了审核 —— 直接写
  if (sess || !store.db.settings.requireReview) {
    const out = store.insertInto(r.id, mirrored, { actor: sess ? sess.user : 'visitor:' + (body.contact || '匿名'), overwrite: false, source });
    if (!out) return json(res, 404, { ok: false, message: '资源不存在' });
    if (dropped.length) out.report.invalid.push(...dropped);
    if (!out.applied) {
      return { mode: 'noop', report: out.report, message: '这些内容资源里已经有了，未重复写入', resource: resourceBrief(out.resource) };
    }
    recomputeCounts();
    const fields = [...out.report.filled, ...out.report.appended, ...out.report.duplicate].map((x) => x.label || x.key).join('、');
    store.log('resource', (sess ? '管理员' : '访客') + '插入来源内容：' + out.resource.title, { id: out.resource.id, fields, source });
    store.track('insert', { id: out.resource.id });
    await store.save();
    return {
      mode: 'inserted',
      report: out.report,
      completeness: out.completeness,
      resource: resourceBrief(out.resource),
      message: '已写入：' + (fields || '相关内容') + '（完整度 ' + out.completeness.percent + '%）' + (dropped.length ? '；' + dropped.map((d) => d.field).join('、') + ' 不是可写入的位置' : ''),
    };
  }
  const sub = store.createSubmission({
    kind: 'patch',
    resourceId: r.id,
    resourceTitle: r.title,
    title: r.title,
    type: r.type,
    tags: [],
    summary: '补充内容：' + inserts.map((i) => i.field).filter(Boolean).join(' / ').slice(0, 120),
    contact: body.contact || '',
    sourceUrl: String(body.pageUrl || '').slice(0, 300),
    inserts: mirrored,
    note: source,
    ip,
  });
  store.log('submission', '收到内容补充待审：' + r.title, { id: sub.id, resourceId: r.id, fields: inserts.map((i) => i.field) });
  await store.save();
  return { mode: 'pending', submission: { id: sub.id }, fields: inserts.map((i) => i.field), message: '已提交，管理员确认后写入《' + r.title + '》' };
});
/** 白名单外被丢掉的位置：回填成 invalid 报告，前端能明确说「这一格写不进去」 */
const INSERT_FIELDS_ALLOW = new Set(['title', 'type', 'score', 'summary', 'content', 'cover', 'gallery', 'image', 'tags', 'downloads', 'others', 'sourceUrl', 'meta', 'notes']);
function droppedFields(input, kept) {
  const list = Array.isArray(input) ? input : Array.isArray(input && input.inserts) ? input.inserts : [];
  const keptFields = new Set(kept.map((k) => k.field));
  const out = [];
  for (const item of list) {
    const field = String((item && item.field) || '').trim();
    if (!field) continue;
    if (!INSERT_FIELDS_ALLOW.has(field) || !keptFields.has(field)) out.push({ field, reason: INSERT_FIELDS_ALLOW.has(field) ? '内容为空或格式不对' : '不是可写入的位置' });
  }
  return out.slice(0, 24);
}
/** 只保留白名单字段，值统一做长度裁剪；具体写入规则在 store.insertInto 里 */
function normalizeInserts(input) {
  const list = Array.isArray(input) ? input : [input];
  const allow = new Set(['title', 'type', 'score', 'summary', 'content', 'cover', 'gallery', 'image', 'tags', 'downloads', 'others', 'sourceUrl', 'meta', 'notes']);
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const field = String(item.field || '').trim();
    if (!allow.has(field)) continue;
    let value = item.value;
    if (typeof value === 'string') value = value.slice(0, 20000);
    else if (Array.isArray(value)) value = value.slice(0, 40).map((v) => (typeof v === 'string' ? v.slice(0, 400) : v && typeof v === 'object' ? trimObj(v) : v));
    else if (value && typeof value === 'object') value = trimObj(value);
    if (value === undefined || value === null || value === '') continue;
    out.push({ field, value });
  }
  return out.slice(0, 24);
}
/**
 * 把 inserts 里的外链图片转存到 /uploads（cover / gallery / image 三种位置）。
 * 镜像失败不阻断：保留原始外链，只在 note 里说明「外链」，避免「点了没反应」。
 */
async function mirrorInsertImages(inserts = []) {
  if (!store.db.settings.mirrorImagesByDefault) return inserts;
  const out = [];
  for (const item of inserts) {
    const v = item.value;
    const patchImage = async (img) => {
      const url = String((img && img.url) || (typeof img === 'string' ? img : ''));
      if (!/^https?:\/\//i.test(url)) return img;
      const local = await mirrorImage(url, UPLOADS).catch(() => '');
      if (!local) return img;
      return typeof img === 'string' ? local : { ...img, url: local, remote: url };
    };
    if (item.field === 'cover' || item.field === 'image' || item.field === 'gallery') {
      out.push({ ...item, value: await patchImage(v) });
    } else if (item.field === 'downloads' || item.field === 'others') {
      out.push({ ...item, value: typeof v === 'object' && v && /^https?:\/\//i.test(String(v.url || '')) && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(String(v.url)) ? await patchImage(v) : v });
    } else out.push(item);
  }
  return out;
}
function trimObj(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (['url', 'caption', 'alt', 'label', 'code', 'size', 'quality', 'note', 'title', 'year', 'region', 'format', 'duration', 'developer', 'language', 'publisher', 'provider', 'kind'].includes(k)) out[k] = String(v ?? '').slice(0, 400);
  }
  return out;
}
const resourceBrief = (r) => ({
  id: r.id, title: r.title, type: r.type, tags: r.tags, score: r.score, summary: r.summary, content: r.content,
  cover: r.cover, gallery: r.gallery, downloads: r.downloads, others: r.others, sourceUrl: r.sourceUrl, meta: r.meta, updatedAt: r.updatedAt,
});

route('POST', /^\/api\/detect$/, ({ body, res, ip }) => {
  const text0 = String(body.text || '');
  if (!text0) return json(res, 400, { ok: false, message: '请粘贴要解析的文本' });
  const urls = extractUrls(text0);
  const images = extractImages(text0);
  return {
    title: (text0.split(/\n/).find((l) => l.trim().length > 2 && !/^https?:/i.test(l.trim())) || '').slice(0, 80).trim(),
    summary: truncate(stripTags(text0).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' '), 160),
    tags: uniq((text0.match(/#([\w\u4e00-\u9fa5]{1,12})/g) || []).map((s) => s.slice(1))).slice(0, 10),
    score: num((/(?:评分|豆瓣|IMDb|score)[\s:：]*([0-9](?:\.[0-9])?)/i.exec(text0) || [])[1], { min: 0, max: 10, dflt: 0 }),
    year: ((/(20[0-4]\d|19[89]\d)/.exec(text0) || [])[1] || ''),
    size: ((/(?:[0-9]+(?:\.[0-9]+)?\s*(?:GB|MB|TB))/i.exec(text0) || [])[0] || ''),
    links: urls.map((u) => { const c = classify(u, text0); return c ? { url: u, label: c.providerName, provider: c.provider, kind: c.kind, color: c.color, code: c.code || '' } : null; }).filter(Boolean),
    images,
    downloadCandidates: urls.filter((u) => ['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes((classify(u) || {}).kind)),
    sourceCandidates: urls.filter((u) => ['web', 'site', 'video', 'doc'].includes((classify(u) || {}).kind)),
  };
});

route('POST', /^\/api\/enrich$/, async ({ body, res, ip }) => {
  if (!rateOk('enrich:' + ip, 40, 60000)) return json(res, 429, { ok: false, error: 'too_many', message: '识别过于频繁，请稍候再试' });
  const urls = uniq([].concat(body.url || [], (Array.isArray(body.urls) ? body.urls : []))).filter(Boolean).slice(0, 40);
  if (!urls.length) return json(res, 400, { ok: false, message: '缺少链接' });
  const mirror = body.mirror === undefined ? !!store.db.settings.mirrorImagesByDefault : !!body.mirror;
  const out = await mapLimit(urls, Math.min(6, urls.length), (u) => enrichUrl(u, { mirrorImages: mirror, imageLimit: num(body.imageLimit, { min: 1, max: 12, dflt: 4 }), uploadDir: UPLOADS }));
  const items = out.map((o) => ({ url: o.url, ok: o.ok, result: o.ok ? publicResult(o.value) : null, error: o.ok ? '' : o.error || o.value.warn }));
  return { items, mirror };
});
function publicResult(r) {
  return {
    url: r.url, kind: r.kind, provider: r.provider, providerName: r.providerName, color: r.color, code: r.code || '',
    title: r.title || '', description: r.description || '', keywords: r.keywords || '', siteName: r.siteName || '',
    published: r.published || '', author: r.author || '', favicon: r.favicon || '', infoHash: r.infoHash || '',
    text: r.text || '', textPreview: r.textPreview || '', headings: r.headings || [],
    images: (r.images || []).slice(0, 18).map((i) => ({ url: i.local || i.url, remote: i.url, alt: i.alt || '', source: i.source })),
    links: (r.links || []).slice(0, 20), ok: !!r.ok, warn: r.warn || '', metadataOnly: !!r.metadataOnly, finalUrl: r.finalUrl || r.url,
  };
}

// 图片中转（远程防盗链 / 混合内容兜底）
route('GET', /^\/api\/proxy$/, async ({ query, res, ip }) => {
  const target = query.get('url') || '';
  if (!rateOk('proxy:' + ip, 240, 60000)) {
    res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('too many requests');
  }
  const local = await mirrorImage(target, UPLOADS).catch(() => '');
  if (local) {
    res.writeHead(302, { location: local, 'cache-control': 'public, max-age=86400' });
    return res.end();
  }
  const s = safeUrl(target);
  if (!s) {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    return res.end(fallbackSvg(truncate(query.get('label') || '图片不可用', 12)));
  }
  try {
    const r = await fetch(s.href, { headers: { 'user-agent': 'Mozilla/5.0 (AuroraVault/1.0)', referer: s.origin + '/' }, redirect: 'follow', signal: AbortSignal.timeout(9000) });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok || !ct.startsWith('image/')) {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(fallbackSvg(truncate(query.get('label') || '图片不可用', 12)));
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(200, { 'content-type': ct, 'cache-control': 'public, max-age=86400' });
    return res.end(buf);
  } catch {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    return res.end(fallbackSvg(truncate(query.get('label') || '图片不可用', 12)));
  }
});
function fallbackSvg(label = '图片') {
  const safe = String(label).replace(/[<>&]/g, ' ');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#141a2b"/><stop offset="1" stop-color="#2a1f4a"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><text x="50%" y="50%" fill="#8b93b0" font-size="24" font-family="sans-serif" text-anchor="middle">' + safe + '</text></svg>';
}
export { fallbackSvg };

// ---------- 聚合搜索 ----------
route('POST', /^\/api\/search$/, async ({ body, res, ip }) => {
  const q = truncate(String(body.q || ''), 80).trim();
  if (!q) return json(res, 400, { ok: false, message: '请输入搜索词' });
  if (!rateOk('search:' + ip, 24, 60000)) return json(res, 429, { ok: false, error: 'too_many', message: '搜索过于频繁，请稍候再试' });
  store.track('search', { q });
  store.log('search', '聚合搜索：' + q, { q });
  const kinds = csv(body.kinds).filter((k) => SOURCE_KINDS.some((s) => s.key === k));
  const ids = csv(body.sources);
  let sources = store.db.sources.filter((s) => s.enabled);
  if (ids.length) sources = sources.filter((s) => ids.includes(s.id));
  if (kinds.length && !kinds.includes('all')) {
    sources = sources.filter((s) => s.kind === 'all' || kinds.includes(s.kind));
  }
  const limit = clampInt(body.limit, 3, 40, 12);
  const localSearch = async (query, n) => {
    const r = store.search({ q: query, pageSize: n, sort: 'relevance' });
    return r.items.map((x) => ({
      title: x.title, url: '#/resource/' + x.id, kind: 'local', provider: 'site', providerName: '本站', color: '#7c5cff',
      snippet: truncate(x.summary, 120), image: x.cover, extra: x.type, meta: { score: x.score, downloads: x.downloads.length, tags: x.tags.slice(0, 4) }, id: x.id,
    }));
  };
  const { results, items } = await runSources(sources, q, { limit, localSearch, timeout: clampInt(body.timeout, 2000, 15000, 9000), concurrency: 7 });
  const jumps = results.filter((r) => r.mode === 'url').map((r) => ({ id: r.id, name: r.name, kind: r.kind, color: r.color, icon: r.icon, jumpUrl: r.jumpUrl, note: r.note }));
  return {
    query: q,
    groups: results.filter((r) => r.mode !== 'url').map((r) => ({ id: r.id, name: r.name, kind: r.kind, mode: r.mode, color: r.color, icon: r.icon, ok: r.ok, error: r.error, ms: r.ms, items: r.items, note: r.note })),
    jumps,
    items: items.filter((it) => !(it.kind === 'local')),
    allItems: items,
    counts: { sources: sources.length, external: items.filter((it) => it.kind !== 'local').length, local: items.filter((it) => it.kind === 'local').length },
  };
});
const csv = (v) => uniq(String(v || '').split(/[,，|]+/).map((s) => s.trim()).filter(Boolean));

// ---------- 手动添加 / 投稿 ----------
route('POST', /^\/api\/submit$/, async ({ body, res, ip }) => {
  if (!store.db.settings.allowUserSubmit) return json(res, 403, { ok: false, message: '站点已关闭投稿' });
  const draft = body.draft || body;
  const title = String(draft.title || '').trim();
  if (!title) return json(res, 400, { ok: false, message: '请填写标题' });
  const downloads = (draft.downloads || []).filter((d) => d && d.url);
  if (!downloads.length && !String(draft.summary || '').trim()) return json(res, 400, { ok: false, message: '请至少提供一个下载地址或简介' });
  if (!rateOk('submit:' + ip, 12, 60000)) return json(res, 429, { ok: false, message: '投稿过于频繁，请稍后再试' });
  const auto = !store.db.settings.requireReview;
  if (auto) {
    const rec = store.createResource({ ...draft, status: 'published', sourceUrl: draft.sourceUrl || '' }, 'visitor:' + (draft.contact || '匿名'));
    store.addTags(rec.tags);
    recomputeCounts();
    store.log('submit', '投稿直接入库：' + rec.title, { id: rec.id });
    store.save();
    return { mode: 'published', resource: publicify(rec), message: '已直接发布到资源库' };
  }
  const sub = store.createSubmission({ ...draft, downloads, ip });
  store.log('submit', '收到投稿待审：' + sub.title, { id: sub.id });
  store.save();
  return { mode: 'pending', submission: sub, completeness: completeness(sub), message: '已提交，等待管理员审核' };
});

// ---------- 管理：登录 ----------
route('POST', /^\/api\/admin\/login$/, ({ req, body, res }) => {
  const user = String(body.user || '').trim();
  const pass = String(body.pass || '');
  const locked = store.db.admin.locks || (store.db.admin.locks = {});
  const rec = locked[user] || { n: 0, t: 0 };
  if (rec.n >= 6 && Date.now() - rec.t < 5 * 60000) {
    res.writeHead(429, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, message: '失败次数过多，请 5 分钟后再试' }));
  }
  if (user !== store.db.admin.user || hashPass(pass, store.db.admin.secret) !== store.db.admin.passHash) {
    locked[user] = { n: rec.n + 1, t: Date.now() };
    store.save();
    res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: false, message: '账号或口令错误' }));
  }
  delete locked[user];
  const { token, ttl } = createSession(user, { remember: !!body.remember });
  setSession(res, token, req, ttl);
  store.log('auth', '管理员登录：' + user + (body.remember ? '（记住登录 30 天）' : ''), { user });
  store.save();
  return {
    user,
    remember: !!body.remember,
    expires: Date.now() + ttl,
    message: '登录成功，会话已写入签名 Cookie；刷新页面、切换前后台、重启服务都不需要重新登录',
    sid: '已建立会话（HttpOnly 签名 Cookie）',
  };
});
route('POST', /^\/api\/admin\/logout$/, ({ req, res }) => {
  clearSession(req, res, cookie(req, 'aurora_sid'));
  return { message: '已退出' };
});
route('GET', /^\/api\/admin\/session$/, ({ req, res }) => {
  // 后台心跳走这里：只要页面开着就顺便续期
  const s = touchSession(req, res);
  return {
    ...sessionView(req),
    ttl: s ? s.ttl : 0,
    now: Date.now(),
    sessions: Object.values(store.db.admin.sessions || {}).map((x) => ({ user: x.user, expires: x.expires, remember: !!x.remember })),
  };
});
route('POST', /^\/api\/admin\/password$/, ({ req, body, res }) => {
  const s = requireAdmin(req, res);
  if (!s) return;
  const next = String(body.pass || '');
  if (next.length < 6) return json(res, 400, { ok: false, message: '新口令至少 6 位' });
  if (hashPass(body.old || '', store.db.admin.secret) !== store.db.admin.passHash) return json(res, 400, { ok: false, message: '原口令不正确' });
  const keepRemember = !!(s && s.remember);
  store.db.admin.secret = randomUUID();
  store.db.admin.passHash = hashPass(next, store.db.admin.secret);
  store.db.admin.isDefault = false;
  // 改口令前签发的令牌整批作废（＝其他设备下线），
  // 但当前这台设备直接换发新令牌，不用重新登录一遍。
  store.db.admin.invalidBefore = Date.now();
  store.db.admin.sessions = {};
  const { token, ttl } = createSession(store.db.admin.user, { remember: keepRemember });
  setSession(res, token, req, ttl);
  store.log('auth', '管理员口令已修改：其他会话已下线，当前会话保持登录');
  store.save();
  return { message: '口令已更新，其他设备需重新登录；本设备保持登录', session: sessionView(req) };
});

// ---------- 管理：Excel 导入 ----------
route('POST', /^\/api\/admin\/import\/parse$/, async ({ body, res }) => {
  const base64 = String(body.base64 || body.data || '');
  const filename = String(body.filename || 'upload.xlsx');
  if (!base64) return json(res, 400, { ok: false, message: '文件内容为空' });
  const buf = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
  const ext = path.extname(filename).toLowerCase();
  let parsed;
  try {
    if (ext === '.csv' || ext === '.txt' || ext === '.tsv') parsed = parseCsv(buf);
    else if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xlsb' || ext === '') parsed = parseXlsx(buf);
    else if (ext === '.xls') throw new Error('旧版 .xls 请另存为 .xlsx 或 .csv 后再上传');
    else throw new Error('不支持的文件类型：' + ext);
  } catch (err) {
    return json(res, 400, { ok: false, message: err.message || '解析失败' });
  }
  const batch = newId('b');
  const sheetName = String(body.sheet || '');
  let rows = parsed.rows;
  if (parsed.kind === 'xlsx' && sheetName && parsed.sheets) {
    const z = parseXlsx(buf);
    const target = z.sheets.find((s) => s.name === sheetName);
    if (target) rows = toTable(target.rows).records.length ? target.rows : rows;
  }
  const mapped = body.mapping ? Object.fromEntries(Object.entries(body.mapping).filter(([, v]) => v)) : null;
  const result = tableToDrafts(rows, mapped);
  result.batch = batch;
  result.file = { name: filename, bytes: buf.length, kind: parsed.kind, encoding: parsed.encoding || '', sheets: parsed.sheets };
  store.log('import', '解析文件 ' + filename + '，识别 ' + result.drafts.length + ' 行', { batch, file: filename, rows: result.drafts.length });
  store.save();
  return result;
});

route('POST', /^\/api\/admin\/import\/enrich$/, async ({ body, res, ip }) => {
  if (!rateOk('import-enrich:' + ip, 12, 60000)) return json(res, 429, { ok: false, message: '识别过于频繁，请稍候再试' });
  const drafts = Array.isArray(body.drafts) ? body.drafts : [];
  if (!drafts.length) return json(res, 400, { ok: false, message: '没有需要识别的行' });
  const opts = {
    mirrorImages: body.mirror === undefined ? !!store.db.settings.mirrorImagesByDefault : !!body.mirror,
    imageLimit: num(body.imageLimit, { min: 1, max: 12, dflt: 4 }),
    concurrency: clampInt(body.concurrency, 1, 8, 5),
    timeout: clampInt(body.timeout, 2000, 15000, 9000),
    fields: csv(body.fields).length ? csv(body.fields) : ['downloads', 'others', 'content', 'summary', 'cover', 'sourceUrl', 'auto'],
    uploadDir: UPLOADS,
  };
  const out = await enrichDrafts(drafts, opts);
  return { drafts: out.drafts.map(stripInternal), report: out.report, enriched: out.enriched };
});
const stripInternal = (d) => ({ ...d, sourceMeta: d.sourceMeta || null, raw: d.raw });

route('POST', /^\/api\/admin\/import\/commit$/, async ({ body, req, res }) => {
  if (!requireAdmin(req, res)) return;
  const drafts = Array.isArray(body.drafts) ? body.drafts : [];
  const selected = Array.isArray(body.selected) && body.selected.length ? body.selected : null;
  const list = (selected ? drafts.filter((d) => selected.includes(d.id)) : drafts).filter((d) => d && d.draft && String(d.draft.title || '').trim());
  if (!list.length) return json(res, 400, { ok: false, message: '没有可导入的数据（请检查标题是否为空）' });
  const asDraft = !!body.asDraft;
  const created = [];
  const merged = [];
  const skipped = [];
  const batch = body.batch || newId('b');
  for (const d of list) {
    const draft = { ...d.draft, batch, status: asDraft ? 'draft' : (d.draft.status === 'published' ? 'published' : 'published') };
    const key = normalizeTitle(draft.title);
    const exist = store.db.resources.find((r) => normalizeTitle(r.title) === key);
    if (exist && body.merge !== false) {
      const patch = {};
      for (const f of ['type', 'tags', 'score', 'summary', 'content', 'cover', 'gallery', 'downloads', 'others', 'year', 'region', 'size', 'author', 'sourceUrl']) {
        const cur = exist[f];
        const nv = draft[f];
        const empty = Array.isArray(cur) ? !cur.length : !cur;
        if (empty && (Array.isArray(nv) ? nv.length : nv)) patch[f] = nv;
      }
      if (Array.isArray(draft.downloads) && draft.downloads.length) {
        const set = new Set(exist.downloads.map((x) => x.url));
        patch.downloads = [...exist.downloads, ...draft.downloads.filter((x) => x && x.url && !set.has(x.url))];
      }
      if (Array.isArray(draft.others) && draft.others.length) {
        const set = new Set(exist.others.map((x) => x.url));
        patch.others = [...exist.others, ...draft.others.filter((x) => x && x.url && !set.has(x.url))];
      }
      if (Object.keys(patch).length) {
        const before = completeness(exist).percent;
        const rec = store.updateResource(exist.id, patch, 'import');
        merged.push({ id: rec.id, title: rec.title, from: before, to: completeness(rec).percent, fields: Object.keys(patch) });
      } else skipped.push({ id: exist.id, title: exist.title, reason: '无新增信息' });
      continue;
    }
    const rec = store.createResource(draft, 'import');
    created.push({ id: rec.id, title: rec.title, percent: completeness(rec).percent });
  }
  store.addTags(list.flatMap((d) => d.draft.tags || []));
  for (const d of list) if (d.draft.type) store.ensureType(d.draft.type);
  recomputeCounts();
  store.log('import', '导入完成：新增 ' + created.length + '，合并 ' + merged.length + '，跳过 ' + skipped.length, { batch });
  await store.save();
  return { created, merged, skipped, total: created.length + merged.length, batch };
});

// ---------- 后台路由注册 ----------
registerAdmin({ route, store, UPLOADS, requireAdmin, sessionOf, sessionView, touchSession, publicSettings, recomputeCounts, dashboardStats, stripInternal });

// ---------- 静态文件 ----------
const CACHEABLE = /\.(svg|png|jpe?g|webp|gif|avif|ico|woff2)$/;
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/' || rel === '/manage') rel = '/admin.html';
  if (rel.split('/').includes('..')) {
    return text(res, 403, '禁止访问', { 'content-type': 'text/plain; charset=utf-8' });
  }
  // 上传图在云端落在 /tmp，仓库里的种子图仍在 web/uploads，两处都找一遍
  const bases = rel.startsWith('/uploads/') ? [UPLOADS, WEB] : [WEB];
  let file = null;
  for (const root of bases) {
    const abs = path.join(root, rel);
    if (!abs.startsWith(root + path.sep)) continue;
    let info = await stat(abs).catch(() => null);
    const target = info && info.isDirectory() ? path.join(abs, 'index.html') : abs;
    info = await stat(target).catch(() => null);
    if (info && info.isFile()) { file = target; break; }
  }
  if (!file) {
    // 单页应用兜底
    const fallback = rel.includes('.') ? null : (rel.startsWith('/admin') ? path.join(WEB, 'admin.html') : path.join(WEB, 'index.html'));
    if (!fallback) return text(res, 404, '404 · 未找到 ' + rel, { 'content-type': 'text/plain; charset=utf-8' });
    file = fallback;
  }
  const type = mimeOf(file);
  const headers = { 'content-type': type, 'cache-control': CACHEABLE.test(file) ? 'public, max-age=604800' : /\.(js|css)$/.test(file) ? 'no-cache' : 'no-cache', 'x-content-type-options': 'nosniff' };
  if (/\.html$/.test(file)) headers['cache-control'] = 'no-store';
  const etag = 'W/"' + (await stat(file)).size.toString(36) + '-' + Math.round((await stat(file)).mtimeMs).toString(36) + '"';
  headers.etag = etag;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  return await new Promise((resolve) => {
    createReadStream(file).pipe(res).on('close', resolve);
  });
}

const server = http.createServer(handle);
server.headersTimeout = 40000;
server.requestTimeout = 45000;
server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });

await mkdir(UPLOADS, { recursive: true });

/** 同一个模块两种用法：本地 node server/index.mjs 监听端口；Serverless 里由 api/index.mjs 取 handle。 */
export { handle, store, ROOT, WEB, DATA, UPLOADS, PORT, HOST };

const DIRECT_RUN = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (DIRECT_RUN) {
  await listen(server, PORT, HOST);
  const urls = candidateUrls(PORT, HOST);
  store.log('system', '服务已启动 · ' + urls[0], { port: PORT });
  store.save();
  console.log('\n  ✦ 极昼资源库 AURORA VAULT 已启动' + (ON_SERVERLESS ? '（Serverless / 临时存储）' : ''));
  for (const u of urls) console.log('    → ' + u + (u.includes('127.0.0.1') ? '   (后台 /admin)' : ''));
  console.log('    数据文件：' + store.file);
  console.log('    上传目录：' + UPLOADS);
  console.log('    默认管理员：' + store.db.admin.user + ' / ' + (process.env.AURORA_ADMIN_PASS || DEFAULT_ADMIN.pass) + '\n');
}

function listen(srv, port, host) {
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, host, () => { srv.removeListener('error', reject); resolve(); });
  });
}
function candidateUrls(port, host) {
  const out = [];
  const local = host === '0.0.0.0' || host === '::';
  if (local) {
    const nets = os.networkInterfaces ? os.networkInterfaces() : {};
    for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push('http://' + n.address + ':' + port);
  }
  out.unshift('http://' + (local ? '127.0.0.1' : host) + ':' + port);
  return [...new Set(out)];
}

process.on('unhandledRejection', (err) => console.error('[未处理的 Promise 异常]', err));
process.on('SIGINT', () => { console.log('\n  正在保存数据…'); shutdown(); });
process.on('SIGTERM', shutdown);
async function shutdown() {
  try { await store.flush(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}


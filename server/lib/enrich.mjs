// 链接内容识别：抓取网页标题 / 正文文字 / 图片，并可把图片转存到本地
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fnv, mapLimit, truncate, uniq } from './util.mjs';
import { classify, extractImages, extractUrls } from './links.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AuroraVault/1.0';
const MAX_HTML = 2.2 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;

function safeDecode(s = '') {
  try { return decodeURIComponent(String(s)); } catch { return String(s); }
}

/** SSRF 保护：仅允许公网 http(s)，拒绝内网 / 元数据地址 */
export function safeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!['http:', 'https:', 'magnet:', 'ed2k:', 'thunder:', 'ftp:'].includes(u.protocol)) return null;
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const host = u.hostname.toLowerCase();
      if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|host\.docker\.local)/.test(host) || host === '::1') return null;
    }
    return u;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, { timeout = 9000, headers = {} } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), timeout);
  try {
    return await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6', accept: '*/*', referer: new URL(url).origin + '/', ...headers },
    });
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s = '') {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16) || 32));
}

/** 读取标签属性（支持双引号 / 单引号 / 无引号） */
function attrVal(tag = '', name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"|\\b' + name + "\\s*=\\s*'([^']*)'|\\b" + name + '\\s*=\\s*([^\\s">]+)', 'i').exec(tag);
  const v = m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] || '') : '';
  return decodeEntities(v);
}

/** meta 标签读取：property / name / itemprop 任意写法 */
function metaContent(html, ...keys) {
  const wanted = keys.map((k) => String(k).toLowerCase());
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const k = (attrVal(tag, 'property') || attrVal(tag, 'name') || attrVal(tag, 'itemprop')).toLowerCase();
    if (!k) continue;
    if (wanted.includes(k)) {
      const v = attrVal(tag, 'content');
      if (v) return v;
    }
  }
  return '';
}

function absUrl(base, src) {
  try { return new URL(src, base).href; } catch { return ''; }
}

/** 从 HTML 抽取标题 / 描述 / 关键词 / 图片 / 正文文字 */
export function parseHtmlMeta(html, baseUrl) {
  const clean = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const title = metaContent(html, 'og:title', 'twitter:title') || clean((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
  const description = metaContent(html, 'og:description', 'twitter:description', 'description');
  const keywords = metaContent(html, 'keywords', 'news_keywords');
  const siteName = metaContent(html, 'og:site_name');
  const published = metaContent(html, 'article:published_time', 'og:updated_time', 'date', 'pubdate');
  const author = metaContent(html, 'author');
  const images = [];
  const ogImg = metaContent(html, 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
  if (ogImg) images.push({ url: absUrl(baseUrl, ogImg), source: 'og', score: 100 });
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attrVal(tag, 'src') || attrVal(tag, 'data-src') || attrVal(tag, 'data-original');
    const srcset = attrVal(tag, 'srcset');
    let pick = src;
    if (srcset) {
      const parts = srcset.split(',').map((p) => p.trim()).filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) pick = last.split(/\s+/)[0];
    }
    if (!pick) continue;
    const url = absUrl(baseUrl, pick);
    if (!url) continue;
    const w = Number(attrVal(tag, 'width') || 0);
    images.push({
      url,
      alt: attrVal(tag, 'alt'),
      source: 'img',
      score: (/(cover|poster|thumb|pic|img|banner|bmiddle|maxmiddle|screenshot)/i.test(url) ? 30 : 5) + (w > 200 ? 20 : 0),
    });
  }
  for (const u of extractImages(html.slice(0, 260000))) {
    const url = absUrl(baseUrl, u);
    if (url) images.push({ url, source: 'css', score: 12 });
  }
  const bodyHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const headings = [...bodyHtml.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1])).filter(Boolean);
  const paras = [...bodyHtml.matchAll(/<(p|li|dd|blockquote|h2|h3|h4|td|article)[^>]*>([\s\S]*?)<\/(?:p|li|dd|blockquote|h2|h3|h4|td|article)>/gi)]
    .map((m) => clean(m[2]))
    .filter((t) => t.length >= 6 && !/^(登录|注册|下载 ?App|关于我们|免责声明|Cookie|版权|网站地图)/i.test(t));
  const text = uniq(paras).join('\n').slice(0, 6000);
  const iconTag = (/<link\b[^>]*rel\s*=\s*["']?(?:shortcut )?icon["']?[^>]*>/i.exec(html) || [])[0] || '';
  const favicon = absUrl(baseUrl, attrVal(iconTag, 'href')) || absUrl(baseUrl, '/favicon.ico');
  return {
    title: title || headings[0] || '',
    description, keywords, siteName, published, author, favicon,
    headings: headings.slice(0, 8),
    text,
    textPreview: truncate(text.replace(/\n/g, ' '), 240),
    images: dedupeImages(images),
  };
}

function dedupeImages(list) {
  const seen = new Set();
  const out = [];
  for (const it of list.slice().sort((a, b) => b.score - a.score)) {
    if (!/^https?:/.test(it.url || '')) continue;
    const key = it.url.replace(/^https?:/, '').replace(/\?.*$/, '').toLowerCase();
    if (seen.has(key)) continue;
    if (/(sprite|logo|icon-|1x1|blank|pixel|loading|placeholder|qrcode|weixin|wechat)/i.test(it.url)) continue;
    seen.add(key);
    out.push(it);
  }
  return out.slice(0, 24);
}

/** 识别单个链接：网页→图文；图片→图片；网盘/磁力→分类与提取码 */
export async function enrichUrl(raw, { mirrorImages = false, imageLimit = 6, timeout = 9000, uploadDir } = {}) {
  const url = String(raw || '').trim();
  const info = classify(url) || { kind: 'other', provider: 'other', providerName: '未知', url, color: '#94a3b8' };
  const out = { url, kind: info.kind, provider: info.provider, providerName: info.providerName, color: info.color, code: info.code || '', ok: false, title: '', text: '', images: [], links: [], warn: '' };
  const u = safeUrl(url);
  if (!u) { out.warn = '链接无效或指向内网地址，已跳过抓取'; return out; }
  if (info.kind === 'magnet' || info.kind === 'ed2k' || info.kind === 'thunder') {
    const dn = (/dn=([^&]+)/i.exec(url) || [])[1];
    const hash = (/urn:btih:([a-fA-F0-9]{20,64})/i.exec(url) || [])[1] || '';
    out.ok = true;
    out.metadataOnly = true;
    out.title = dn ? safeDecode(dn.replace(/\+/g, ' ')) : '';
    out.infoHash = hash;
    out.text = 'P2P / 磁力资源' + (hash ? '（BTIH ' + hash.slice(0, 12) + '…）' : '');
    return out;
  }
  let res;
  try {
    res = await fetchWithTimeout(url, { timeout });
  } catch (err) {
    out.warn = '抓取失败：' + (/timeout/i.test(String(err && err.message)) ? '目标站点响应超时' : String((err && err.message) || '网络不可达'));
    if (info.kind === 'netdisk') out.ok = true;
    return out;
  }
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  out.status = res.status;
  out.finalUrl = res.url || url;
  if (!res.ok) {
    out.warn = '目标返回 HTTP ' + res.status + (info.kind === 'netdisk' ? '（网盘页常需登录，链接与提取码已保留）' : '');
    if (info.kind === 'netdisk') { out.ok = true; out.title = info.providerName; }
    return out;
  }
  if (ctype.startsWith('image/')) {
    const name = safeDecode(path.posix.basename(u.pathname) || 'image');
    out.ok = true;
    out.kind = 'image';
    out.title = name;
    out.images = [{ url: out.finalUrl, alt: name, source: 'direct' }];
    if (mirrorImages && uploadDir) {
      const local = await mirrorImage(out.finalUrl, uploadDir).catch(() => '');
      if (local) out.images[0].local = local;
    }
    return out;
  }
  if (ctype.startsWith('application/') || ctype.includes('octet-stream')) {
    const cd = res.headers.get('content-disposition') || '';
    const fn = (/filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd) || [])[1];
    out.ok = true;
    out.kind = 'file';
    out.title = fn ? safeDecode(fn) : safeDecode(path.posix.basename(u.pathname));
    out.size = Number(res.headers.get('content-length') || 0);
    return out;
  }
  const buf = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  const html = decodeHtml(buf.length > MAX_HTML ? buf.subarray(0, MAX_HTML) : buf, res.headers.get('content-type') || '');
  const meta = parseHtmlMeta(html, out.finalUrl);
  out.ok = true;
  out.title = meta.title;
  out.description = meta.description;
  out.keywords = meta.keywords;
  out.siteName = meta.siteName;
  out.published = meta.published;
  out.author = meta.author;
  out.favicon = meta.favicon;
  out.text = meta.text;
  out.textPreview = meta.textPreview;
  out.headings = meta.headings;
  out.images = meta.images.slice(0, 18).map((i) => ({ url: i.url, alt: i.alt || '', source: i.source }));
  out.links = extractUrls(html).filter((l) => l !== url).slice(0, 40);
  if (mirrorImages && uploadDir) {
    const picked = out.images.slice(0, Math.max(1, imageLimit));
    const mirrored = await mapLimit(picked, 4, (img) => mirrorImage(img.url, uploadDir));
    mirrored.forEach((r, i) => { if (r.ok) picked[i].local = r.value; });
  }
  if (!out.title && !out.text) out.warn = '未解析到有效文字（可能是脚本渲染页面），请手动补全';
  return out;
}

function decodeHtml(buf, contentType = '') {
  const tryDecode = (enc) => { try { return new TextDecoder(enc).decode(buf); } catch { return ''; } };
  const declared = /charset=["']?([\w-]+)/i.exec(contentType || '') ? /charset=["']?([\w-]+)/i.exec(contentType || '')[1] : '';
  if (declared) { const d = tryDecode(declared); if (d) return d; }
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if ((utf.match(/\uFFFD/g) || []).length < 5) return utf;
  const headMatch = /<meta[^>]+charset=["']?([\w-]+)/i.exec(utf.slice(0, 4000));
  if (headMatch) { const d = tryDecode(headMatch[1]); if (d) return d; }
  return tryDecode('gb18030') || utf;
}

/** 图片转存：写入 uploads 目录，返回站内路径 */
export async function mirrorImage(rawUrl, uploadDir) {
  const u = safeUrl(rawUrl);
  if (!u) throw new Error('非法图片地址');
  const res = await fetchWithTimeout(u.href, { timeout: 12000 });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const ctype = (res.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (!ctype.startsWith('image/')) throw new Error('目标不是图片：' + ctype);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE) throw new Error('图片超过 8MB');
  const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif', 'image/svg+xml': '.svg' }[ctype] || (ctype.includes('png') ? '.png' : '.jpg');
  await mkdir(uploadDir, { recursive: true });
  const name = 'm' + fnv(u.href).toString(36) + '-' + buf.length.toString(36) + ext;
  const file = path.join(uploadDir, name);
  try {
    await writeFile(file, buf, { flag: 'wx' });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  return '/uploads/' + name;
}

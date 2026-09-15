// 通用工具：HTTP、ID、HTML 清洗、文本处理（零依赖）
import { randomBytes, randomUUID } from 'node:crypto';

export const NOW = () => new Date().toISOString();

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv; charset=utf-8',
};

export function mimeOf(path = '') {
  const i = path.lastIndexOf('.');
  return MIME[i > -1 ? path.slice(i).toLowerCase() : ''] || 'application/octet-stream';
}

export function json(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj ?? null));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function text(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'content-length': buf.length, ...headers });
  res.end(buf);
}

export function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON 解析失败'), { status: 400 });
  }
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sid() {
  return randomBytes(24).toString('hex');
}
export function newId(prefix = 'r') {
  return prefix + '_' + randomUUID().replace(/-/g, '').slice(0, 12);
}
export function hashName(str) {
  return randomUUID ? 'f' + Buffer.from(randomBytes(8)).toString('hex') + (fnv(str).toString(36)) : '';
}
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function stripTags(html = '') {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 纯文本（含换行）→ 安全 HTML 段落 */
export function textToHtml(input = '') {
  const s = String(input).replace(/\r\n/g, '\n').trim();
  if (!s) return '';
  return s
    .split(/\n{2,}/)
    .map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (/^https?:\/\/\S+$/.test(b)) return '<p><a href="' + escapeHtml(b) + '" target="_blank" rel="noopener nofollow">' + escapeHtml(b) + '</a></p>';
      return '<p>' + escapeHtml(b).replace(/\n/g, '<br>') + '</p>';
    })
    .filter(Boolean)
    .join('');
}

const ALLOWED_TAGS = new Set(['p','br','hr','strong','b','em','i','u','s','del','mark','small','sup','sub','h1','h2','h3','h4','h5','ul','ol','li','blockquote','code','pre','a','img','span','div','table','thead','tbody','tr','td','th','figure','figcaption','video','source','dl','dt','dd','kbd']);
const URL_ATTR = new Set(['href', 'src', 'poster']);
const KEEP_ATTRS = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  video: ['src', 'poster', 'controls', 'width', 'height'],
  source: ['src', 'type'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  '*': ['class'],
};

/** 服务端 HTML 白名单清洗：导入 / 手动添加的富文本共用 */
export function sanitizeHtml(input = '') {
  let html = String(input);
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg|math|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base|svg|math|noscript)[^>]*>/gi, '');
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)\/?>|([\s\S]+)/g, (m, tag, attrs, other) => {
    if (other != null) return escapeHtmlKeepBr(other);
    if (!tag) return '';
    const name = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return '';
    if (m.startsWith('</')) return '</' + name + '>';
    if (!attrs) return '<' + name + '>';
    const allow = new Set([...(KEEP_ATTRS[name] || []), ...(KEEP_ATTRS['*'] || [])]);
    const out = [];
    for (const pair of attrs.match(/([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g) || []) {
      const i = pair.indexOf('=');
      const key = pair.slice(0, i).trim().toLowerCase();
      let val = pair.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!allow.has(key)) continue;
      if (/^on/i.test(key)) continue;
      if (URL_ATTR.has(key)) {
        const v = val.replace(/\s/g, '');
        if (/^(javascript|vbscript|data):/i.test(v) && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v)) continue;
        if (key === 'href' && /^data:/i.test(v)) continue;
      }
      out.push(key + '="' + escapeHtml(val) + '"');
    }
    const extra = name === 'a' && /target="_blank"/.test(attrs) ? ' rel="noopener nofollow"' : '';
    return '<' + name + (out.length ? ' ' + out.join(' ') : '') + extra + (isVoid(name) ? ' /' : '') + '>';
  });
}
const isVoid = (t) => ['br', 'hr', 'img', 'source', 'wbr'].includes(t);
function escapeHtmlKeepBr(chunk = '') {
  return chunk.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function normalizeTitle(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/[\s\-_·:：|\[\]()（）【】《》"'"'’,，。!！?？]+/g, '')
    .slice(0, 80);
}

export function uniq(list = []) {
  return [...new Set(list.filter(Boolean))];
}

export function clampInt(v, min, max, dflt = 1) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export function num(v, { min = -Infinity, max = Infinity, dflt = 0 } = {}) {
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.\-]/g, '')) : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

export function truncate(s = '', n = 160) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** 带并发上限的批量执行 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (err) {
        out[idx] = { ok: false, error: err?.message || String(err) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

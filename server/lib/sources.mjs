// 聚合搜索：网盘 / 网站 / 磁力 多来源检索（api / xml / html / url 四种模式）
import { mapLimit, truncate, uniq } from './util.mjs';
import { classify } from './links.mjs';
import { safeUrl } from './enrich.mjs';

export const SOURCE_KINDS = [
  { key: 'all', name: '全部' },
  { key: 'netdisk', name: '网盘' },
  { key: 'magnet', name: '磁力' },
  { key: 'web', name: '网站' },
  { key: 'image', name: '图片' },
  { key: 'doc', name: '文档' },
];

/** 内置来源：api/xml/html 为服务端可抓取；url 为跳转检索（新窗口打开） */
export const DEFAULT_SOURCES = [
  {
    id: 'site', name: '本站资源库', kind: 'all', mode: 'local', enabled: true, color: '#7c5cff', icon: '▦',
    note: '站内搜索：标题 / 标签 / 简介 / 下载链接',
  },
  {
    id: 'github', name: 'GitHub Repos', kind: 'web', mode: 'api', enabled: true, color: '#8b949e', icon: '⌥',
    apiUrl: 'https://api.github.com/search/repositories?q={query}&per_page={limit}', perSource: 12,
    listPath: 'items', map: { title: 'full_name', url: 'html_url', snippet: 'description', time: 'updated_at', stars: 'stargazers_count' },
    note: '开源项目 / 工具类资源',
  },
  {
    id: 'openlibrary', name: 'Open Library', kind: 'doc', mode: 'api', enabled: true, color: '#22a7f0', icon: '❐',
    apiUrl: 'https://openlibrary.org/search.json?q={query}&limit={limit}', listPath: 'docs',
    map: { title: 'title', subtitle: 'subtitle', url: 'key', urlPrefix: 'https://openlibrary.org', snippet: 'first_sentence', year: 'first_publish_year', author: 'author_name' },
    note: '电子书 / 文献书目',
  },
  {
    id: 'crossref', name: 'Crossref 文献', kind: 'doc', mode: 'api', enabled: true, color: '#34d399', icon: '✦',
    apiUrl: 'https://api.crossref.org/works?query={query}&rows={limit}', listPath: 'message.items',
    map: { title: 'title.0', url: 'DOI', urlPrefix: 'https://doi.org/', snippet: 'abstract', year: 'issued.date-parts.0', author: 'author.0.family' },
    note: '论文 / 学术资料',
  },
  {
    id: 'itunes', name: 'iTunes 音乐', kind: 'web', mode: 'api', enabled: true, color: '#f472b6', icon: '♬',
    apiUrl: 'https://itunes.apple.com/search?term={query}&media=music&limit={limit}', listPath: 'results',
    map: { title: 'trackName', url: 'trackViewUrl', snippet: 'artistName', image: 'artworkUrl100', preview: 'previewUrl', time: 'releaseDate', size: 'fileSizeBytes' },
    note: '音乐 / 试听直链',
  },
  {
    id: 'openverse', name: 'Openverse 素材', kind: 'image', mode: 'api', enabled: true, color: '#38bdf8', icon: '◈',
    apiUrl: 'https://api.openverse.org/v1/images/?q={query}&page_size={limit}', listPath: 'results',
    map: { title: 'title', url: 'foreign_landing_url', image: 'url', snippet: 'license', author: 'creator', size: 'width' },
    note: '开放版权图片 / 设计素材',
  },
  {
    id: 'nyaa', name: 'Nyaa 动漫', kind: 'magnet', mode: 'xml', enabled: true, color: '#ff6b6b', icon: '⊛',
    apiUrl: 'https://nyaa.si/?page=rss&q={query}&limit={limit}',
    map: { title: 'title', url: 'link', magnet: 'enclosure', size: 'size', time: 'pubDate', snippet: 'description' },
    note: '动漫 / P2P（RSS，含磁力直链）',
  },
  {
    id: 'dht', name: 'DHT 磁力聚合', kind: 'magnet', mode: 'api', enabled: false, color: '#f43f5e', icon: '⚉',
    apiUrl: 'https://api.dhtsearch.example.com/search?keyword={query}&limit={limit}', listPath: 'data.list',
    map: { title: 'filename', url: 'magnet', magnet: 'magnet', size: 'size', time: 'create_time' },
    note: '需自行填写可用的 DHT 搜索接口（后台可改）',
  },
  {
    id: 'baidu-search', name: '百度网盘（引擎）', kind: 'netdisk', mode: 'url', enabled: true, color: '#4f7cff', icon: '☁',
    searchUrl: 'https://www.baidu.com/s?wd={query}%20%E7%BD%91%E7%9B%98%20%E5%88%86%E4%BA%AB',
    note: '跳转检索，结果页中寻找 pan.baidu.com 分享链接',
  },
  {
    id: 'quark-search', name: '夸克网盘（引擎）', kind: 'netdisk', mode: 'url', enabled: true, color: '#22d3ee', icon: '◎',
    searchUrl: 'https://www.baidu.com/s?wd={query}%20%E5%A4%B8%E5%85%8B%E7%BD%91%E7%9B%98',
    note: '跳转检索',
  },
  {
    id: 'alipan-search', name: '阿里云盘（引擎）', kind: 'netdisk', mode: 'url', enabled: true, color: '#ff8a3d', icon: '☂',
    searchUrl: 'https://www.bing.com/search?q={query}%20%E9%98%BF%E9%87%8C%E4%BA%91%E7%9B%98%20%E6%8F%90%E5%8F%96%E7%A0%81',
    note: '跳转检索',
  },
  {
    id: 'lanzou-search', name: '蓝奏云（引擎）', kind: 'netdisk', mode: 'url', enabled: true, color: '#22a7f0', icon: '☁',
    searchUrl: 'https://www.bing.com/search?q={query}%20site%3Alanzou',
    note: '跳转检索',
  },
  {
    id: 'torrent-search', name: '磁力站点', kind: 'magnet', mode: 'url', enabled: true, color: '#fb7185', icon: '⚉',
    searchUrl: 'https://1337x.to/search/{query}/1/',
    note: '跳转检索，可选启用服务端抓取（模式改为 html）',
  },
  {
    id: 'video-search', name: '在线视频站点', kind: 'web', mode: 'url', enabled: true, color: '#f472b6', icon: '▶',
    searchUrl: 'https://search.bilibili.com/all?keyword={query}',
    note: '跳转检索',
  },
  {
    id: 'game-search', name: '游戏资料站', kind: 'web', mode: 'url', enabled: true, color: '#a78bfa', icon: '⎈',
    searchUrl: 'https://www.bing.com/search?q={query}%20%E6%B8%B8%E6%88%8F%20%E4%B8%8B%E8%BD%BD',
    note: '跳转检索',
  },
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function pick(obj, dotted = '') {
  if (!dotted) return undefined;
  const parts = dotted.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}
function enc(q) { return encodeURIComponent(q); }

async function fetchText(url, timeout = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('timeout')), timeout);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': UA, accept: 'application/json,text/xml,text/html;q=0.9,*/*;q=0.5', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return { body: await res.text(), type: (res.headers.get('content-type') || '').toLowerCase() };
  } finally {
    clearTimeout(t);
  }
}

/** api 模式：JSON + 字段映射 */
async function searchApi(source, query, { limit = 12, timeout = 9000 } = {}) {
  const url = fill(source.apiUrl, { query: enc(query), q: enc(query), limit, perSource: limit, page: 1 });
  const { body } = await fetchText(url, timeout);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error('返回不是 JSON'); }
  const list = (source.listPath ? pick(data, source.listPath) : Array.isArray(data) ? data : data.results || data.data || []) || [];
  const map = source.map || {};
  return list.slice(0, limit).map((row) => {
    const title = truncate(String(pick(row, map.title) ?? pick(row, 'title') ?? pick(row, 'name') ?? ''), 120);
    let href = String(pick(row, map.url) ?? pick(row, 'url') ?? pick(row, 'link') ?? '');
    if (href && map.urlPrefix && !/^https?:/i.test(href)) href = map.urlPrefix + href;
    const magnetUrl = map.magnet ? String(pick(row, map.magnet) || '') : '';
    const infoHash = /urn:btih:([a-fA-F0-9]{20,64})/i.exec(magnetUrl || href);
    if (!href && infoHash) href = 'magnet:?xt=urn:btih:' + infoHash[1];
    const image = map.image ? String(pick(row, map.image) || '') : '';
    const url = /^magnet:/i.test(href) ? href : (safeUrl(href) ? href : '');
    const cls = classify(url || '');
    return {
      title: title || '未命名结果',
      url,
      kind: cls?.kind || (url ? 'web' : 'unknown'),
      provider: cls?.provider || '',
      providerName: cls?.providerName || source.name,
      color: cls?.color || source.color,
      image: image ? image.replace(/100x100bb/, '400x400bb') : '',
      preview: map.preview ? String(pick(row, map.preview) || '') : '',
      snippet: truncate(String(map.snippet ? pick(row, map.snippet) || '' : ''), 180),
      size: Number(map.size ? pick(row, map.size) : 0) || 0,
      time: normalizeTime(map.time ? String(pick(row, map.time) || '') : ''),
      extra: map.author ? String(pick(row, map.author) || '') : '',
      seeders: map.seeders ? Number(pick(row, map.seeders)) || 0 : 0,
      magnet: /^magnet:/i.test(magnetUrl) ? magnetUrl : url,
    };
  });
}

/** xml / rss 模式 */
async function searchXml(source, query, { limit = 12, timeout = 9000 } = {}) {
  const url = fill(source.apiUrl, { query: enc(query), q: enc(query), limit });
  const { body } = await fetchText(url, timeout);
  const map = source.map || {};
  const itemRe = /<item[\s>][\s\S]*?<\/item>/gi;
  const out = [];
  let m;
  const field = (chunk, tag) => {
    const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\/' + tag + '>', 'i');
    const r = re.exec(chunk);
    if (!r) return '';
    return r[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  const attr = (chunk, tag, name) => {
    const re = new RegExp('<' + tag + '\\b[^>]*' + name + '\\s*=\\s*"([^"]*)"', 'i');
    const r = re.exec(chunk);
    return r ? r[1] : '';
  };
  while ((m = itemRe.exec(body)) && out.length < limit) {
    const chunk = m[0];
    const title = truncate(field(chunk, map.title || 'title'), 140);
    const link = field(chunk, map.url || 'link');
    const magnetAttr = attr(chunk, map.magnet || 'enclosure', 'url');
    const url = /^magnet:/i.test(magnetAttr) ? magnetAttr : link;
    if (!title || (!url && !magnetAttr)) continue;
    const cls = classify(url || '');
    out.push({
      title, url: url || magnetAttr,
      kind: cls?.kind || 'web', provider: cls?.provider || '', providerName: cls?.providerName || source.name,
      color: cls?.color || source.color,
      snippet: truncate(field(chunk, map.snippet || 'description'), 180),
      size: Number(field(chunk, map.size || 'size') || 0) || 0,
      time: normalizeTime(field(chunk, map.time || 'pubDate')),
      magnet: /^magnet:/i.test(magnetAttr) ? magnetAttr : url,
    });
  }
  return out;
}

/** html 模式：抓取搜索结果页里的链接 */
async function searchHtml(source, query, { limit = 12, timeout = 9000 } = {}) {
  const url = fill(source.apiUrl || source.searchUrl, { query: enc(query), q: enc(query), limit });
  const { body } = await fetchText(url, timeout);
  const anchors = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = (/href\s*=\s*"([^"]+)"|href\s*=\s*'([^']+)'/i.exec(m[1]) || [])[1] || (/href\s*=\s*'([^']+)'/i.exec(m[1]) || [])[1] || '';
    const text = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href || !text || text.length < 6) continue;
    const abs = /^https?:/i.test(href) ? href : (() => { try { return new URL(href, url).href; } catch { return ''; } })();
    if (!abs) continue;
    anchors.push({ title: truncate(text, 140), url: abs });
  }
  const kw = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const scored = anchors.map((a) => {
    const cls = classify(a.url);
    let score = 0;
    const hay = (a.title + ' ' + a.url).toLowerCase();
    for (const k of kw) if (hay.includes(k)) score += 2;
    if (cls && cls.kind === source.kind) score += 3;
    if (cls && ['netdisk', 'magnet'].includes(cls.kind)) score += 2;
    if (/^(https?:)?\/\/[^/]*(baidu|bing|google)\./i.test(a.url) && /url=|q=/.test(a.url)) score += 1;
    return { ...a, score, cls };
  }).filter((a) => a.score > 0).sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const a of scored) {
    const key = a.url.replace(/^https?:/, '').split('#')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: a.title, url: a.url,
      kind: a.cls?.kind || 'web', provider: a.cls?.provider || '', providerName: a.cls?.providerName || source.name,
      color: a.cls?.color || source.color, snippet: '', magnet: /^magnet:/i.test(a.url) ? a.url : '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeTime(s = '') {
  if (!s) return '';
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return String(s).slice(0, 10);
}

/** 执行单个来源检索 */
export async function runSource(source, query, opts = {}) {
  const { limit = 12, timeout = 9000, localSearch } = opts;
  const started = Date.now();
  const base = { id: source.id, name: source.name, kind: source.kind, mode: source.mode, color: source.color, icon: source.icon, note: source.note || '', items: [], ok: false, error: '', ms: 0, external: source.mode === 'url' };
  try {
    if (!source.enabled) throw new Error('来源已停用');
    if (source.mode === 'local') {
      const items = localSearch ? await localSearch(query, limit) : [];
      base.items = items;
      base.ok = true;
    } else if (source.mode === 'url') {
      base.jumpUrl = fill(source.searchUrl || '', { query: enc(query), q: enc(query) });
      base.ok = true;
    } else if (source.mode === 'api') {
      base.items = await searchApi(source, query, { limit, timeout });
      base.ok = true;
    } else if (source.mode === 'xml') {
      base.items = await searchXml(source, query, { limit, timeout });
      base.ok = true;
    } else if (source.mode === 'html') {
      base.items = await searchHtml(source, query, { limit, timeout });
      base.ok = true;
    } else {
      throw new Error('未知模式：' + source.mode);
    }
    base.items = base.items.map((it) => ({ sourceId: source.id, sourceName: source.name, sourceColor: source.color, ...it }));
  } catch (err) {
    base.error = String((err && err.message) || err).slice(0, 120);
  }
  base.ms = Date.now() - started;
  return base;
}

/** 并发执行多个来源 */
export async function runSources(sources, query, opts = {}) {
  const wrapped = await mapLimit(sources, Number(opts.concurrency || 6), (s) => runSource(s, query, opts));
  const results = wrapped.map((w, i) => {
    const src = sources[i] || {};
    if (w && w.ok && w.value) return w.value;
    return {
      id: src.id, name: src.name, kind: src.kind, mode: src.mode, color: src.color, icon: src.icon,
      note: src.note || '', items: [], ok: false, error: String((w && w.error) || '来源执行异常'), ms: 0, external: src.mode === 'url',
    };
  });
  const flat = [];
  for (const r of results) for (const it of r.items || []) flat.push(it);
  const seen = new Set();
  const deduped = flat.filter((it) => {
    const key = (it.url || it.title).replace(/^https?:/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { results, items: deduped };
}

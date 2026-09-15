// 导入流水线：Excel 表格 → 草稿资源 → 链接图文识别 → 缺失补全 → 批量入库
import { newId, uniq, truncate, stripTags, mapLimit, num, sanitizeHtml, textToHtml } from './util.mjs';
import { toTable } from './xlsx.mjs';
import { classify, extractUrls, extractImages, parseSize, mapHeaders } from './links.mjs';
import { completeness } from './store.mjs';
import { enrichUrl } from './enrich.mjs';

/** 表格 → 草稿列表（含字段映射与完整度诊断） */
export function tableToDrafts(rows, mappingOverride) {
  const table = toTable(rows);
  const mapping = mappingOverride || autoGuess(table.headers);
  const drafts = table.records.map((record, index) => draftFromRecord(record, mapping, table.headers, index));
  const stats = {
    total: drafts.length,
    complete: drafts.filter((d) => d.completeness.percent >= 100).length,
    needFix: drafts.filter((d) => d.completeness.percent < 100).length,
    noTitle: drafts.filter((d) => !d.draft.title).length,
    noLink: drafts.filter((d) => !d.draft.downloads.length).length,
    dupInTable: uniq(drafts.map((d) => d.key).filter((k, i, arr) => arr.indexOf(k) !== i)).length,
  };
  const coverage = {};
  for (const h of table.headers) coverage[h] = drafts.filter((d) => String(d.raw[h] || '').trim() !== '').length;
  return {
    headers: table.headers,
    headerLine: table.headerLine,
    mapping,
    unmapped: table.headers.filter((h) => !Object.values(mapping).includes(h)),
    drafts,
    stats,
    coverage,
    totalRows: table.totalRows,
  };
}

const autoGuess = (headers) => mapHeaders(headers);

const FIELD_LABELS = {
  title: '标题', type: '类型', tags: '标签', score: '分数', summary: '简介', content: '内容/图片',
  downloads: '资源下载', others: '其他来源', cover: '封面', gallery: '图集', year: '年份', region: '地区',
  size: '大小', author: '作者/制作', format: '格式/版本', price: '价格', status: '状态', sourceUrl: '来源地址',
};
export const IMPORT_FIELDS = Object.entries(FIELD_LABELS).map(([key, label]) => ({ key, label }));

/** 单行 → 草稿 */
function draftFromRecord(record, mapping, headers, index) {
  const get = (field) => {
    const col = mapping[field];
    return col ? String(record.cells[col] ?? '').trim() : '';
  };
  const allText = headers.map((h) => String(record.cells[h] ?? '')).join('\n');
  const titleRaw = get('title');
  const tagsRaw = get('tags');
  const linkCellFields = ['downloads', 'others', 'content', 'summary', 'sourceUrl'];
  const linkUrls = [];
  for (const f of linkCellFields) for (const u of extractUrls(get(f))) linkUrls.push({ url: u, field: f });
  for (const u of extractUrls(allText)) if (!linkUrls.some((x) => x.url === u)) linkUrls.push({ url: u, field: 'auto' });
  const imgUrls = uniq([...extractImages(allText), ...extractImages(get('cover')), ...extractImages(get('gallery'))]);
  const downloadUrls = linkUrls.filter((x) => {
    const c = classify(x.url);
    return c && ['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes(c.kind);
  });
  const otherUrls = linkUrls.filter((x) => !downloadUrls.includes(x) && /^https?:/i.test(x.url));
  const draft = {
    id: 'd' + (index + 1) + '-' + newId('x').slice(2, 8),
    line: record.__line,
    key: normalizeKeyText(titleRaw || truncate(stripTags(allText), 40)),
    status: 'pending',
    issues: [],
    fields: {},
    draft: {
      title: titleRaw.slice(0, 160),
      altTitles: [],
      type: get('type'),
      tags: splitTags(tagsRaw),
      score: num(get('score'), { min: 0, max: 10, dflt: 0 }),
      summary: truncate(get('summary') || stripTags(get('content')), 300),
      content: /<[a-z][\s\S]*>/i.test(get('content')) ? sanitizeHtml(get('content')) : textToHtml(get('content')),
      cover: imgUrls[0] || '',
      gallery: imgUrls.slice(0, 12).map((url) => ({ url, caption: '' })),
      downloads: downloadUrls.map((x) => {
        const c = classify(x.url);
        return { url: x.url, label: c.providerName, provider: c.provider, kind: c.kind, color: c.color, code: c.code || '', size: x.field === 'auto' ? '' : guessSize(x.url), quality: '', note: '', images: [] };
      }),
      others: otherUrls.slice(0, 20).map((x) => {
        const c = classify(x.url) || { providerName: '网页', provider: 'web', kind: 'web', color: '#94a3b8' };
        return { url: x.url, label: truncate(stripTags(get('title')) || c.providerName, 30), provider: c.provider, kind: c.kind, color: c.color, code: '', note: '', images: [] };
      }),
      imagesFromLinks: imgUrls.slice(0, 12),
      linksFromText: [],
      year: get('year').slice(0, 30),
      region: get('region').slice(0, 30),
      size: get('size').slice(0, 30),
      format: get('format').slice(0, 40),
      author: get('author').slice(0, 60),
      status: 'draft',
      featured: false,
      sourceUrl: get('sourceUrl'),
      notes: get('price') ? '价格：' + get('price') : '',
    },
    raw: record.cells,
    detected: {
      linkUrls: linkUrls.map((x) => {
        const c = classify(x.url) || { kind: 'unknown', provider: 'unknown', providerName: '未知', color: '#94a3b8', code: '' };
        return { url: x.url, field: x.field, kind: c.kind, provider: c.provider, providerName: c.providerName, color: c.color, code: c.code };
      }),
      imageUrls: imgUrls,
    },
  };
  draft.completeness = completeness(draft.draft);
  diagnose(draft);
  return draft;
}

function diagnose(d) {
  const issues = [];
  const x = d.draft;
  if (!x.title) issues.push({ field: 'title', level: 'error', text: '缺少标题，无法入库' });
  if (x.title && x.title.length < 2) issues.push({ field: 'title', level: 'warn', text: '标题过短' });
  if (!x.type) issues.push({ field: 'type', level: 'warn', text: '缺少类型' });
  if (!x.tags.length) issues.push({ field: 'tags', level: 'warn', text: '缺少标签' });
  if (!x.score) issues.push({ field: 'score', level: 'warn', text: '缺少分数' });
  if (!x.summary || x.summary.length < 12) issues.push({ field: 'summary', level: 'warn', text: '简介过短或缺失' });
  if (!x.content && !x.gallery.length && !x.cover) issues.push({ field: 'content', level: 'warn', text: '缺少内容/图片' });
  if (!x.downloads.length) issues.push({ field: 'downloads', level: 'warn', text: '未识别到下载地址' });
  if (!x.others.length && !x.sourceUrl) issues.push({ field: 'others', level: 'info', text: '缺少其他来源' });
  const longUrl = x.downloads.find((l) => String(l.url).length > 400);
  if (longUrl) issues.push({ field: 'downloads', level: 'info', text: '存在超长链接，可能是被截断的分享文本' });
  d.issues = issues;
  d.fields = Object.fromEntries(issues.map((i) => [i.field, i.text]));
  d.hasError = issues.some((i) => i.level === 'error');
  return d;
}

/** 批量识别链接图文（供预览弹窗展示与补全使用） */
export async function enrichDrafts(drafts, { mapping, fields = ['downloads', 'others', 'content', 'summary', 'cover', 'sourceUrl'], mirrorImages = true, imageLimit = 4, concurrency = 5, timeout = 9000, uploadDir, onProgress } = {}) {
  const targets = [];
  drafts.forEach((d, di) => {
    const seen = new Set();
    for (const url of d.detected.linkUrls) {
      if (!fields.includes(url.field) && url.field !== 'auto') continue;
      if (seen.has(url.url)) continue;
      seen.add(url.url);
      targets.push({ draftIndex: di, url: url.url, field: url.field, kind: url.kind });
    }
  });
  const results = await mapLimit(targets, concurrency, async (t, i) => {
    const r = await enrichUrl(t.url, { mirrorImages, imageLimit, timeout, uploadDir });
    if (onProgress) onProgress({ done: i + 1, total: targets.length, url: t.url, ok: r.ok });
    return { t, r };
  });
  const byDraft = new Map();
  for (const item of results) {
    if (!item || !item.ok || !item.value) {
      report.failed++;
      report.errors.push({ url: item && item.value && item.value.t ? item.value.t.url : '(未知)', error: (item && item.error) || '识别任务异常' });
      continue;
    }
    const { t, r } = item.value;
    if (!byDraft.has(t.draftIndex)) byDraft.set(t.draftIndex, []);
    byDraft.get(t.draftIndex).push({ t, r });
  }
  const report = { urls: targets.length, ok: 0, failed: 0, images: 0, filled: [], errors: [] };
  for (const [di, entries] of byDraft) {
    const d = drafts[di];
    applyEnrichment(d, entries, report, { imageLimit });
    diagnose(d);
  }
  return { drafts, report, enriched: byDraft.size };
}

/** 把抓取到的图文回填进草稿（只补空，不覆盖已有内容） */
function applyEnrichment(draft, entries, report, { imageLimit = 4 } = {}) {
  const x = draft.draft;
  const webEntries = entries.filter((e) => e.r.kind !== 'netdisk' || !e.r.metadataOnly);
  for (const { t, r } of entries) {
    if (r.ok) report.ok++; else { report.failed++; report.errors.push({ url: t.url, error: r.warn || '抓取失败' }); }
    const images = (r.images || []).map((im) => ({ url: im.local || im.url, remote: im.url, alt: im.alt || '', source: im.source }));
    if (images.length) report.images += images.length;
    // 1) 下载项：补网盘标题 / 提取码 / 图片
    const link = [...x.downloads, ...x.others].find((l) => l.url === t.url);
    if (link) {
      if (r.code) link.code = r.code;
      if (r.size && !link.size) link.size = human(r.size);
      if (!link.label || link.label === '链接') link.label = truncate(r.title || r.providerName || link.label || '链接', 30);
      link.images = images.slice(0, 6);
      if (r.finalUrl && /^https?:/i.test(r.finalUrl)) link.finalUrl = r.finalUrl;
      link.checked = { ok: !!r.ok, at: new Date().toISOString(), note: r.warn || r.siteName || '' };
      if (r.infoHash && !link.infoHash) link.infoHash = r.infoHash;
    }
    if (['image', 'video', 'doc', 'site', 'web'].includes(r.kind) && r.images?.length && !images.some((i) => i.url === x.cover)) {
      for (const im of images.slice(0, imageLimit)) {
        if (x.gallery.length >= 24) break;
        if (!x.gallery.some((g) => g.url === im.url)) x.gallery.push({ url: im.url, caption: truncate(r.title || '', 40) });
      }
    }
  }
  // 2) 封面：优先取抓取到的第一张图
  if (!x.cover) {
    const firstImg = entries.flatMap((e) => (e.r.images || []).map((i) => i.local || i.url))[0];
    if (firstImg) x.cover = firstImg;
  }
  // 3) 标题 / 简介 / 内容 / 标签 / 分数补全
  const best = webEntries.filter((e) => e.r.ok).sort((a, b) => (String(b.r.title || '').length - String(a.r.title || '').length) || (String(b.r.text || '').length - String(a.r.text || '').length))[0];
  const filled = (field) => report.filled.push({ id: draft.id, field });
  if (best) {
    const r = best.r;
    if (!x.title && r.title) { x.title = truncate(r.title, 120); filled('title'); }
    if ((!x.summary || x.summary.length < 12) && (r.description || r.textPreview)) { x.summary = truncate(r.description || r.textPreview, 300); filled('summary'); }
    if (!x.content && r.text) { x.content = textToHtml(r.text.slice(0, 4000)); filled('content'); }
    if (!x.tags.length) {
      const kw = uniq([...splitTags(r.keywords || ''), ...splitTags(r.siteName || ''), ...splitTags(r.providerName || '')]).slice(0, 6);
      if (kw.length) { x.tags = kw; filled('tags'); }
    }
    if (!x.score) {
      const m = /([0-9](?:\.[0-9])?)\s*(?:分|\/10|rating|评分|IMDb)/i.exec(String(r.text || '') + ' ' + String(r.title || ''));
      if (m) { x.score = num(m[1], { min: 0, max: 10, dflt: 0 }); filled('score'); }
    }
    if (!x.year) {
      const y = /((?:19|20)\d{2})/.exec(String(r.published || '') + ' ' + String(r.text || '').slice(0, 600));
      if (y) { x.year = y[1]; filled('year'); }
    }
    if (!x.author && r.author) { x.author = truncate(r.author, 60); filled('author'); }
    if (!x.sourceUrl && r.finalUrl) { x.sourceUrl = r.finalUrl; filled('sourceUrl'); }
    draft.sourceMeta = {
      url: r.url, title: r.title, siteName: r.siteName, favicon: r.favicon,
      description: r.description, keywords: r.keywords, textPreview: r.textPreview,
      images: (r.images || []).slice(0, 12).map((i) => ({ url: i.local || i.url, remote: i.url, source: i.source })),
      headings: r.headings || [], links: (r.links || []).slice(0, 20),
    };
  }
  draft.enriched = { at: new Date().toISOString(), urls: entries.map((e) => ({ url: e.t.url, ok: !!e.r.ok, kind: e.r.kind, provider: e.r.providerName, warn: e.r.warn || '', images: (e.r.images || []).length })) };
  if (!report.perDraft) report.perDraft = [];
  report.perDraft.push({ id: draft.id, title: x.title, addedImages: entries.reduce((n, e) => n + (e.r.images || []).length, 0), filled: report.filled.filter((f) => f.id === draft.id).map((f) => f.field) });
  draft.completeness = completeness(x);
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = Number(bytes) || 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return (i ? n.toFixed(1) : String(Math.round(n))) + ' ' + units[i];
}
function guessSize(url) {
  const m = parseSize(decodeURIComponentSafe(url));
  return m ? human(m) : '';
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(String(s)); } catch { return String(s); } }
function splitTags(v) { return uniq(String(v || '').split(/[,，、;；|\s\/]+/).map((s) => s.trim()).filter(Boolean)); }
function normalizeKeyText(s = '') {
  return String(s).toLowerCase().replace(/[\s\-_·:：|\[\]()（）【】《》"'’]+/g, '').slice(0, 60);
}
export { completeness, FIELD_LABELS };

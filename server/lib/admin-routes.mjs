// 后台管理接口：资源 CRUD / 投稿审核 / 分类标签 / 检索来源 / 站点设置 / 媒体库 / 备份
import { writeFile, readdir, stat, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { json, newId, NOW, uniq, truncate, stripTags, sanitizeHtml, textToHtml, mapLimit, clampInt, num } from './util.mjs';
import { completeness } from './store.mjs';
import { mirrorImage } from './enrich.mjs';
import { runSource } from './sources.mjs';
import { classify, extractUrls } from './links.mjs';
import { enrichDrafts } from './importer.mjs';
import { GAP_KEYS, GAP_FIELDS, gapReport, blankFields, isBlank, candidateUrls, batchFill } from './gaps.mjs';

export function registerAdmin(ctx) {
  const { route, store, UPLOADS, requireAdmin, publicSettings, recomputeCounts, dashboardStats, stripInternal, sessionOf, sessionView } = ctx;
  const guard = (res, req) => requireAdmin(req, res);
  const actor = (req) => (sessionOf(req) || {}).user || 'admin';
  const sessionUser = (req) => actor(req);

  // ---- 总览 ----
  route('GET', /^\/api\/admin\/overview$/, ({ req, res }) => {
    if (!guard(res, req)) return;
    return {
      stats: dashboardStats(),
      logs: store.db.logs.slice(0, 40),
      pending: store.db.submissions.filter((s) => s.status === 'pending').length,
      recent: store.db.resources.slice(0, 8).map((r) => ({ id: r.id, title: r.title, type: r.type, status: r.status, percent: completeness(r).percent, updatedAt: r.updatedAt, cover: r.cover })),
      settings: store.db.settings,
      sources: store.db.sources.length,
      admin: { user: store.db.admin.user, hasDefaultSecret: store.db.admin.isDefault !== false },
    };
  });

  // ---- 资源管理 ----
  route('GET', /^\/api\/admin\/resources$/, ({ req, res, query }) => {
    if (!guard(res, req)) return;
    const page = clampInt(query.get('page'), 1, 500, 1);
    const pageSize = clampInt(query.get('pageSize'), 1, 200, 20);
    const q = (query.get('q') || '').trim();
    const status = query.get('status') || 'all';
    const type = query.get('type') || '';
    const lack = query.get('lack') || '';
    let items = store.db.resources.slice();
    if (status !== 'all') items = items.filter((r) => r.status === status);
    if (type) items = items.filter((r) => r.type === type);
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((r) => (r.title + ' ' + r.tags.join(' ') + ' ' + r.summary + ' ' + r.downloads.map((d) => d.url).join(' ')).toLowerCase().includes(needle));
    }
    if (lack) items = items.filter((r) => completeness(r).missing.some((m) => m.key === lack));
    const sort = query.get('sort') || 'updated';
    items.sort((a, b) => (sort === 'title' ? String(a.title).localeCompare(String(b.title), 'zh') : sort === 'score' ? b.score - a.score : sort === 'views' ? (b.views || 0) - (a.views || 0) : sort === 'percent' ? completeness(a).percent - completeness(b).percent : String(b.updatedAt).localeCompare(String(a.updatedAt))));
    const total = items.length;
    return {
      page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items: items.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
        id: r.id, title: r.title, type: r.type, tags: r.tags, score: r.score, status: r.status, featured: r.featured,
        cover: r.cover, views: r.views || 0, favorites: r.favorites || 0, downloads: r.downloads.length, others: r.others.length,
        gallery: r.gallery.length, updatedAt: r.updatedAt, createdAt: r.createdAt, batch: r.batch, sourceUrl: r.sourceUrl,
        completeness: completeness(r), summary: truncate(r.summary, 90), deadLinks: r.downloads.filter((d) => d.dead).length,
      })),
      counts: { all: store.db.resources.length, published: store.db.resources.filter((r) => r.status === 'published').length, draft: store.db.resources.filter((r) => r.status === 'draft').length, archived: store.db.resources.filter((r) => r.status === 'archived').length },
    };
  });

  route('GET', /^\/api\/admin\/resource(?:\/([\w-]+))?$/, ({ req, res, params }) => {
    if (!guard(res, req)) return;
    if (!params[0]) return { resource: null, types: store.db.types, tags: store.db.tags };
    const r = store.findResource(params[0]);
    if (!r) return json(res, 404, { ok: false, message: '资源不存在' });
    return { resource: r, types: store.db.types, tags: store.db.tags.slice(0, 200) };
  });

  route('POST', /^\/api\/admin\/resources$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    if (!String(body.title || '').trim()) return json(res, 400, { ok: false, message: '标题不能为空' });
    const rec = store.createResource(body, sessionUser(req));
    store.addTags(rec.tags);
    if (rec.type) store.ensureType(rec.type);
    recomputeCounts();
    store.log('resource', '新建资源：' + rec.title, { id: rec.id });
    await store.save();
    return { resource: rec, message: '已保存' };
  });

  route('PATCH', /^\/api\/admin\/resources\/([\w-]+)$/, async ({ req, res, params, body }) => {
    if (!guard(res, req)) return;
    const rec = store.updateResource(params[0], body, sessionUser(req));
    if (!rec) return json(res, 404, { ok: false, message: '资源不存在' });
    store.addTags(rec.tags);
    if (rec.type) store.ensureType(rec.type);
    recomputeCounts();
    store.log('resource', '更新资源：' + rec.title, { id: rec.id, changes: completeness(rec).percent });
    await store.save();
    return { resource: rec, completeness: completeness(rec), message: '已更新' };
  });

  route('DELETE', /^\/api\/admin\/resources\/([\w-]+)$/, async ({ req, res, params }) => {
    if (!guard(res, req)) return;
    const gone = store.deleteResource(params[0]);
    if (!gone) return json(res, 404, { ok: false, message: '资源不存在' });
    recomputeCounts();
    store.log('resource', '删除资源（进入回收站）：' + gone.title, { id: gone.id });
    await store.save();
    return { message: '已删除，可在回收站恢复', id: gone.id };
  });

  route('POST', /^\/api\/admin\/resources\/bulk$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const action = String(body.action || '');
    const done = [];
    for (const id of ids) {
      const r = store.findResource(id);
      if (!r) continue;
      if (action === 'publish') store.updateResource(id, { status: 'published' }, sessionUser(req));
      else if (action === 'draft') store.updateResource(id, { status: 'draft' }, sessionUser(req));
      else if (action === 'archive') store.updateResource(id, { status: 'archived' }, sessionUser(req));
      else if (action === 'feature') store.updateResource(id, { featured: true }, sessionUser(req));
      else if (action === 'unfeature') store.updateResource(id, { featured: false }, sessionUser(req));
      else if (action === 'type' && body.value) { store.ensureType(body.value); store.updateResource(id, { type: body.value }, sessionUser(req)); }
      else if (action === 'tag') { const add = uniq([].concat(body.add || [])); if (add.length) store.updateResource(id, { tags: uniq([...r.tags, ...add]) }, sessionUser(req)); }
      else if (action === 'untag') { const rm = new Set([].concat(body.remove || [])); store.updateResource(id, { tags: r.tags.filter((t) => !rm.has(t)) }, sessionUser(req)); }
      else if (action === 'delete') store.deleteResource(id);
      else continue;
      done.push(id);
    }
    recomputeCounts();
    store.log('resource', '批量操作 ' + action + '：影响 ' + done.length + ' 条', { action, ids: done.slice(0, 30) });
    await store.save();
    return { affected: done.length, ids: done, message: '批量操作完成' };
  });

  route('POST', /^\/api\/admin\/resources\/([\w-]+)\/check-links$/, async ({ req, res, params }) => {
    if (!guard(res, req)) return;
    const r = store.findResource(params[0]);
    if (!r) return json(res, 404, { ok: false, message: '资源不存在' });
    const out = await checkLinks(r);
    await store.save();
    return { results: out, checked: out.length, message: '链接检测完成' };
  });

  /**
   * 缺失空白位置一览：按「筛选条件 / 勾选的 id」统计每个位置还空着几条，
   * 后台「批量补全」面板用它出勾选框、预估工作量与待补清单。
   */
  route('GET', /^\/api\/admin\/gaps$/, ({ req, res, query }) => {
    if (!guard(res, req)) return;
    const pickedIds = csvParam(query.get('ids'));
    const picked = applyResourceFilter(query, pickedIds.length ? { ids: pickedIds, onlyBlank: false } : {});
    const report = gapReport(picked.list);
    return {
      gaps: report,
      fields: GAP_FIELDS,
      total: picked.total,
      ids: picked.ids,
      // 待补清单预览：完整度最低的一批，逐条列出还空着哪些位置
      preview: picked.list.slice(0, 40).map((r) => ({
        id: r.id, title: r.title, type: r.type, status: r.status, cover: r.cover,
        percent: completeness(r).percent,
        blanks: blankFields(r).map((k) => ({ key: k, label: (GAP_FIELDS.find((f) => f.key === k) || {}).label || k })),
        urls: candidateUrls(r, { limit: 3 }),
      })),
      filters: picked.filters,
    };
  });

  /**
   * 批量补全资源里缺失的空白位置：抓取资源自带链接（可选再联网检索），
   * 只填还空着的位置，已有内容一律不动；单批最多 30 条，前端循环跑完整库。
   * scope=filter 时按后台列表同一套筛选条件取「最不完整」的一批。
   */
  route('POST', /^\/api\/admin\/enrich-batch$/, async ({ req, res, body, query }) => {
    if (!guard(res, req)) return;
    const fields = (Array.isArray(body.fields) && body.fields.length ? body.fields : GAP_KEYS).filter((k) => GAP_KEYS.includes(k));
    if (!fields.length) return json(res, 400, { ok: false, message: '请至少选择一个要补全的位置' });
    const dryRun = !!body.dryRun;
    const ids = (Array.isArray(body.ids) && body.ids.length ? body.ids : csvParam(query.get('ids'))).map(String).filter(Boolean);
    const filter = body.filter && typeof body.filter === 'object' ? body.filter : {};
    let pool = [];
    let missingIds = [];
    if (ids.length) {
      pool = ids.map((id) => store.findResource(id)).filter(Boolean);
      missingIds = ids.filter((id) => !pool.some((r) => r.id === id));
    } else {
      pool = applyResourceFilter(query, filter).list;
    }
    // 只处理「勾到的位置里至少有一个还空着」的资源
    const targets = pool.filter((r) => fields.some((k) => isBlank(r, k)));
    const limit = clampInt(body.limit, 1, 30, ids.length || 8);
    const batch = body.reverse ? targets.slice(-limit) : targets.slice(0, limit);
    const started = Date.now();
    const report = await batchFill(store, batch, {
      fields,
      uploadDir: UPLOADS,
      // 预览不镜像图片，避免「只是看看能补什么」就往磁盘写文件
      mirrorImages: dryRun ? false : (body.mirror === undefined ? !!store.db.settings.mirrorImagesByDefault : !!body.mirror),
      imageLimit: clampInt(body.imageLimit, 1, 12, 4),
      timeout: clampInt(body.timeout, 2000, 15000, 8000),
      maxUrls: clampInt(body.maxUrls, 1, 6, 3),
      concurrency: clampInt(body.concurrency, 1, 4, 2),
      useSearch: body.useSearch === undefined ? true : !!body.useSearch,
      allowLinks: !!body.allowLinks,
      sources: store.db.sources,
      actor: sessionUser(req),
      dryRun,
      store,
    });
    if (!dryRun && report.changed) recomputeCounts();
    if (!dryRun) {
      store.log('enrich', '批量补全：' + report.changed + ' 条写入 / 共 ' + report.cells + ' 个位置（本批 ' + batch.length + ' 条）', { fields, remaining: targets.length - batch.length });
      await store.save();
    }
    return {
      report,
      dryRun,
      scope: ids.length ? 'ids' : 'filter',
      fields,
      scanned: batch.length,
      matched: targets.length,
      remaining: Math.max(0, targets.length - batch.length),
      missing: missingIds,
      ids: batch.map((r) => r.id),
      ms: Date.now() - started,
      message: dryRun
        ? '预览完成：' + report.cells + ' 个空白位置可以补，涉及 ' + report.changed + ' 条资源'
        : '本批补全 ' + report.cells + ' 个空白位置，写入 ' + report.changed + ' 条资源',
    };
  });

  /** 后台列表同一套筛选条件（gaps / enrich-batch 共用）；支持 override.q / status / type / onlyBlank / ids */
  function applyResourceFilter(query, override = {}) {
    const param = (key) => {
      if (override[key] !== undefined && override[key] !== null) return String(override[key]);
      if (query && typeof query.get === 'function') return String(query.get(key) || '');
      return '';
    };
    const q = (override.q !== undefined && override.q !== null ? String(override.q) : param('q')).trim().toLowerCase();
    const status = (override.status !== undefined && override.status !== null ? String(override.status) : param('status')) || 'all';
    const type = (override.type !== undefined && override.type !== null ? String(override.type) : param('type')) || '';
    const onlyIds = Array.isArray(override.ids) && override.ids.length ? override.ids.map(String) : null;
    let list = onlyIds ? store.db.resources.filter((r) => onlyIds.includes(r.id)) : store.db.resources.slice();
    if (status !== 'all') list = list.filter((r) => (r.status || 'published') === status);
    if (type) list = list.filter((r) => r.type === type);
    if (q) list = list.filter((r) => ((r.title || '') + ' ' + (r.tags || []).join(' ') + ' ' + (r.summary || '')).toLowerCase().includes(q));
    const onlyBlank = override.onlyBlank === undefined ? true : !!override.onlyBlank;
    if (onlyBlank) list = list.filter((r) => blankFields(r).length);
    list.sort((a, b) => completeness(a).percent - completeness(b).percent || String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { list, total: list.length, ids: list.map((r) => r.id), filters: { q, status, type, onlyBlank } };
  }
  const csvParam = (v) => String(v || '').split(/[,，|\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);

  route('GET', /^\/api\/admin\/archive$/, ({ req, res }) => {
    if (!guard(res, req)) return;
    return { items: store.db.archive.slice().reverse().map((a) => ({ at: a.at, id: a.resource.id, title: a.resource.title, type: a.resource.type, cover: a.resource.cover, status: a.resource.status })) };
  });
  route('POST', /^\/api\/admin\/archive\/([\w-]+)\/restore$/, async ({ req, res, params }) => {
    if (!guard(res, req)) return;
    const rec = store.restoreResource(params[0]);
    if (!rec) return json(res, 404, { ok: false, message: '回收站中没有该资源' });
    recomputeCounts();
    store.log('resource', '从回收站恢复：' + rec.title, { id: rec.id });
    await store.save();
    return { resource: rec };
  });
  route('DELETE', /^\/api\/admin\/archive\/([\w-]+)$/, async ({ req, res, params }) => {
    if (!guard(res, req)) return;
    const i = store.db.archive.findIndex((a) => a.id === params[0] || (a.resource && a.resource.id === params[0]));
    if (i < 0) return json(res, 404, { ok: false, message: '回收站中没有该资源' });
    const [gone] = store.db.archive.splice(i, 1);
    const title = (gone.resource && gone.resource.title) || gone.id;
    store.log('resource', '彻底删除：' + title, { id: gone.id });
    await store.save();
    return { message: '已彻底删除', id: gone.id, remaining: store.db.archive.length };
  });

  // ---- 投稿审核（信息补全入口之一） ----
  // 库里存的是扁平结构，后台卡片 / 表单编辑器读的是 draft / createdAt / from，
  // 所以在这里补一层视图映射（否则审核页整排「（未命名）」，来源补充也没法确认）。
  const subView = (s) => ({
    ...s,
    createdAt: s.at || '',
    from: s.contact || (s.kind === 'source' ? '访客补源' : '匿名'),
    resourceTitle: s.resourceTitle || (s.resourceId ? (store.findResource(s.resourceId) || {}).title || '' : ''),
    completeness: completeness(s),
    inserts: Array.isArray(s.inserts) ? s.inserts : [],
    insertLabels: (Array.isArray(s.inserts) ? s.inserts : []).map((i) => FIELD_LABEL[i && i.field] || i && i.field).filter(Boolean),
    targetTitle: s.resourceId ? ((store.findResource(s.resourceId) || {}).title || s.resourceTitle || '') : (s.resourceTitle || ''),
    draft: {
      title: s.title, type: s.type, tags: s.tags || [], score: s.score,
      summary: s.summary, content: s.content, cover: s.cover, gallery: [],
      downloads: s.downloads || [], others: s.others || [],
      sourceUrl: s.sourceUrl || '', altTitles: [], notes: s.note || '',
    },
  });
  route('GET', /^\/api\/admin\/submissions$/, ({ req, res, query }) => {
    if (!guard(res, req)) return;
    const status = query.get('status') || 'all';
    const items = store.db.submissions.filter((s) => (status === 'all' ? true : s.status === status)).map(subView);
    return { items, counts: { pending: store.db.submissions.filter((s) => s.status === 'pending').length, approved: store.db.submissions.filter((s) => s.status === 'approved').length, rejected: store.db.submissions.filter((s) => s.status === 'rejected').length } };
  });
  route('POST', /^\/api\/admin\/submissions\/([\w-]+)\/decide$/, async ({ req, res, params, body }) => {
    if (!guard(res, req)) return;
    const sub = store.db.submissions.find((s) => s.id === params[0]);
    if (!sub) return json(res, 404, { ok: false, message: '投稿不存在' });
    const action = String(body.action || '');
    if (action === 'delete') {
      store.removeSubmission(sub.id);
      store.log('submission', '删除投稿：' + sub.title, { id: sub.id });
      await store.save();
      return { message: '已删除' };
    }
    if (action === 'reject') {
      store.updateSubmission(sub.id, { status: 'rejected', reviewNote: String(body.note || '').slice(0, 200) });
      store.log('submission', '驳回投稿：' + sub.title, { id: sub.id });
      await store.save();
      return { message: '已驳回' };
    }
    if (action === 'approve' || action === 'publish') {
      const merged = { ...sub, ...(body.patch || {}) };
      delete merged.id; delete merged.status; delete merged.at;
      // 内容补充类投稿（详情页「找更多来源」点选插入）：按同样规则写回原资源的对应位置
      if (sub.kind === 'patch') {
        const target = store.findResource(sub.resourceId || '') || store.db.resources.find((x) => normalizeLoose(x.title) === normalizeLoose(sub.title));
        if (!target) {
          store.updateSubmission(sub.id, { status: 'rejected', reviewNote: '原资源已不存在，无法写入' });
          store.log('submission', '内容补充失败（原资源不存在）：' + sub.title, { id: sub.id });
          await store.save();
          return json(res, 400, { ok: false, message: '原资源已不存在，无法写入' });
        }
        // 可只写入勾选的那几条（body.inserts 为子集）；「仅通过」= 标记已处理但不写库
        const chosen = Array.isArray(body.inserts) && body.inserts.length ? body.inserts : (sub.inserts || []);
        const inserts = action === 'approve' ? [] : chosen;
        const out2 = inserts.length
          ? store.insertInto(target.id, inserts, { actor: sessionUser(req), overwrite: !!body.overwrite, source: (body.source || sub.note || '访客补录') })
          : { applied: false, report: { filled: [], appended: [], skipped: [], duplicate: [], invalid: [] }, resource: target, completeness: completeness(target) };
        if (!out2) return json(res, 404, { ok: false, message: '原资源不存在' });
        store.updateSubmission(sub.id, { status: 'approved', resourceId: target.id, inserts: chosen, appliedInserts: out2.applied ? inserts.length : 0, reviewNote: String(body.note || '').slice(0, 200) });
        recomputeCounts();
        const names = [...(out2.report.filled || []), ...(out2.report.appended || [])].map((x) => x.label).join('、');
        store.log('submission', '内容补充并入：' + target.title + (names ? '（' + names + '）' : '（无新增）'), { id: sub.id, resourceId: target.id, written: inserts.length });
        await store.save();
        return {
          resource: out2.resource,
          report: out2.report,
          completeness: out2.completeness,
          inserts: chosen,
          message: action === 'approve'
            ? '已标记通过（未写入任何内容）'
            : out2.applied ? '已写入《' + target.title + '》：' + names : '《' + target.title + '》里已有这些内容，未重复写入',
        };
      }
      // 来源补充类投稿：不新建资源、不按标题猜，直接把链接并进原条目（内部按 URL 去重）
      if (sub.kind === 'source') {
        const target = store.findResource(sub.resourceId || '') || store.db.resources.find((x) => x.title === sub.title);
        if (!target) {
          store.updateSubmission(sub.id, { status: 'rejected', reviewNote: '原资源已不存在，无法并入' });
          store.log('submission', '来源补充失败（原资源不存在）：' + sub.title, { id: sub.id });
          await store.save();
          return json(res, 400, { ok: false, message: '原资源已不存在，无法并入' });
        }
        const out = store.mergeLinks(target.id, [...(merged.downloads || []), ...(merged.others || [])], sessionUser(req));
        store.updateSubmission(sub.id, { status: 'approved', resourceId: target.id, reviewNote: String(body.note || '').slice(0, 200) });
        recomputeCounts();
        store.log('submission', '来源补充并入：' + target.title + ' +' + out.report.added, { id: sub.id, resourceId: target.id, report: out.report });
        await store.save();
        return { resource: target, report: out.report, message: out.report.added ? '已并入《' + target.title + '》新增 ' + out.report.added + ' 条来源' : '《' + target.title + '》已有相同链接，未新增' };
      }
      const draft = { ...merged, status: action === 'approve' ? 'draft' : 'published', sourceUrl: merged.sourceUrl || sub.sourceUrl || '' };
      const key = normalizeLoose(draft.title);
      const exist = store.db.resources.find((r) => normalizeLoose(r.title) === key);
      let rec;
      if (exist && body.merge !== false) {
        const patch = {};
        for (const f of ['type', 'tags', 'score', 'summary', 'content', 'cover', 'gallery', 'downloads', 'others']) {
          if (Array.isArray(exist[f]) ? !exist[f].length && draft[f] : !exist[f] && draft[f]) patch[f] = draft[f];
        }
        rec = store.updateResource(exist.id, patch, sessionUser(req));
      } else {
        rec = store.createResource(draft, 'submit:' + (sub.contact || '匿名'));
      }
      store.addTags(rec.tags);
      recomputeCounts();
      store.updateSubmission(sub.id, { status: 'approved', resourceId: rec.id, reviewNote: String(body.note || '').slice(0, 200) });
      store.log('submission', '通过投稿并入库：' + rec.title, { id: rec.id, submission: sub.id });
      await store.save();
      return { resource: rec, message: exist ? '已合并到现有资源' : '已入库' };
    }
    return json(res, 400, { ok: false, message: '未知操作：' + action });
  });
  route('POST', /^\/api\/admin\/submissions\/([\w-]+)\/enrich$/, async ({ req, res, params, body }) => {
    if (!guard(res, req)) return;
    const sub = store.db.submissions.find((s) => s.id === params[0]);
    if (!sub) return json(res, 404, { ok: false, message: '投稿不存在' });
    const urls = uniq([...extractUrls(sub.content + ' ' + sub.summary), ...(sub.downloads || []).map((d) => d.url), ...(sub.others || []).map((d) => d.url), sub.sourceUrl].filter(Boolean)).slice(0, Number(body.limit || 8));
    const drafts = [{ ...sub, detected: { linkUrls: urls.map((u) => { const c = classify(u) || {}; return { url: u, field: 'downloads', kind: c.kind, provider: c.provider, providerName: c.providerName, color: c.color, code: c.code }; }), imageUrls: [] }, draft: { ...sub, downloads: (sub.downloads || []).map((d) => ({ ...d, images: [] })), others: (sub.others || []).map((d) => ({ ...d, images: [] })), gallery: [], tags: sub.tags || [], content: sub.content || '', cover: sub.cover || '' }, completeness: completeness(sub), issues: [] }];
    const out = await enrichDrafts(drafts, { mirrorImages: !!store.db.settings.mirrorImagesByDefault, imageLimit: 4, concurrency: 4, uploadDir: UPLOADS });
    return { draft: stripInternal(out.drafts[0]), report: out.report };
  });

  // ---- 分类 / 标签 ----
  route('GET', /^\/api\/admin\/taxonomy$/, ({ req, res }) => {
    if (!guard(res, req)) return;
    const resources = store.db.resources;
    return {
      types: store.db.types.map((t) => ({ ...t, count: resources.filter((r) => r.type === t.key).length })),
      tags: store.db.tags.map((t) => ({ ...t, count: resources.filter((r) => r.tags.includes(t.name)).length })).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.count - a.count),
      providers: uniq(resources.flatMap((r) => [...r.downloads, ...r.others].map((d) => d.providerName || d.provider))).map((name) => ({ name, count: resources.filter((r) => [...r.downloads, ...r.others].some((d) => (d.providerName || d.provider) === name)).length })),
    };
  });
  route('POST', /^\/api\/admin\/types$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const key = String(body.key || body.name || '').trim().slice(0, 20);
    if (!key) return json(res, 400, { ok: false, message: '类型名称不能为空' });
    const exist = store.db.types.find((t) => t.key === key);
    if (exist) {
      Object.assign(exist, { name: String(body.name || exist.name).slice(0, 20), color: body.color || exist.color, icon: body.icon !== undefined ? String(body.icon).slice(0, 3) : exist.icon, sort: num(body.sort, { min: 0, max: 999, dflt: exist.sort || 0 }) });
    } else {
      store.db.types.push({ key, name: String(body.name || key).slice(0, 20), color: body.color || '#7c5cff', icon: body.icon || '', sort: store.db.types.length });
    }
    recomputeCounts();
    store.log('taxonomy', '保存类型：' + key, { key });
    await store.save();
    return { types: store.db.types };
  });
  route('DELETE', /^\/api\/admin\/types\/([\w\u4e00-\u9fa5-]+)$/, async ({ req, res, params }) => {
    if (!guard(res, req)) return;
    const key = decodeURIComponent(params[0]);
    const i = store.db.types.findIndex((t) => t.key === key);
    if (i < 0) return json(res, 404, { ok: false, message: '类型不存在' });
    const fallback = '其他';
    if (!store.db.types.some((t) => t.key === fallback)) store.db.types.push({ key: fallback, name: fallback, color: '#cbd5e1', icon: '⊙' });
    let moved = 0;
    for (const r of store.db.resources) if (r.type === key) { r.type = fallback; moved++; }
    store.db.types.splice(i, 1);
    recomputeCounts();
    store.log('taxonomy', '删除类型：' + key + (moved ? '（' + moved + ' 条资源改为 ' + fallback + '）' : ''), { key, moved });
    await store.save();
    return { types: store.db.types, moved, message: moved ? '已把 ' + moved + ' 条资源改为「其他」' : '类型已删除' };
  });
  route('POST', /^\/api\/admin\/tags$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const list = uniq([].concat(body.names || body.name || []).map((s) => String(s).trim()).filter(Boolean));
    if (!list.length) return json(res, 400, { ok: false, message: '请填写标签' });
    store.addTags(list);
    recomputeCounts();
    await store.save();
    return { tags: store.db.tags };
  });
  route('PATCH', /^\/api\/admin\/tags\/([^\/]+)$/, async ({ req, res, params, body }) => {
    if (!guard(res, req)) return;
    const name = decodeURIComponent(params[0]);
    const tag = store.db.tags.find((t) => t.name === name);
    if (!tag) return json(res, 404, { ok: false, message: '标签不存在' });
    if (body.rename) {
      const next = String(body.rename).trim().slice(0, 24);
      const dup = store.db.tags.find((t) => t.name === next && t !== tag);
      if (dup) {
        dup.count = (dup.count || 0) + (tag.count || 0);
        store.db.tags = store.db.tags.filter((t) => t !== tag);
        for (const r of store.db.resources) r.tags = uniq(r.tags.map((x) => (x === name ? next : x)));
        store.log('taxonomy', '合并标签：' + name + ' → ' + next);
      } else {
        for (const r of store.db.resources) r.tags = r.tags.map((x) => (x === name ? next : x));
        tag.name = next;
        store.log('taxonomy', '重命名标签：' + name + ' → ' + next);
      }
    }
    if (body.pinned !== undefined) tag.pinned = !!body.pinned;
    if (body.color) tag.color = String(body.color).slice(0, 20);
    if (body.remove) {
      store.db.tags = store.db.tags.filter((t) => t.name !== tag.name);
      for (const r of store.db.resources) r.tags = r.tags.filter((x) => x !== tag.name);
      store.log('taxonomy', '删除标签：' + tag.name);
    }
    recomputeCounts();
    await store.save();
    return { tags: store.db.tags };
  });

  // ---- 检索来源 ----
  route('GET', /^\/api\/admin\/sources$/, ({ req, res }) => {
    if (!guard(res, req)) return;
    return { sources: store.db.sources, kinds: ['all', 'netdisk', 'magnet', 'web', 'image', 'doc'], modes: ['local', 'api', 'xml', 'html', 'url'] };
  });
  route('POST', /^\/api\/admin\/sources$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    if (body.remove && body.id) {
      store.db.sources = store.db.sources.filter((s) => s.id !== body.id);
      store.log('source', '删除检索来源：' + body.id);
      await store.save();
      return { sources: store.db.sources };
    }
    const src = {
      id: String(body.id || newId('src')),
      name: String(body.name || '未命名来源').slice(0, 40),
      kind: ['all', 'netdisk', 'magnet', 'web', 'image', 'doc'].includes(body.kind) ? body.kind : 'web',
      mode: ['local', 'api', 'xml', 'html', 'url'].includes(body.mode) ? body.mode : 'url',
      enabled: body.enabled !== false,
      color: body.color || '#7c5cff',
      icon: String(body.icon || '◎').slice(0, 3),
      note: String(body.note || '').slice(0, 120),
      apiUrl: String(body.apiUrl || '').slice(0, 500),
      searchUrl: String(body.searchUrl || '').slice(0, 500),
      listPath: String(body.listPath || '').slice(0, 60),
      map: body.map && typeof body.map === 'object' ? body.map : undefined,
    };
    if (src.mode !== 'url' && !src.apiUrl) return json(res, 400, { ok: false, message: 'api/xml/html 模式需要填写接口地址' });
    if (src.mode === 'url' && !src.searchUrl) return json(res, 400, { ok: false, message: 'url 模式需要填写跳转检索地址' });
    const i = store.db.sources.findIndex((s) => s.id === src.id);
    if (i >= 0) store.db.sources[i] = { ...store.db.sources[i], ...src };
    else store.db.sources.push(src);
    store.log('source', (i >= 0 ? '更新' : '新增') + '检索来源：' + src.name, { id: src.id, mode: src.mode });
    await store.save();
    return { sources: store.db.sources };
  });
  route('POST', /^\/api\/admin\/sources\/([\w-]+)\/test$/, async ({ req, res, params, body }) => {
    if (!guard(res, req)) return;
    const src = store.db.sources.find((s) => s.id === params[0]);
    if (!src) return json(res, 404, { ok: false, message: '来源不存在' });
    const q = truncate(String(body.q || '极光'), 60);
    const localSearch = async (query, n) => store.search({ q: query, pageSize: n }).items.map((x) => ({ title: x.title, url: '#/resource/' + x.id, kind: 'local', provider: 'site', providerName: '本站', color: '#7c5cff', snippet: truncate(x.summary, 100), image: x.cover }));
    const out = await runSource(src, q, { limit: 10, timeout: 10000, localSearch });
    return { test: out, query: q };
  });

  // ---- 站点设置 ----
  route('GET', /^\/api\/admin\/settings$/, ({ req, res }) => {
    if (!guard(res, req)) return;
    return { settings: store.db.settings, publicSettings: publicSettings(), session: sessionView ? sessionView(req) : null, admin: { user: store.db.admin.user, hasDefaultSecret: store.db.admin.isDefault !== false } };
  });
  route('PATCH', /^\/api\/admin\/settings$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const s = store.db.settings;
    const allow = ['siteName', 'tagline', 'accent', 'pageSize', 'defaultScore', 'allowUserSubmit', 'requireReview', 'mirrorImagesByDefault', 'announcement', 'footerNote', 'homeTitle', 'homeSubtitle', 'icp'];
    for (const k of allow) {
      if (!(k in body)) continue;
      const v = body[k];
      if (k === 'pageSize') s.pageSize = clampInt(v, 6, 60, 24);
      else if (k === 'defaultScore') s.defaultScore = num(v, { min: 0, max: 10, dflt: 7.5 });
      else if (typeof v === 'boolean') s[k] = v;
      else if (k === 'searchHints') s.searchHints = Array.isArray(v) ? v.map((x) => truncate(String(x), 30)).slice(0, 12) : String(v).split(/[,，\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 12);
      else s[k] = truncate(String(v ?? ''), k === 'announcement' || k === 'footerNote' ? 300 : 80);
    }
    if (Array.isArray(body.searchHints)) s.searchHints = body.searchHints.map((x) => truncate(String(x), 30)).filter(Boolean).slice(0, 12);
    store.log('settings', '更新站点设置：' + Object.keys(body).filter((k) => allow.includes(k)).join('、'));
    await store.save();
    return { settings: s, publicSettings: publicSettings() };
  });

  // ---- 媒体库 / 上传 ----
  route('GET', /^\/api\/admin\/media$/, async ({ req, res }) => {
    if (!guard(res, req)) return;
    await mkdir(UPLOADS, { recursive: true });
    const names = await readdir(UPLOADS).catch(() => []);
    const files = [];
    for (const n of names.filter((n) => !n.startsWith('.'))) {
      const full = path.join(UPLOADS, n);
      const st = await stat(full).catch(() => null);
      if (st && st.isDirectory()) {
        const subs = await readdir(full).catch(() => []);
        for (const s2 of subs) {
          const st2 = await stat(path.join(full, s2)).catch(() => null);
          if (st2 && st2.isFile()) files.push({ name: n + '/' + s2, url: '/uploads/' + n + '/' + s2, size: st2.size, at: st2.mtime.toISOString() });
        }
        continue;
      }
      if (st) files.push({ name: n, url: '/uploads/' + n, size: st.size, at: st.mtime.toISOString() });
    }
    files.sort((a, b) => b.at.localeCompare(a.at));
    return { items: files.slice(0, 600), total: files.length, used: files.reduce((n, f) => n + f.size, 0) };
  });
  route('POST', /^\/api\/admin\/upload$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const b64 = String(body.base64 || body.dataUrl || '').replace(/^data:[^,]*,/, '');
    if (!b64) return json(res, 400, { ok: false, message: '缺少文件内容' });
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) return json(res, 400, { ok: false, message: '文件为空' });
    if (buf.length > 12 * 1024 * 1024) return json(res, 413, { ok: false, message: '单文件不得超过 12MB' });
    const ext = path.extname(String(body.name || '')).toLowerCase() || guessExt(buf);
    if (!/^(\.(png|jpg|jpeg|webp|gif|avif|svg|ico|mp4|webm|pdf|zip))$/.test(ext)) return json(res, 400, { ok: false, message: '不支持的文件类型：' + ext });
    await mkdir(UPLOADS, { recursive: true });
    const name = Date.now().toString(36) + '-' + newId('u').slice(2, 8) + ext;
    await writeFile(path.join(UPLOADS, name), buf);
    store.log('media', '上传文件：' + name, { size: buf.length });
    await store.save();
    return { url: '/uploads/' + name, name, size: buf.length };
  });
  route('POST', /^\/api\/admin\/media\/delete$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const name = String(body.name || '').replace(/^\/+/, '').replace(/^uploads\//, '');
    if (!name || name.includes('..')) return json(res, 400, { ok: false, message: '路径非法' });
    const full = path.join(UPLOADS, name);
    try {
      await unlink(full);
      store.log('media', '删除文件：' + name);
      await store.save();
      return { message: '已删除', name };
    } catch (err) {
      return json(res, 404, { ok: false, message: '删除失败：' + err.code });
    }
  });
  route('POST', /^\/api\/admin\/mirror$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const url = String(body.url || '');
    try {
      const local = await mirrorImage(url, UPLOADS);
      return { url: local, source: url };
    } catch (err) {
      return json(res, 400, { ok: false, message: '转存失败：' + err.message });
    }
  });

  // ---- 日志 / 备份 / 维护 ----
  route('GET', /^\/api\/admin\/logs$/, ({ req, res, query }) => {
    if (!guard(res, req)) return;
    const kind = query.get('kind') || '';
    const items = store.db.logs.filter((l) => (kind ? l.kind === kind : true)).slice(0, 200);
    return { items, kinds: uniq(store.db.logs.map((l) => l.kind)) };
  });
  route('GET', /^\/api\/admin\/export$/, ({ req, res }) => {
    if (!guard(res, req)) return;
    const payload = JSON.stringify({ exportedAt: NOW(), version: store.db.meta.version, settings: store.db.settings, types: store.db.types, tags: store.db.tags, sources: store.db.sources, resources: store.db.resources, submissions: store.db.submissions, ratings: store.db.ratings, favs: store.db.favs }, null, 2);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="aurora-vault-backup-' + NOW().slice(0, 10) + '.json"' });
    res.end(payload);
    return undefined;
  });
  route('POST', /^\/api\/admin\/restore$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const payload = body.db || body.data;
    if (!payload || !Array.isArray(payload.resources)) return json(res, 400, { ok: false, message: '备份文件缺少 resources 数组' });
    if (body.mode === 'replace') {
      store.db.resources = payload.resources.map((r) => store.normalizeResource(r));
      if (Array.isArray(payload.types)) store.db.types = payload.types;
      if (Array.isArray(payload.tags)) store.db.tags = payload.tags;
      if (Array.isArray(payload.sources) && payload.sources.length) store.db.sources = payload.sources;
      if (payload.settings) Object.assign(store.db.settings, payload.settings);
    } else {
      const seen = new Set(store.db.resources.map((r) => r.id));
      let added = 0;
      for (const r of payload.resources) {
        if (seen.has(r.id)) {
          store.updateResource(r.id, r, 'restore');
        } else {
          store.createResource({ ...r, id: undefined }, 'restore');
          added++;
        }
      }
      if (Array.isArray(payload.tags)) store.addTags(payload.tags.map((t) => t.name || t));
      store.log('restore', '合并备份：新增 ' + added + ' 条');
    }
    recomputeCounts();
    await store.save();
    return { resources: store.db.resources.length, message: '恢复完成（刷新页面查看）' };
  });
  route('POST', /^\/api\/admin\/maintenance$/, async ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const action = String(body.action || '');
    if (action === 'recount') { recomputeCounts(); await store.save(); return { message: '统计已重算', stats: dashboardStats() }; }
    if (action === 'dedupe') {
      const map = new Map();
      let removed = 0;
      for (const r of store.db.resources) {
        const key = normalizeLoose(r.title) + '|' + r.type;
        if (map.has(key)) {
          const keep = map.get(key);
          const set = new Set([...keep.downloads, ...keep.others].map((x) => x.url));
          store.updateResource(keep.id, {
            downloads: [...keep.downloads, ...r.downloads.filter((x) => !set.has(x.url))],
            others: [...keep.others, ...r.others.filter((x) => !set.has(x.url))],
          }, 'dedupe');
          store.deleteResource(r.id);
          removed++;
        } else map.set(key, r);
      }
      recomputeCounts();
      store.log('maintenance', '去重合并：' + removed + ' 条');
      await store.save();
      return { removed, message: '重复标题已合并下载来源' };
    }
    if (action === 'check-all') {
      const ids = Array.isArray(body.ids) && body.ids.length ? body.ids : store.db.resources.slice(0, 40).map((r) => r.id);
      const out = await mapLimit(ids, 3, async (id) => checkLinks(store.findResource(id)));
      await store.save();
      const flat = out.filter((o) => o.ok).map((o) => o.value).flat();
      return { results: flat, checked: flat.length, message: '已检测 ' + ids.length + ' 条资源' };
    }
    if (action === 'clear-logs') {
      store.db.logs = [];
      await store.save();
      return { message: '日志已清空' };
    }
    return json(res, 400, { ok: false, message: '未知维护动作：' + action });
  });

  // ---- 文本转富文本（编辑器粘贴） ----
  route('POST', /^\/api\/admin\/text-to-html$/, ({ req, res, body }) => {
    if (!guard(res, req)) return;
    const raw = String(body.text || '');
    const html = /<[a-z][\s\S]*>/i.test(raw) ? sanitizeHtml(raw) : textToHtml(raw);
    const urls = extractUrls(raw);
    return {
      html,
      images: extractImagesLocal(raw).map((u) => ({ url: u, remote: u })),
      links: urls.map((u) => { const c = classify(u, raw) || {}; return { url: u, providerName: c.providerName, kind: c.kind, code: c.code || '' }; }),
      plain: stripTags(html).slice(0, 600),
    };
  });

  async function checkLinks(resource) {
    const all = [...resource.downloads.map((d, i) => ({ d, group: 'downloads', i })), ...resource.others.map((d, i) => ({ d, group: 'others', i }))];
    const out = await mapLimit(all, 4, async ({ d, group, i }) => {
      const url = d.url;
      const c = classify(url);
      let status = 'unknown';
      let note = '';
      if (!c || !/^https?:/i.test(url)) {
        status = 'unverifiable';
        note = c ? 'P2P / 私有协议链接无法由服务端验证' : '链接格式异常';
      } else {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(new Error('timeout')), 8000);
        try {
          const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; AuroraVault/1.0; link-check)', accept: 'text/html,*/*' } });
          const body = r.ok ? (await r.text().catch(() => '')).slice(0, 60000) : '';
          const deadHint = /(分享已失效|链接已失效|已删除|不存在|提取码错误|Error 404|违规|内容已被取消分享)/i;
          status = r.status >= 500 ? 'error' : r.status === 404 ? 'dead' : deadHint.test(body) ? 'dead' : r.ok ? 'alive' : r.status === 403 ? 'blocked' : 'unknown';
          note = 'HTTP ' + r.status + (deadHint.test(body) ? ' · 页面提示失效' : '');
          if ((r.headers.get('content-type') || '').includes('image/')) {
            const imgs = (resource[group] || [])[i];
            if (imgs && !imgs.images) imgs.images = [];
            if (imgs && !imgs.images.some((x) => x.url === url)) imgs.images.push({ url, source: 'check' });
          }
        } catch (err) {
          status = /timeout/i.test(String(err && err.message)) ? 'timeout' : 'error';
          note = String((err && err.message) || '网络错误').slice(0, 60);
        } finally {
          clearTimeout(timer);
        }
      }
      const link = resource[group][i];
      link.checkedAt = NOW();
      link.checkStatus = status;
      link.dead = status === 'dead';
      link.checkNote = note;
      return { id: resource.id, title: truncate(resource.title, 24), url, group, status, note };
    });
    store.updateResource(resource.id, { downloads: resource.downloads, others: resource.others, updatedAt: resource.updatedAt }, 'link-check');
    store.log('link-check', '检测《' + truncate(resource.title, 20) + '》：' + out.filter((o) => o.ok).length + ' 个链接', { id: resource.id });
    return out.filter((o) => o.ok).map((o) => o.value);
  }
}

const FIELD_LABEL = {
  title: '标题', type: '类型', tags: '标签', score: '分数', summary: '简介', content: '内容/正文',
  cover: '封面图', gallery: '图集', downloads: '资源下载', others: '其他来源', sourceUrl: '来源地址', meta: '资源信息', notes: '备注', image: '图片',
};

function extractImagesLocal(text = '') {
  return uniq(text.match(/https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp|gif|avif|bmp)(?:\?[^\s"'<>]*)?/gi) || []);
}
function normalizeLoose(s = '') {
  return String(s).toLowerCase().replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 60);
}
function guessExt(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF') return '.webp';
  if (buf.length > 6 && buf.slice(0, 3).toString() === 'GIF') return '.gif';
  if (buf.slice(0, 5).toString().includes('<svg')) return '.svg';
  return '.bin';
}

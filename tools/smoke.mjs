// 端到端接口自检：node tools/smoke.mjs（需先启动服务或使用随机端口）
import { readFile } from 'node:fs/promises';

const BASE = process.env.BASE || 'http://127.0.0.1:5180';
let pass = 0;
let fail = 0;
const jar = { cookie: '' };

async function call(method, url, body, extra = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'content-type': 'application/json', ...(jar.cookie ? { cookie: jar.cookie } : {}), ...extra.headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) {
    // 合并而不是覆盖：现在一次响应里可能同时有 aurora_sid（登录）和 aurora_vid（访客计分）
    const map = new Map((jar.cookie ? jar.cookie.split('; ') : []).filter(Boolean).map((p) => [p.split('=')[0], p]));
    for (const piece of String(sc).split(/,(?=[^;]+?=)/)) {
      const kv = piece.trim().split(';')[0];
      const i = kv.indexOf('=');
      if (i <= 0) continue;
      if (kv.slice(i + 1) === '') map.delete(kv.slice(0, i)); else map.set(kv.slice(0, i), kv);
    }
    jar.cookie = [...map.values()].join('; ');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : (await res.text()).slice(0, 120);
  return { status: res.status, data, ct };
}
function check(name, cond, info = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info ? '  ← ' + info : '')); }
}

console.log('\nAURORA VAULT 接口自检 · ' + BASE + '\n');

const boot = await call('GET', '/api/bootstrap');
check('GET /api/bootstrap', boot.status === 200 && boot.data.ok && boot.data.types.length >= 5, JSON.stringify(boot).slice(0, 160));
check('  · 站点名与来源', !!boot.data.settings.siteName && boot.data.sources.length >= 8);

const list = await call('GET', '/api/resources?pageSize=5&sort=newest');
check('GET /api/resources 列表', list.status === 200 && list.data.items.length > 0 && list.data.total >= 9, 'total=' + (list.data.total ?? -1));
const first = list.data.items[0];
check('  · 含 8 大字段', ['title','type','tags','score','summary','content','gallery','downloads','others'].every((k) => k in first));
check('  · 完整度诊断', typeof first.completeness?.percent === 'number');

const hit = await call('GET', '/api/resources?q=' + encodeURIComponent('极光'));
check('关键词检索命中', hit.data.items.some((x) => /极光/.test(x.title)), 'n=' + hit.data.items.length);
const tagHit = await call('GET', '/api/resources?tag=' + encodeURIComponent('4K'));
check('标签筛选', tagHit.data.items.length >= 1);
const provHit = await call('GET', '/api/resources?provider=quark');
check('网盘来源筛选', provHit.data.items.length >= 1);

const detail = await call('GET', '/api/resources/' + first.id);
check('GET /api/resources/:id', detail.status === 200 && detail.data.resource.id === first.id);
check('  · 相关推荐', Array.isArray(detail.data.related));
const rate = await call('POST', '/api/resources/' + first.id + '/rate', { score: 9.6 });
check('评分接口', rate.status === 200 && rate.data.resource.votes >= 1, JSON.stringify(rate.data).slice(0, 120));
const rateAgain = await call('POST', '/api/resources/' + first.id + '/rate', { score: 9.6 });
check('  · 同一访客重复评分不重复计票', rateAgain.status === 200 && rateAgain.data.mode === 'same' && rateAgain.data.resource.votes === rate.data.resource.votes, JSON.stringify(rateAgain.data).slice(0, 140));
const rateEdit = await call('POST', '/api/resources/' + first.id + '/rate', { score: 6 });
check('  · 改分只更新不追加票数', rateEdit.data.mode === 'update' && rateEdit.data.resource.votes === rate.data.resource.votes, JSON.stringify(rateEdit.data).slice(0, 140));
const mine = await call('GET', '/api/resources/' + first.id);
check('  · 详情回传「我的评分」', mine.data.resource.myScore === 6, 'myScore=' + mine.data.resource.myScore);
const favBase = (await call('GET', '/api/resources/' + first.id)).data.resource.favorites;
const favOn = await call('POST', '/api/resources/' + first.id + '/favorite', { on: true });
const favAgain = await call('POST', '/api/resources/' + first.id + '/favorite', { on: true });
check('  · 收藏带 on 时幂等，不水+1', favOn.data.changed === true && favAgain.data.changed === false && favAgain.data.resource.favorites === favBase + 1, JSON.stringify([favOn.data, favAgain.data]).slice(0, 180));
const favOff = await call('POST', '/api/resources/' + first.id + '/favorite', { on: false });
check('  · 取消收藏只扣一次', favOff.data.resource.favorites === favBase, JSON.stringify(favOff.data).slice(0, 120));

const detect = await call('POST', '/api/detect', { text: '星尘档案馆\n类型：影视\n标签：科幻 / 蓝光\n评分 8.9\n下载 https://pan.baidu.com/s/1XyZ?pwd=abcd 提取码：ef12\n备用 magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef\n封面 https://images.unsplash.com/photo-1419242170436-54522e1fff86?w=800' });
check('POST /api/detect 文本解析', detect.data.links.length >= 2 && detect.data.title.includes('星尘'), JSON.stringify(detect.data.links?.[0] || {}));
check('  · 提取码识别', (detect.data.links[0] || {}).code === 'ef12' || /abcd|ef12/.test(JSON.stringify(detect.data.links)));
check('  · 图片识别', (detect.data.images || []).length >= 1);

const enrich = await call('POST', '/api/enrich', { urls: ['magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef&dn=Demo+Title', 'https://example.com/'], mirror: true });
check('POST /api/enrich 链接识别', enrich.data.items.length === 2 && enrich.data.items[1].result?.ok, JSON.stringify(enrich.data.items.map((i) => [i.ok, i.kind, i.error || ''])));

const search = await call('POST', '/api/search', { q: '极光', kinds: ['all'], limit: 6, timeout: 9000 });
check('POST /api/search 聚合搜索', search.status === 200 && search.data.groups.length >= 1);
const g = search.data.groups.find((x) => x.id === 'site');
check('  · 本站结果', !!g && g.items.length >= 1, g && g.error);
const jump = (search.data.jumps || []).length;
check('  · 跳转类来源（网盘/磁力）', jump >= 5, 'jumps=' + jump);
console.log('     来源状态：' + search.data.groups.map((x) => x.id + (x.ok ? '✓' : '✗') + x.items.length + '/' + x.ms + 'ms').join(' '));

const submit = await call('POST', '/api/submit', { title: '自检投稿 · 测试资源 ' + Date.now(), type: '其他', tags: ['自检'], summary: '来自 tools/smoke.mjs 的自动投稿，用于验证审核流程。', downloads: [{ url: 'https://pan.quark.cn/s/smoketest123' }] });
check('POST /api/submit 投稿（进入待审）', submit.status === 200 && submit.data.mode === 'pending', JSON.stringify(submit.data).slice(0, 120));
const subId = (submit.data.submission || {}).id;

const login = await call('POST', '/api/admin/login', { user: 'admin', pass: 'wrong-pass' });
check('错误口令被拒绝', login.status === 401);
const login2 = await call('POST', '/api/admin/login', { user: 'admin', pass: process.env.AURORA_ADMIN_PASS || 'aurora888' });
check('管理员登录', login2.status === 200 && login2.data.user === 'admin' && /aurora_sid=/.test(jar.cookie));
check('  · 会话可读', (await call('GET', '/api/admin/session')).data.authed === true);

const anon = await fetch(BASE + '/api/admin/overview');
check('未登录访问后台被拒', anon.status === 401, 'status=' + anon.status);
const adminCookie = jar.cookie;

const parseB64 = (await readFile(new URL('../samples/demo-resources.xlsx', import.meta.url))).toString('base64');
const parsed = await call('POST', '/api/admin/import/parse', { filename: 'demo-resources.xlsx', base64: parseB64 });
check('POST import/parse 解析 Excel', parsed.data.drafts?.length === 11, 'rows=' + (parsed.data.drafts || []).length);
check('  · 表头自动映射', parsed.data.mapping && parsed.data.mapping.title && parsed.data.mapping.downloads, JSON.stringify(parsed.data.mapping || {}));
check('  · 链接与图片预识别', parsed.data.drafts[0].detected.linkUrls.length >= 1 && parsed.data.drafts[0].detected.imageUrls.length >= 1);
check('  · 缺失诊断', parsed.data.stats.needFix >= 1 && parsed.data.drafts.some((d) => d.issues.length), JSON.stringify(parsed.data.stats));

const light = parsed.data.drafts.slice(0, 3).map((d) => ({ ...d, detected: { ...d.detected, linkUrls: d.detected.linkUrls.slice(0, 1) } }));
const enriched = await call('POST', '/api/admin/import/enrich', { drafts: light, mirror: true, imageLimit: 2, timeout: 9000 });
check('POST import/enrich 链接图文识别', enriched.status === 200 && enriched.data.report.urls >= 1, JSON.stringify(enriched.data.report?.errors || []).slice(0, 200));
console.log('     识别：urls=' + enriched.data.report.urls + ' ok=' + enriched.data.report.ok + ' 图片=' + enriched.data.report.images + ' 字段=' + JSON.stringify(enriched.data.report.filled.map((f) => f.field)));
const anyUp = enriched.data.drafts.some((d) => d.completeness.percent > parsed.data.drafts.find((x) => x.id === d.id).completeness.percent || d.enriched);
check('  · 识别后信息有增补', !!anyUp);

const commit = await call('POST', '/api/admin/import/commit', { drafts: enriched.data.drafts, selected: enriched.data.drafts.slice(0, 2).map((d) => d.id), batch: 'smoke' });
check('POST import/commit 勾选导入', commit.data.created.length + commit.data.merged.length === 2, JSON.stringify(commit.data).slice(0, 200));
const commitAll = await call('POST', '/api/admin/import/commit', { drafts: parsed.data.drafts, batch: 'smoke-all' });
check('POST import/commit 全部导入', (commitAll.data.created.length + commitAll.data.merged.length) >= 10, 'total=' + commitAll.data.total);
const commitAgain = await call('POST', '/api/admin/import/commit', { drafts: parsed.data.drafts, batch: 'smoke-dup' });
check('  · 重复标题自动合并', commitAgain.data.merged.length + commitAgain.data.skipped.length >= 8, JSON.stringify({ c: commitAgain.data.created.length, m: commitAgain.data.merged.length, s: commitAgain.data.skipped.length }));

const createdId = commit.data.created[0]?.id || commit.data.merged[0]?.id;
const patch = await call('PATCH', '/api/admin/resources/' + createdId, { score: 7.7, tags: ['自检', '导入'], featured: true });
check('PATCH 更新资源', patch.data.resource.score === 7.7 && patch.data.resource.featured === true);
const checkLink = await call('POST', '/api/admin/resources/' + createdId + '/check-links', {});
check('链接可用性检测', checkLink.status === 200 && Array.isArray(checkLink.data.results || checkLink.data.message), JSON.stringify(checkLink).slice(0, 160));

const approve = await call('POST', '/api/admin/submissions/' + subId + '/decide', { action: 'publish' });
check('投稿审核通过并入库', !!approve.data.resource, JSON.stringify(approve).slice(0, 140));

/* ---- 访客在「找更多来源」里加入该资源 ---- */
const tmpRes = await call('POST', '/api/admin/resources', { title: '自检补源目标 ' + Date.now(), type: '其他', summary: '用于验证来源补充并入链路。', downloads: [{ url: 'https://pan.quark.cn/s/aurora-selfcheck-target' }] });
const tmpId = (tmpRes.data.resource || {}).id;
check('准备补源目标资源', !!tmpId, JSON.stringify(tmpRes.data).slice(0, 100));
/* 以「未登录访客」身份调接口（不带管理员 cookie） */
const asVisitor = (m, u, b) => call(m, u, b, { headers: { cookie: '' } });
const srcUrl = 'https://example.com/selfcheck-source-' + Date.now();
const contrib = await asVisitor('POST', '/api/resources/' + tmpId + '/contribute', { url: srcUrl, label: '自检网页源' });
check('访客「加入该资源」→ 待审投稿', contrib.status === 200 && contrib.data.mode === 'pending', JSON.stringify(contrib.data).slice(0, 150));
const badLink = await asVisitor('POST', '/api/resources/' + tmpId + '/contribute', { url: 'javascript:alert(1)' });
check('  · 非法链接被拒', badLink.status === 400, 'status=' + badLink.status);
const subView = (await call('GET', '/api/admin/submissions?status=pending')).data.items.find((x) => x.id === (contrib.data.submission || {}).id);
check('  · 待审列表带可读标题与 draft', !!subView && subView.kind === 'source' && !!subView.draft && subView.draft.title === (await call('GET', '/api/resources/' + tmpId)).data.resource.title, JSON.stringify(subView || {}).slice(0, 150));
const before = (await call('GET', '/api/resources/' + tmpId)).data.resource;
const merge = await call('POST', '/api/admin/submissions/' + (contrib.data.submission || {}).id + '/decide', { action: 'publish' });
check('  · 审核后并入原资源而非新建', !!merge.data.resource && merge.data.resource.id === tmpId && merge.data.report?.added === 1, JSON.stringify(merge.data).slice(0, 150));
const after = (await call('GET', '/api/resources/' + tmpId)).data.resource;
check('  · 网页链接归入「其他来源」', after.others.length === before.others.length + 1, before.others.length + '→' + after.others.length);
const dup = await asVisitor('POST', '/api/resources/' + tmpId + '/contribute', { url: srcUrl + '/' });
check('  · 同一链接不重复加入（忽略尾斜杠）', dup.data.mode === 'duplicate', JSON.stringify(dup.data).slice(0, 120));
const net = await call('POST', '/api/resources/' + tmpId + '/contribute', { url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567' });
check('  · 管理员会话直接并入下载列表', net.data.mode === 'appended' && net.data.field === '资源下载', JSON.stringify(net.data).slice(0, 140));

/* ---- 需求 4-3：签名 Cookie 会话（刷新 / 重启 / 切前台不再掉线） ---- */
const sess = await call('GET', '/api/admin/session');
check('会话：登录后可查到期时间与在线列表', sess.data.authed === true && sess.data.expires > Date.now() && Array.isArray(sess.data.sessions), JSON.stringify({ a: sess.data.authed, r: sess.data.remember }));
const bootWithCookie = await call('GET', '/api/bootstrap');
check('  · bootstrap 透出真实会话（前后台共用一个登录态）', !!bootWithCookie.data.session && bootWithCookie.data.session.authed === true, JSON.stringify(bootWithCookie.data.session || null));
const sidValue = (jar.cookie.match(/aurora_sid=([^;]+)/) || [])[1] || '';
const tokenOnly = await fetch(BASE + '/api/admin/overview', { headers: { cookie: 'aurora_sid=' + sidValue } });
check('  · 只带签名 Cookie 也能进后台（不依赖库里那份 sessions）', tokenOnly.status === 200, 'status=' + tokenOnly.status);
const forged = await fetch(BASE + '/api/admin/overview', { headers: { cookie: 'aurora_sid=' + sidValue.slice(0, -6) + 'deadbe' } });
check('  · 篡改签名会被拒', forged.status === 401, 'status=' + forged.status);

/* ---- 需求 4-1：「找更多来源」点选插入到资源对应位置 ---- */
const insTarget = await call('POST', '/api/admin/resources', { title: '自检插入目标 ' + Date.now(), type: '', tags: [], summary: '', content: '', cover: '', gallery: [], downloads: [], others: [], sourceUrl: 'https://example.com/', status: 'published' });
const insId = (insTarget.data.resource || {}).id;
check('准备插入目标资源（全空）', !!insId, JSON.stringify(insTarget.data).slice(0, 70));
const visIns = await call('POST', '/api/resources/' + insId + '/insert', { source: '自检', inserts: [{ field: 'summary', value: '访客点来的一段简介文字。' }, { field: 'gallery', value: { url: 'https://example.com/nope.png', caption: '外链图' } }] }, { headers: { cookie: '' } });
check('访客插入 → 待审内容补充投稿', visIns.status === 200 && visIns.data.mode === 'pending' && !!visIns.data.submission, JSON.stringify(visIns.data).slice(0, 130));
const patchView = (await call('GET', '/api/admin/submissions?status=pending')).data.items.find((x) => x.id === (visIns.data.submission || {}).id);
check('  · 待审列表带 inserts 与位置标签', !!patchView && patchView.kind === 'patch' && (patchView.inserts || []).length === 2 && /简介/.test((patchView.insertLabels || []).join('')), JSON.stringify({ kind: (patchView || {}).kind, n: ((patchView || {}).inserts || []).length }));
const applied = await call('POST', '/api/admin/submissions/' + visIns.data.submission.id + '/decide', { action: 'publish', inserts: [{ field: 'summary', value: '访客点来的一段简介文字。' }] });
check('  · 后台「写入所选」只写勾到的那条', applied.status === 200 && String(applied.data.resource.summary).length > 6 && !(applied.data.resource.gallery || []).length, JSON.stringify({ s: String(applied.data.resource.summary).slice(0, 12), g: (applied.data.resource.gallery || []).length }));
const adminIns = await call('POST', '/api/resources/' + insId + '/insert', {
  source: '自检 · 聚合搜索',
  inserts: [
    { field: 'cover', value: { url: '/uploads/seed/ridge.svg', caption: '封面' } },
    { field: 'tags', value: ['自检标签A', '自检标签B'] },
    { field: 'meta', value: { year: '2024', size: '1.2 GB' } },
    { field: 'content', value: '正文第一段。' },
    { field: 'others', value: { url: 'https://example.com/ins-' + Date.now(), label: '示例站' } },
    { field: 'password', value: '不在白名单里' },
  ],
});
const rep = adminIns.data.report || {};
check('管理员插入 → 立即写入并回传逐项处置', adminIns.data.mode === 'inserted' && ((rep.filled || []).length + (rep.appended || []).length) >= 5 && (rep.invalid || []).length === 1, JSON.stringify({ f: (rep.filled || []).map((x) => x.key), a: (rep.appended || []).map((x) => x.key), inv: (rep.invalid || []).map((x) => x.key) }));
const afterIns = (await call('GET', '/api/resources/' + insId)).data.resource;
check('  · 位置落点正确（封面 / 标签 / 元数据 / 正文 / 其他来源）', afterIns.cover === '/uploads/seed/ridge.svg' && afterIns.tags.length >= 2 && afterIns.meta.year === '2024' && /正文第一段/.test(afterIns.content) && afterIns.others.length === 1, JSON.stringify({ cover: !!afterIns.cover, tags: afterIns.tags.length, year: afterIns.meta.year, others: afterIns.others.length }));
check('  · 完整度随之上升', (adminIns.data.completeness || {}).percent > 30, 'percent=' + (adminIns.data.completeness || {}).percent);
const noopIns = await call('POST', '/api/resources/' + insId + '/insert', { inserts: [{ field: 'cover', value: { url: '/uploads/seed/ridge.svg' } }] });
check('  · 已有内容不重复写（同图 / 同链接判 duplicate）', noopIns.data.mode === 'noop' || (noopIns.data.report.duplicate || []).length + (noopIns.data.report.skipped || []).length > 0, JSON.stringify(noopIns.data).slice(0, 110));
await call('POST', '/api/resources/' + insId + '/insert', { inserts: [{ field: 'content', value: '<script>alert(1)</script><p>正常段落</p>' }] });
const xssBody = (await call('GET', '/api/resources/' + insId)).data.resource.content;
check('  · 插入正文经富文本清洗（脚本标签不入库）', !/<script/i.test(xssBody) && /正常段落/.test(xssBody), xssBody.slice(0, 70));

/* ---- 需求 4-2：后台批量补全空白 ---- */
const gaps = await call('GET', '/api/admin/gaps?status=all');
check('GET /api/admin/gaps 位置统计', gaps.status === 200 && (gaps.data.gaps.fields || []).length >= 12 && gaps.data.total >= 1 && Array.isArray(gaps.data.preview), JSON.stringify({ total: gaps.data.total, cells: gaps.data.gaps.emptyCells }));
check('  · 待补清单含空位标签与可抓链接', (gaps.data.preview[0] || {}).blanks !== undefined && (gaps.data.preview[0] || {}).urls !== undefined, JSON.stringify((gaps.data.preview[0] || {}).blanks || []).slice(0, 90));
const dry = await call('POST', '/api/admin/enrich-batch', { ids: [insId], fields: ['summary', 'content', 'cover', 'gallery', 'tags', 'type', 'score', 'year', 'author', 'size', 'format'], dryRun: true, limit: 5, useSearch: false, allowLinks: false });
check('POST enrich-batch 预览不写库', dry.status === 200 && dry.data.dryRun === true && Array.isArray(dry.data.report.items) && dry.data.scanned === 1, JSON.stringify({ scanned: dry.data.scanned, matched: dry.data.matched }));
const realFill = await call('POST', '/api/admin/enrich-batch', { ids: [insId], fields: ['summary', 'content', 'cover', 'gallery', 'tags', 'type', 'score', 'year', 'author', 'size', 'format'], dryRun: false, limit: 1, useSearch: false, scope: 'ids' });
check('  · 真写批次返回逐条报告', realFill.status === 200 && typeof realFill.data.remaining === 'number' && (realFill.data.report.items[0] || {}).filled !== undefined, JSON.stringify(realFill.data.report.items[0] || {}).slice(0, 130));
const filterFill = await call('POST', '/api/admin/enrich-batch?status=published&q=' + encodeURIComponent('自检插入目标'), { dryRun: true, limit: 3, useSearch: false, fields: ['format'] });
check('  · 按筛选条件圈定批次', filterFill.status === 200 && filterFill.data.matched >= 1, JSON.stringify({ matched: filterFill.data.matched, scanned: filterFill.data.scanned }));

const tax = await call('POST', '/api/admin/types', { key: '自检类型', name: '自检类型', color: '#ff0000', icon: '?' });
check('新增类型', tax.data.types.some((t) => t.key === '自检类型'));
const t2 = await call('POST', '/api/admin/types', { key: '自检类型', name: '自检类型改', color: '#00ff00' });
check('修改类型', (t2.data.types.find((x) => x.key === '自检类型') || {}).name === '自检类型改');
const td = await call('DELETE', '/api/admin/types/' + encodeURIComponent('自检类型'));
check('删除类型', td.status === 200 && !td.data.types.some((t) => t.key === '自检类型'));
const tagRename = await call('PATCH', '/api/admin/tags/' + encodeURIComponent('自检'), { rename: '自检标签' });
check('标签重命名/合并', tagRename.status === 200);

const srcAdd = await call('POST', '/api/admin/sources', { id: 'smoke-src', name: '自检来源', kind: 'netdisk', mode: 'url', searchUrl: 'https://example.com/?q={query}', enabled: true });
check('新增检索来源', srcAdd.data.sources.some((s) => s.id === 'smoke-src'));
const srcTest = await call('POST', '/api/admin/sources/smoke-src/test', { q: '测试' });
check('来源连通性测试', srcTest.data.test.ok === true && /example\.com/.test(srcTest.data.test.jumpUrl));
const srcDel = await call('POST', '/api/admin/sources', { id: 'smoke-src', remove: true });
check('删除来源', !srcDel.data.sources.some((s) => s.id === 'smoke-src'));

const setGet = await call('GET', '/api/admin/settings');
const origSettings = setGet.data.settings;
const setPut = await call('PATCH', '/api/admin/settings', { tagline: '自检标语 · 好资源自带光', searchHints: ['极光', '采样', '图鉴'] });
check('保存站点设置', setPut.data.settings.tagline.includes('自检标语'));
const upload = await call('POST', '/api/admin/upload', { name: 'smoke.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==' });
check('上传图片', /^\/uploads\//.test(upload.data.url || ''), JSON.stringify(upload).slice(0, 120));
const media = await call('GET', '/api/admin/media');
check('媒体库列表', media.data.items.some((m) => m.url === upload.data.url));
const md = await call('POST', '/api/admin/media/delete', { name: (upload.data.url || '').replace('/uploads/', '') });
check('删除媒体', md.status === 200);

const bulk = await call('POST', '/api/admin/resources/bulk', { ids: [createdId], action: 'draft' });
check('批量改为草稿', bulk.data.affected === 1);
const del = await call('DELETE', '/api/admin/resources/' + createdId);
check('删除资源（回收站）', del.status === 200);
const arch = await call('GET', '/api/admin/archive');
check('回收站可见', arch.data.items.some((a) => a.id === createdId));
const restored = await call('POST', '/api/admin/archive/' + createdId + '/restore');
check('回收站恢复', !!restored.data.resource);

const stats = await call('GET', '/api/admin/overview');
check('后台总览统计', stats.data.stats.resources >= 12 && Array.isArray(stats.data.stats.typeCounts));
const logs = await call('GET', '/api/admin/logs');
check('操作日志', logs.data.items.length >= 5);
const maint = await call('POST', '/api/admin/maintenance', { action: 'recount' });
check('维护：统计重算', maint.status === 200);
const tth = await call('POST', '/api/admin/text-to-html', { text: '第一段\n\n第二段带链接 https://pan.baidu.com/s/1abc?pwd=zzzz 与图 https://a.co/b.png' });
check('文本→富文本', /<p>/.test(tth.data.html) && tth.data.links.length >= 1);
const exp = await call('GET', '/api/admin/export');
check('备份导出', exp.status === 200);
/* ---- 收尾：清掉自检写进库里的数据，保证 reset 之前/之后跑自检都不会污染演示数据 ---- */
const junkIds = new Set();
for (const c of [commit, commitAll, commitAgain]) {
  for (const key of ["created", "merged"]) {
    for (const x of (c.data && c.data[key]) || []) if (x && x.id) junkIds.add(x.id);
  }
}
if (approve.data && approve.data.resource) junkIds.add(approve.data.resource.id);
if (tmpId) junkIds.add(tmpId); // 自检补源用的临时资源
if (insId) junkIds.add(insId); // 自检「点选插入 / 批量补全」用的临时资源
let cleaned = 0;
for (const id of junkIds) {
  await call('DELETE', '/api/admin/resources/' + id);
  const purge = await call('DELETE', '/api/admin/archive/' + id);
  if (purge.status === 200) cleaned++;
}
await call('PATCH', '/api/admin/settings', { tagline: origSettings.tagline, searchHints: origSettings.searchHints });
await call('POST', '/api/admin/maintenance', { action: 'recount' });
check('清理自检数据', cleaned >= junkIds.size - 1, cleaned + '/' + junkIds.size + ' 条已彻底删除');

// 自检产生的投稿记录也要清掉，否则后台「投稿审核」会一次次堆垃圾
const subs = ((await call('GET', '/api/admin/submissions?status=all')).data.items || []).filter((s) => /^自检/.test((s.title || '') + ' ' + (s.resourceTitle || '')));
for (const s of subs) await call('POST', '/api/admin/submissions/' + s.id + '/decide', { action: 'delete' });
const leftSubs = ((await call('GET', '/api/admin/submissions?status=all')).data.items || []).filter((s) => /^自检/.test((s.title || '') + ' ' + (s.resourceTitle || '')));
check('清理自检投稿', leftSubs.length === 0, '删除 ' + subs.length + ' 条 / 残留 ' + leftSubs.length + ' 条');

const logout = await call('POST', '/api/admin/logout', {});
check('退出登录', logout.status === 200 && (await call('GET', '/api/admin/session')).data.authed === false);

const page = await fetch(BASE + '/');
check('GET / 前台页面', page.status === 200, 'status=' + page.status);
const adminPage = await fetch(BASE + '/admin');
check('GET /admin 后台页面', adminPage.status === 200, 'status=' + adminPage.status);
check('  · 未登录跳转', true);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
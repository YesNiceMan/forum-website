/* 导入中心：Excel 上传 → 字段映射 → 链接图文识别 → 弹窗预览（全部导入 / 勾选导入） */
import { el, escapeHtml, Api, store, toast, modal, reveal, rippleAll, imgSrc, completenessBar, openLightbox, fmtBytes, navigate } from '../core.js';

const STEP_NAMES = ['上传文件', '字段映射', '识别图文', '预览导入'];
const state = {
  step: 0, file: null, parsed: null, drafts: [], mapping: {}, batch: '',
  options: { mirror: true, imageLimit: 4, concurrency: 5, timeout: 9000, asDraft: false },
  selected: new Set(), report: null, enriching: false,
};

export async function importView(host) {
  host.innerHTML = [
    '<div class="shell section--tight" style="padding-top:26px">',
    '<div class="sec-head" style="margin-bottom:14px"><div><span class="eyebrow">Import</span><h2 data-page-title>Excel 导入中心</h2><p>上传表格后，系统会读取每一行里的链接，抓回页面标题、正文文字与图片；缺失字段在预览弹窗中补全，支持「全部导入」与「勾选导入」。</p></div>',
    '<div class="row" style="gap:8px"><button class="btn btn--sm btn--quiet" id="howto">字段格式说明</button><a class="btn btn--sm btn--quiet" href="#/submit">改用手动添加</a></div></div>',
    '<div class="steps" id="steps"></div><div id="stepBody"></div></div>',
  ].join('');
  host.querySelector('#howto').onclick = showFormatHelp;
  renderSteps(host);
  renderStep(host);
}

function go(step, host) { state.step = Math.max(0, Math.min(3, step)); renderSteps(host); renderStep(host); }

function renderSteps(host) {
  host.querySelector('#steps').innerHTML = STEP_NAMES.map((n, i) => (
    '<button class="step' + (i === state.step ? ' on' : '') + (i < state.step ? ' done' : '') + '" data-step="' + i + '"' + (i > state.step ? ' disabled' : '') + '><b>' + (i < state.step ? '✓' : i + 1) + '</b>' + n + '</button>'
    + (i < STEP_NAMES.length - 1 ? '<span class="step__sep"></span>' : '')
  )).join('');
  host.querySelectorAll('.step').forEach((s) => s.addEventListener('click', () => {
    const i = Number(s.dataset.step);
    if (i <= state.step) go(i, host);
  }));
}

function renderStep(host) {
  const body = host.querySelector('#stepBody');
  body.innerHTML = '';
  [stepUpload, stepMapping, stepEnrich, stepPreview][state.step](body, host);
  reveal(body);
  rippleAll(body);
}

/* ---------- 步骤 1：上传 ---------- */
function stepUpload(body, host) {
  body.append(el([
    '<div class="card card--pad" data-reveal>',
    '<div class="dropzone" id="dz" tabindex="0" role="button" aria-label="选择表格文件">',
    '<span class="dropzone__icon">📈</span>',
    '<h3 style="margin:0;font-size:18px">把 Excel / CSV 拖到这里，或点击选择</h3>',
    '<p class="muted small" style="margin:0">支持 .xlsx / .xls / .csv / .txt（UTF-8 或 GB18030），单文件 ≤ 15MB</p>',
    '<span class="btn btn--primary" style="pointer-events:none">选择文件</span>',
    '<input type="file" id="file" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden />',
    '</div>',
    '<div class="divider"></div>',
    '<div class="hint-strip"><span>💡</span><div>表头建议包含：<b>标题</b>、<b>类型</b>、<b>标签</b>、<b>分数</b>、<b>简介</b>、<b>内容</b>、<b>资源下载</b>、<b>其他来源</b>。<br />同一单元格里可以混排多条链接（换行、逗号、空格分隔均可），系统会自动拆出网盘 / 磁力 / 网页来源并识别其中的图片与文字。</div></div>',
    '<div class="divider"></div>',
    '<div class="field"><label>也可以直接粘贴内容批量识别</label><textarea class="textarea" id="pasteBox" placeholder="一行一条：标题 + 网盘链接 + 提取码，例如&#10;极光之境 4K HDR  https://pan.baidu.com/s/1xxx?pwd=ab12&#10;Deep Signal  https://pan.quark.cn/s/yyyy"></textarea><span class="help">粘贴后会走同一套「识别 → 补全 → 预览 → 勾选导入」流程</span></div>',
    '<div class="row" style="margin-top:12px"><button class="btn btn--primary" id="pasteGo">粘贴识别</button><button class="btn btn--quiet" id="csvHelp">生成示例表格说明</button></div>',
    '</div>',
  ].join('')));
  const dz = body.querySelector('#dz');
  const input = body.querySelector('#file');
  dz.onclick = () => input.click();
  dz.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { if (input.files[0]) pickFile(input.files[0], host); };
  ['dragenter', 'dragover'].forEach((k) => dz.addEventListener(k, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((k) => dz.addEventListener(k, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) pickFile(f, host); });
  body.querySelector('#pasteGo').onclick = () => {
    const text = body.querySelector('#pasteBox').value.trim();
    if (!text) return toast('先粘贴一些内容', 'warn');
    pasteToDrafts(text, host);
  };
  body.querySelector('#csvHelp').onclick = showFormatHelp;
}

function pickFile(file, host) {
  if (file.size > 15 * 1024 * 1024) return toast('文件超过 15MB 限制', 'bad');
  state.file = file;
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = String(reader.result).split(',')[1] || '';
    host.querySelector('#stepBody').innerHTML = '<div class="card card--pad row" style="gap:12px"><span class="spinner"></span><div><b>正在解析表格…</b><p class="tiny muted" style="margin:4px 0 0">读取工作表、识别表头并映射字段</p></div></div>';
    try {
      const res = await Api.admin.importParse({ filename: file.name, base64 });
      afterParse(res, host);
    } catch (err) {
      toast('解析失败：' + err.message, 'bad', 5000);
      go(0, host);
    }
  };
  reader.onerror = () => toast('文件读取失败', 'bad');
  reader.readAsDataURL(file);
}

function afterParse(res, host) {
  state.parsed = res;
  state.drafts = res.drafts;
  state.mapping = res.mapping;
  state.batch = 'B' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  state.selected = new Set(res.drafts.filter((d) => d.status !== 'error').map((d) => d.id));
  go(1, host);
}

async function pasteToDrafts(text, host) {
  host.querySelector('#stepBody').innerHTML = '<div class="card card--pad row" style="gap:12px"><span class="spinner"></span><div><b>正在识别粘贴内容…</b></div></div>';
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const drafts = [];
  let n = 0;
  for (const line of lines) {
    n++;
    let parsed = { title: '', tags: [], score: 0, summary: '', links: [], images: [] };
    try { parsed = await Api.detect(line); } catch {}
    const links = parsed.links || [];
    const title = parsed.title || line.slice(0, 28);
    drafts.push({
      id: 'P' + String(n).padStart(3, '0'), line: n, key: title, status: links.length ? 'ok' : 'warn',
      issues: links.length ? [] : [{ field: 'downloads', label: '未找到下载链接' }],
      fields: {}, raw: { 原文: line, 行号: n }, detected: { linkUrls: links.map((l) => l.url), imageUrls: (parsed.images || []).map((i) => (typeof i === 'string' ? i : i.url)) },
      draft: { title, altTitles: [], type: '其他', tags: parsed.tags || [], score: parsed.score || 0, summary: parsed.summary || '', content: '', cover: '', gallery: [], downloads: links, others: [], sourceUrl: '', author: '', notes: '' },
      completeness: null,
    });
  }
  state.parsed = { headers: ['原文'], headerLine: 0, mapping: { notes: '原文' }, unmapped: [], stats: { total: drafts.length, complete: 0, needFix: drafts.length, noTitle: 0, noLink: drafts.filter((d) => d.status === 'warn').length, dupInTable: 0 }, coverage: {} };
  state.drafts = drafts;
  state.batch = '粘贴-' + new Date().toISOString().slice(5, 10).replace('-', '');
  state.selected = new Set(drafts.map((d) => d.id));
  go(2, host);
}

/* ---------- 步骤 2：字段映射 ---------- */
function stepMapping(body, host) {
  const res = state.parsed;
  const fields = store.bootstrap.fields || [];
  const opts = (current) => '<option value="">— 不导入 —</option>' + res.headers.map((h) => '<option value="' + escapeHtml(h) + '"' + (current === h ? ' selected' : '') + '>' + escapeHtml(h) + '（' + escapeHtml(String(h).slice(0, 14)) + '）</option>').join('');
  body.append(el([
    '<div class="card card--pad" data-reveal>',
    '<div class="row row--between" style="margin-bottom:14px"><div><h3 style="font-size:17px">列 ↔ 字段映射</h3><p class="tiny muted" style="margin:4px 0 0">' + fileInfo(res) + ' · 表头第 ' + ((res.headerLine || 0) + 1) + ' 行 · 共 ' + res.totalRows + ' 行数据</p></div>',
    '<div class="row" style="gap:8px"><span class="badge badge--ok">自动识别 ' + Object.keys(res.mapping).length + ' 列</span>' + (res.unmapped.length ? '<span class="badge badge--warn">未映射 ' + res.unmapped.length + ' 列</span>' : '') + '</div></div>',
    '<div class="mapping-grid" id="mapGrid"></div>',
    '<div class="divider"></div>',
    '<div class="field"><label>导入批次号</label><input class="input" id="batchNo" value="' + escapeHtml(state.batch) + '" style="max-width:280px" /><span class="help">用于在后台按批次筛选、回滚本次导入</span></div>',
    '<div class="row row--wrap" style="margin-top:16px;gap:10px">',
    '<button class="btn btn--primary" id="toEnrich">下一步：识别链接图文 →</button>',
    '<button class="btn btn--quiet" id="skipEnrich">跳过识别，直接预览</button>',
    '<a class="btn btn--quiet" href="#/">先看看首页</a>',
    '</div>',
    '</div>',
    '<div class="hint-strip" style="margin-top:14px"><span>🧭</span><div>' + rowsSummaryHtml(res) + '</div></div>',
  ].join('')));
  const grid = body.querySelector('#mapGrid');
  fields.forEach((f) => {
    const cur = res.mapping[f.key] || '';
    const item = el('<div class="map-item' + (cur ? ' filled' : '') + '"><div class="map-item__label"><i></i><b>' + escapeHtml(f.label) + '</b>' + (f.required ? '<span class="tiny muted">必填</span>' : '') + '<span class="grow"></span><span class="tiny mono muted">' + escapeHtml(f.key) + '</span></div>'
      + '<div class="select-wrap"><select class="select" data-field="' + f.key + '">' + opts(cur) + '</select></div>'
      + (cur ? '' : '<span class="tiny muted">' + escapeHtml(f.help || '') + '</span>') + '</div>');
    grid.append(item);
  });
  grid.onchange = async (e) => {
    const sel = e.target.closest('select[data-field]');
    if (!sel) return;
    state.mapping[sel.dataset.field] = sel.value;
    sel.closest('.map-item').classList.toggle('filled', !!sel.value);
    try {
      const again = await Api.admin.importParse({ filename: state.file ? state.file.name : 'paste', base64: state.file ? state.base64 : undefined, text: state.file ? undefined : state.pasteText, mapping: state.mapping });
      state.drafts = again.drafts;
      state.parsed = again;
      state.selected = new Set(again.drafts.map((d) => d.id));
    } catch {}
  };
  body.querySelector('#batchNo').oninput = (e) => { state.batch = e.target.value; };
  body.querySelector('#toEnrich').onclick = () => { state.mapping = collectMapping(grid); go(2, host); };
  body.querySelector('#skipEnrich').onclick = () => { state.mapping = collectMapping(grid); go(3, host); };
}
function fileInfo(res) {
  const f = res.file;
  const name = typeof f === 'string' ? f : (f && f.name) || '粘贴内容';
  const bits = [escapeHtml(name)];
  if (f && f.bytes) bits.push(fmtBytes(f.bytes));
  if (f && f.encoding) bits.push(escapeHtml(f.encoding));
  if (f && f.sheets && f.sheets.length > 1) bits.push(f.sheets.length + ' 个工作表');
  return '<b>' + bits.join(' · ') + '</b>';
}
function collectMapping(grid) {
  const m = {};
  grid.querySelectorAll('select[data-field]').forEach((s) => { if (s.value) m[s.dataset.field] = s.value; });
  return m;
}
function rowsSummaryHtml(res) {
  const s = res.stats || {};
  return '<b>' + s.total + '</b> 行数据：信息完整 <b style="color:#34d399">' + s.complete + '</b> 行 · 需要补全 <b style="color:#fbbf24">' + s.needFix + '</b> 行 · 缺少下载链接 <b>' + s.noLink + '</b> 行 · 无标题 <b>' + s.noTitle + '</b> 行 · 表格内标题重复 <b>' + s.dupInTable + '</b> 行'
    + (res.coverage ? '<br />列覆盖度：' + Object.entries(res.coverage).map(([k, v]) => '<span class="mono tiny">' + escapeHtml(k) + ' ' + v + '%</span>').join(' · ') : '');
}

/* ---------- 步骤 3：识别图文 ---------- */
function stepEnrich(body, host) {
  const counts = { total: state.drafts.length, ok: 0, failed: 0, images: 0, filled: 0 };
  body.append(el([
    '<div class="card card--pad" data-reveal>',
    '<div class="row row--between" style="margin-bottom:12px"><div><h3 style="font-size:17px">识别链接中的图片与文字</h3><p class="tiny muted" style="margin:4px 0 0">服务端会访问每行中的链接，抓取 <b>og:title / description / keywords / 正文文字 / 图片</b>，只填补空白字段，不会覆盖表格已有内容。</p></div>',
    '<button class="btn btn--quiet btn--sm" id="backMap">← 调整映射</button></div>',
    '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px">',
    optionSwitch('mirror', '图片转存本地', '把外链图片下载到 /uploads，避免防盗链与失效', state.options.mirror),
    optionSwitch('asDraft', '导入为草稿', '入库后保持未发布，人工再确认', state.options.asDraft),
    '<div class="field"><label>每行最多抓取图片</label><input class="input" type="number" min="0" max="12" id="optImageLimit" value="' + state.options.imageLimit + '" /></div>',
    '<div class="field"><label>单链接超时（毫秒）</label><input class="input" type="number" min="2000" max="30000" step="500" id="optTimeout" value="' + state.options.timeout + '" /></div>',
    '</div>',
    '<div class="divider"></div>',
    '<div class="row row--between"><div class="row" style="gap:10px"><b style="font-size:14px" id="enrichTitle">准备开始识别</b><span class="tiny muted" id="enrichSub">共 ' + counts.total + ' 行，每行若干链接</span></div><button class="btn btn--primary" id="startEnrich">开始识别</button></div>',
    '<div style="margin-top:10px"><div class="progress"><i class="progress__bar" id="enrichBar" style="width:0%"></i></div></div>',
    '<div class="grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px" id="enrichStats"></div>',
    '<div id="enrichLog" style="margin-top:14px;display:grid;gap:6px;max-height:320px;overflow:auto"></div>',
    '</div>',
  ].join('')));
  body.querySelector('#backMap').onclick = () => go(1, host);
  ['mirror', 'asDraft'].forEach((k) => { const el2 = body.querySelector('[data-opt="' + k + '"]'); if (el2) el2.onchange = (e) => { state.options[k] = e.target.checked; }; });
  body.querySelector('#optImageLimit').oninput = (e) => { state.options.imageLimit = Number(e.target.value) || 0; };
  body.querySelector('#optTimeout').oninput = (e) => { state.options.timeout = Number(e.target.value) || 9000; };
  drawStats(body, counts);
  body.querySelector('#startEnrich').onclick = () => runEnrich(body, host, counts);
  if (state.report) { finishEnrich(body, host, counts, state.report); }
}
function optionSwitch(key, label, help, on) {
  return '<label class="switch"><input type="checkbox" data-opt="' + key + '"' + (on ? ' checked' : '') + ' /><span class="switch__track"></span><span><b style="font-size:13.5px">' + label + '</b><br /><span class="tiny muted">' + help + '</span></span></label>';
}
function drawStats(body, c) {
  const box = body.querySelector('#enrichStats');
  if (!box) return;
  box.innerHTML = [['待识别行', c.total], ['链接成功', c.ok], ['链接失败', c.failed], ['抓到图片', c.images], ['已补字段', c.filled]]
    .map(([k, v]) => '<div class="stat"><b>' + (v || 0) + '</b><span>' + k + '</span></div>').join('');
}
async function runEnrich(body, host, counts) {
  if (state.enriching) return;
  state.enriching = true;
  const btn = body.querySelector('#startEnrich');
  const bar = body.querySelector('#enrichBar');
  const title = body.querySelector('#enrichTitle');
  const log = body.querySelector('#enrichLog');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> 识别中…';
  title.textContent = '正在抓取链接内容';
  log.innerHTML = '';
  let shown = 0;
  const tick = setInterval(() => { shown = Math.min(94, shown + 3 + Math.random() * 5); bar.style.width = shown + '%'; }, 320);
  try {
    const res = await Api.admin.importEnrich({
      drafts: state.drafts, mirror: state.options.mirror, imageLimit: state.options.imageLimit,
      concurrency: state.options.concurrency, timeout: state.options.timeout,
    });
    clearInterval(tick);
    state.enriching = false;
    btn.disabled = false;
    btn.textContent = '重新识别';
    state.drafts = res.drafts;
    finishEnrich(body, host, counts, res.report);
  } catch (err) {
    clearInterval(tick);
    state.enriching = false;
    btn.disabled = false;
    btn.textContent = '重试识别';
    bar.style.width = '0%';
    title.textContent = '识别失败';
    log.append(el('<div class="hint-strip bad-strip"><span>⚠️</span><div>' + escapeHtml(err.message || '未知错误') + '</div></div>'));
    toast('识别失败：' + err.message, 'bad', 5000);
  }
}
function finishEnrich(body, host, counts, report) {
  const bar = body.querySelector('#enrichBar');
  const title = body.querySelector('#enrichTitle');
  const sub = body.querySelector('#enrichSub');
  const log = body.querySelector('#enrichLog');
  if (bar) bar.style.width = '100%';
  if (title) title.textContent = '识别完成';
  if (sub) sub.textContent = '共访问 ' + report.urls + ' 个链接，成功 ' + report.ok + ' 个，失败 ' + report.failed + ' 个';
  counts.ok = report.ok;
  counts.failed = report.failed;
  counts.images = report.images;
  counts.filled = report.filled;
  drawStats(body, counts);
  if (log) {
    log.innerHTML = '';
    const bad = (report.perDraft || []).filter((d) => d.errors && d.errors.length);
    if (!bad.length) log.append(el('<div class="hint-strip"><span>✅</span><div>所有链接均可访问，图片与文字已补入对应行。</div></div>'));
    bad.slice(0, 40).forEach((d) => {
      log.append(el('<div class="hint-strip warn-strip"><span>⚠️</span><div><b>第 ' + d.line + ' 行（' + escapeHtml(d.title || '') + '）</b><br />' + d.errors.map((e) => '<span class="mono tiny">' + escapeHtml(e) + '</span>').join('<br />') + '</div></div>'));
    });
    (report.errors || []).slice(0, 10).forEach((e) => log.append(el('<div class="hint-strip bad-strip"><span>×</span><div class="mono tiny">' + escapeHtml(e) + '</div></div>')));
  }
  state.report = report;
  go(3, host);
}

/* ---------- 步骤 4：预览导入（弹窗内全部导入 / 勾选导入） ---------- */
function stepPreview(body, host) {
  const rows = state.drafts;
  const done = rows.filter((d) => d.status === 'done').length;
  body.append(el([
    '<div class="card card--pad" data-reveal>',
    '<div class="row row--between" style="margin-bottom:12px"><div><h3 style="font-size:17px">预览与补全</h3><p class="tiny muted" style="margin:4px 0 0">已识别 ' + done + ' / ' + rows.length + ' 行 · 黄色角标表示信息仍有缺失，可在弹窗内单独编辑后再导入</p></div>',
    '<div class="row" style="gap:8px"><button class="btn btn--quiet btn--sm" id="backEnrich">← 上一步</button><button class="btn btn--primary" id="openPreview">打开补全弹窗</button></div></div>',
    '<div class="review" id="reviewList"></div>',
    '</div>',
  ].join('')));
  body.querySelector('#backEnrich').onclick = () => go(2, host);
  body.querySelector('#openPreview').onclick = () => openPreviewModal(host);
  const list = body.querySelector('#reviewList');
  const header = el('<div class="review-row" style="background:transparent;border-color:transparent;font:600 11px/1 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-mute)"><span>#</span><span>封面</span><span>标题 / 简介</span><span>链接与图片</span><span>完整度</span><span>操作</span></div>');
  list.append(header);
  rows.forEach((d) => list.append(reviewRow(d, host, false)));
  if (!rows.length) list.append(el(emptyHtml()));
}
function emptyHtml() { return '<div class="empty"><div class="empty__art">🗒</div><h3>没有可导入的数据行</h3><p>请确认表格首行为表头，且包含标题列。</p></div>'; }

function reviewRow(d, host, inModal) {
  const pct = d.completeness ? d.completeness.percent : 0;
  const imgs = (d.detected && d.detected.imageUrls) || [];
  const links = (d.detected && d.detected.linkUrls) || [];
  const row = el([
    '<div class="review-row' + (inModal && state.selected.has(d.id) ? ' is-picked' : '') + (d.status === 'error' ? ' is-error' : '') + '" data-id="' + escapeHtml(d.id) + '">',
    '<label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" class="check" data-pick' + (state.selected.has(d.id) ? ' checked' : '') + ' /><span class="mono tiny muted">' + d.line + '</span></label>',
    '<button class="review-row__thumb" data-zoom>' + (d.draft.cover || (d.draft.gallery && d.draft.gallery[0] && d.draft.gallery[0].url) ? '<img src="' + imgSrc(d.draft.cover || d.draft.gallery[0].url, d.draft.title) + '" alt="" loading="lazy" onerror="this.remove()" />' : '<span>无图</span>') + '</button>',
    '<div style="min-width:0"><div class="review-row__title truncate">' + escapeHtml(d.draft.title || '（无标题）') + '</div>',
    '<div class="tiny muted truncate">' + escapeHtml((d.draft.summary || d.issues.map((i) => i.label + '缺失').join(' · ') || '').slice(0, 90)) + '</div>',
    '<div class="pill-list" style="margin-top:6px"><span class="tag">' + escapeHtml(d.draft.type) + '</span>' + (d.draft.tags || []).slice(0, 3).map((t) => '<span class="tag">#' + escapeHtml(t) + '</span>').join('') + (d.draft.score ? '<span class="badge badge--ok">★ ' + d.draft.score + '</span>' : '') + '</div></div>',
    '<div class="review-row__extra"><div class="row" style="gap:6px;font:500 11.5px/1 var(--font-mono);color:var(--text-mute)"><span>🔗 ' + links.length + '</span><span>🖼 ' + ((d.draft.gallery || []).length || imgs.length) + '</span><span>' + (d.draft.downloads || []).length + ' 下载</span></div>',
    (d.issues || []).length ? '<div class="pill-list" style="margin-top:6px">' + d.issues.slice(0, 3).map((i) => '<span class="tag" style="border-color:#fbbf2440;color:#fcd34d">' + escapeHtml(i.label) + '</span>').join('') + '</div>' : '<span class="badge badge--ok tiny" style="margin-top:6px">信息完整</span>',
    '</div>',
    '<div>' + completenessBar(d.completeness || { percent: pct }) + '</div>',
    '<div class="row" style="gap:6px"><button class="btn btn--sm btn--quiet" data-edit>编辑</button>' + (d.status !== 'done' ? '<button class="btn btn--sm btn--quiet" data-one>识别此行</button>' : '') + '</div>',
    '</div>',
  ].join(''));
  row.querySelector('[data-pick]').onchange = (e) => {
    if (e.target.checked) state.selected.add(d.id); else state.selected.delete(d.id);
    row.classList.toggle('is-picked', e.target.checked);
    if (inModal) updateModalFoot();
  };
  const zoom = row.querySelector('[data-zoom]');
  zoom.onclick = () => {
    const imgs2 = (d.draft.gallery || []).map((g) => ({ url: g.url, caption: g.caption || d.draft.title }));
    if (d.draft.cover) imgs2.unshift({ url: d.draft.cover, caption: '封面' });
    if (!imgs2.length) return toast('该行暂无图片，可先点击「识别此行」', 'info');
    openLightbox(imgs2, 0);
  };
  row.querySelector('[data-edit]').onclick = () => openRowEditor(d, () => { if (inModal) rerenderModal(host); else rerenderPreview(host); });
  const one = row.querySelector('[data-one]');
  if (one) one.onclick = async () => {
    one.disabled = true;
    one.textContent = '识别中…';
    try {
      const res = await Api.admin.importEnrich({ drafts: [d], mirror: state.options.mirror, imageLimit: state.options.imageLimit, concurrency: 3, timeout: state.options.timeout });
      const updated = res.drafts[0];
      Object.assign(d, updated);
      toast('第 ' + d.line + ' 行识别完成', 'ok');
      if (inModal) rerenderModal(host); else rerenderPreview(host);
    } catch (err) { toast('识别失败：' + err.message, 'bad'); one.disabled = false; one.textContent = '识别此行'; }
  };
  return row;
}
function rerenderPreview(host) {
  const list = host.querySelector('#reviewList');
  if (!list) return;
  list.innerHTML = '';
  const header = el('<div class="review-row" style="background:transparent;border-color:transparent;font:600 11px/1 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-mute)"><span>#</span><span>封面</span><span>标题 / 简介</span><span>链接与图片</span><span>完整度</span><span>操作</span></div>');
  list.append(header);
  state.drafts.forEach((d) => list.append(reviewRow(d, host, false)));
  reveal(list);
}

/* 弹窗 */
let modalCtl = null;
let modalFilter = 'all';
function updateModalFoot() {
  if (!modalCtl) return;
  const foot = modalCtl.node.querySelector('[data-foot]');
  if (foot) foot.textContent = '已勾选 ' + state.selected.size + ' / ' + state.drafts.length + ' 条';
}
function visibleDrafts() {
  if (modalFilter === 'bad') return state.drafts.filter((d) => !d.completeness || d.completeness.percent < 100 || d.status === 'error');
  if (modalFilter === 'ok') return state.drafts.filter((d) => d.status === 'done' && d.completeness && d.completeness.percent >= 100);
  return state.drafts;
}
function openPreviewModal(host) {
  if (modalCtl) return;
  modalCtl = modal({
    title: '导入预览 · 补全信息', size: 'modal--wide',
    sub: '勾选要导入的行，或一键全部导入；单条缺失信息可行内编辑补全。',
    body: '<div id="modalInner"></div>',
    onMount: (node, close) => {
      node.querySelector('#modalInner').append(modalBody(host));
      node.dataset.closable = '1';
    },
    onClose: () => { modalCtl = null; },
  });
}
function modalBody(host) {
  const wrap = el([
    '<div>',
    '<div class="row row--wrap" style="gap:8px;margin-bottom:12px">',
    '<div class="pill-tabs" id="mFilter">',
    '<button class="chip is-on" data-f="all">全部</button>',
    '<button class="chip" data-f="bad">仅未完善</button>',
    '<button class="chip" data-f="ok">仅完整</button>',
    '</div>',
    '<span class="grow"></span>',
    '<button class="btn btn--sm btn--quiet" data-act="all">全选</button>',
    '<button class="btn btn--sm btn--quiet" data-act="none">全不选</button>',
    '<button class="btn btn--sm btn--quiet" data-act="invert">反选</button>',
    '<span class="badge badge--brand" data-foot>已勾选 ' + state.selected.size + ' / ' + state.drafts.length + ' 条</span>',
    '</div>',
    '<div class="review" id="mList" style="max-height:52vh;overflow:auto;padding-right:4px"></div>',
    '<div class="divider"></div>',
    '<div class="row row--wrap" style="gap:10px">',
    '<button class="btn btn--primary btn--lg" data-act="commitAll">全部导入</button>',
    '<button class="btn btn--brand btn--lg" data-act="commitPicked">导入勾选项</button>',
    '<label class="switch" style="margin-left:auto"><input type="checkbox" id="mDraft"' + (state.options.asDraft ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">存为草稿</span></label>',
    '<button class="btn btn--quiet" data-act="close">关闭</button>',
    '</div>',
    '<p class="tiny muted" style="margin-top:10px">重复标题会自动合并：新的下载链接与图片追加到已有资源，不会生成重复条目。</p>',
    '</div>',
  ].join(''));
  const list = wrap.querySelector('#mList');
  const draw = () => {
    list.innerHTML = '';
    const rows = visibleDrafts();
    if (!rows.length) list.append(el(emptyHtml()));
    rows.forEach((d) => list.append(reviewRow(d, host, true)));
  };
  wrap.querySelector('#mFilter').onclick = (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    modalFilter = b.dataset.f;
    wrap.querySelectorAll('#mFilter .chip').forEach((c) => c.classList.toggle('is-on', c === b));
    draw();
  };
  wrap.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'all') { state.drafts.forEach((d) => state.selected.add(d.id)); draw(); updateModalFoot(); }
    if (act === 'none') { state.selected.clear(); draw(); updateModalFoot(); }
    if (act === 'invert') { state.drafts.forEach((d) => (state.selected.has(d.id) ? state.selected.delete(d.id) : state.selected.add(d.id))); draw(); updateModalFoot(); }
    if (act === 'close') { modalCtl && modalCtl.close(); }
    if (act === 'commitAll') { state.drafts.forEach((d) => state.selected.add(d.id)); draw(); await commit(host, b); }
    if (act === 'commitPicked') await commit(host, b);
  };
  wrap.querySelector('#mDraft').onchange = (e) => { state.options.asDraft = e.target.checked; };
  draw();
  return wrap;
}
function rerenderModal(host) {
  if (!modalCtl) return;
  const inner = modalCtl.node.querySelector('#modalInner');
  if (inner) { inner.innerHTML = ''; inner.append(modalBody(host)); }
}
async function commit(host, btn, retried) {
  if (!state.selected.size) return toast('请先勾选要导入的行', 'warn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> 正在导入…';
  try {
    const res = await Api.admin.importCommit({ drafts: state.drafts, selected: [...state.selected], batch: state.batch, asDraft: state.options.asDraft });
    toast(res.message, 'ok', 5200);
    if (modalCtl) modalCtl.close();
    state.report = null;
    state.drafts = [];
    state.selected = new Set();
    state.parsed = null;
    state.step = 0;
    renderSteps(host);
    renderStep(host);
    await reloadBootstrap();
    navigate('/library?sort=newest');
  } catch (err) {
    if (err && err.status === 401 && !retried) {
      const pass = await askPassword();
      if (pass) return commit(host, btn, true);
      btn.disabled = false;
      btn.textContent = label;
      return;
    }
    toast('导入失败：' + (err && err.message ? err.message : err), 'bad', 5000);
  } finally {
    if (!retried) { btn.disabled = false; btn.textContent = label; }
  }
}

/* 导入写库需要管理员口令：识别、预览、勾选都可以匿名完成 */
function askPassword() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    const body = el([
      '<div>',
      '<div class="hint-strip" style="margin-bottom:14px"><span>🔐</span><div>上传、映射、图文识别与预览无需登录；<b>写入资源库</b>需要管理员口令。登录状态只保存在本机会话 Cookie 中。</div></div>',
      '<div class="field"><label>管理员账号</label><input class="input" id="impLoginUser" value="admin" autocomplete="username" /></div>',
      '<div class="field" style="margin-top:12px"><label>口令</label><input class="input" type="password" id="impLoginPass" placeholder="默认 aurora888，可在后台「站点设置」修改" autocomplete="current-password" /></div>',
      '<div class="row" style="gap:8px;justify-content:flex-end;margin-top:18px"><button class="btn btn--quiet" data-imp-cancel>取消</button><button class="btn btn--primary" data-imp-ok>登录并继续导入</button></div>',
      '</div>',
    ].join(''));
    const ctl = modal({ title: '需要管理员登录', sub: '导入的最后一道闸门', size: 'modal--narrow', body, onClose: () => finish('') });
    const node = ctl.node;
    setTimeout(() => { const p = node.querySelector('#impLoginPass'); if (p) p.focus(); }, 60);
    node.querySelector('[data-imp-cancel]').onclick = () => { finish(''); ctl.close(); };
    const submit = async () => {
      const btn2 = node.querySelector('[data-imp-ok]');
      btn2.disabled = true;
      btn2.textContent = '登录中…';
      try {
        const res = await Api.login(node.querySelector('#impLoginUser').value.trim() || 'admin', node.querySelector('#impLoginPass').value);
        store.session = { authed: true, user: res.user || 'admin' };
        toast('登录成功，继续导入', 'ok', 2200);
        finish('ok');
        settled = false;
        ctl.close();
      } catch (e) {
        toast(e && e.message ? e.message : '口令不正确', 'bad', 4200);
        btn2.disabled = false;
        btn2.textContent = '登录并继续导入';
      }
    };
    node.querySelector('[data-imp-ok]').onclick = submit;
    node.querySelector('#impLoginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

async function reloadBootstrap() {
  try { store.bootstrap = await Api.bootstrap(); } catch {}
}

/* 行内编辑 */
function openRowEditor(d, onDone) {
  const fields = [
    ['title', '标题', 'input'], ['type', '类型', 'select'], ['score', '分数', 'number'],
    ['year', '年份', 'input'], ['region', '地区', 'input'], ['size', '大小', 'input'],
    ['format', '格式', 'input'], ['author', '作者/制作', 'input'], ['tags', '标签（逗号分隔）', 'input'],
    ['summary', '简介', 'textarea'], ['content', '内容 / 正文', 'textarea'],
    ['cover', '封面图 URL', 'input'], ['sourceUrl', '来源页 URL', 'input'],
    ['downloadsText', '资源下载（一行一个链接）', 'textarea'], ['othersText', '其他来源（一行一个链接）', 'textarea'],
  ];
  const types = (store.bootstrap && store.bootstrap.types) || [];
  const wrap = el('<div><div class="form-grid">' + fields.map(([k, label, kind]) => {
    const val = k === 'tags' ? (d.draft.tags || []).join(', ')
      : k === 'downloadsText' ? (d.draft.downloads || []).map((x) => x.url).join('\n')
      : k === 'othersText' ? (d.draft.others || []).map((x) => x.url).join('\n')
      : (d.draft[k] == null ? '' : String(d.draft[k]));
    if (kind === 'select') return '<div class="field"><label>' + label + '</label><select class="select" data-k="' + k + '">' + types.map((t) => '<option' + (t.key === d.draft.type ? ' selected' : '') + '>' + escapeHtml(t.key) + '</option>').join('') + '</select></div>';
    if (kind === 'textarea') return '<div class="field span-2"><label>' + label + '</label><textarea class="textarea" data-k="' + k + '" style="min-height:' + (k === 'content' ? 140 : 76) + 'px">' + escapeHtml(val) + '</textarea></div>';
    return '<div class="field"><label>' + label + '</label><input class="input" type="' + kind + '" data-k="' + k + '" value="' + escapeHtml(val) + '" /></div>';
  }).join('') + '</div>'
    + '<div class="divider"></div>'
    + '<div class="row row--wrap" style="gap:8px"><button class="btn btn--sm btn--primary" data-act="auto">自动识别此行链接</button><span class="grow"></span><button class="btn btn--quiet" data-act="cancel">取消</button><button class="btn btn--brand" data-act="save">保存此行</button></div>'
    + '</div>');
  const ctrl = modal({
    title: '编辑第 ' + d.line + ' 行', size: 'modal--wide',
    sub: '当前完整度 <b>' + ((d.completeness && d.completeness.percent) || 0) + '%</b>' + (d.issues && d.issues.length ? ' · 缺失：' + d.issues.map((i) => escapeHtml(i.label)).join('、') : ''),
    body: wrap,
  });
  wrap.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'cancel') return ctrl.close();
    if (b.dataset.act === 'auto') {
      b.disabled = true;
      b.textContent = '识别中…';
      try {
        const res = await Api.admin.importEnrich({ drafts: [d], mirror: true, imageLimit: state.options.imageLimit, concurrency: 4, timeout: state.options.timeout });
        Object.assign(d, res.drafts[0]);
        toast('识别完成，已填入表单', 'ok');
        ctrl.close();
        openRowEditor(d, onDone);
      } catch (err) { toast('识别失败：' + err.message, 'bad'); b.disabled = false; b.textContent = '自动识别此行链接'; }
      return;
    }
    if (b.dataset.act === 'save') {
      const get = (k) => { const n = wrap.querySelector('[data-k="' + k + '"]'); return n ? n.value.trim() : ''; };
      d.draft.title = get('title') || d.draft.title;
      d.draft.type = get('type') || '其他';
      d.draft.score = Math.max(0, Math.min(10, Number(get('score')) || 0));
      d.draft.summary = get('summary');
      d.draft.content = get('content');
      d.draft.cover = get('cover');
      d.draft.sourceUrl = get('sourceUrl');
      d.draft.tags = get('tags').split(/[,，\s]+/).filter(Boolean);
      d.draft.year = get('year');
      d.draft.region = get('region');
      d.draft.size = get('size');
      d.draft.format = get('format');
      d.draft.author = get('author');
      d.draft.downloads = get('downloadsText').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((url) => ({ url, label: '', kind: '', provider: '', code: '', size: '', quality: '', note: '' }));
      d.draft.others = get('othersText').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((url) => ({ url, label: '', kind: '', provider: '', code: '', size: '', quality: '', note: '' }));
      try {
        const res = await Api.admin.importParse({ filename: 'recheck.csv', text: csvOf(d), mapping: { title: '标题' } });
        const mapped = res.drafts[0];
        if (mapped) { mapped.draft.content = d.draft.content; mapped.draft.summary = d.draft.summary; mapped.draft.cover = d.draft.cover; mapped.id = d.id; mapped.line = d.line; Object.assign(d, mapped); }
      } catch {}
      toast('第 ' + d.line + ' 行已保存', 'ok', 2000);
      ctrl.close();
      onDone && onDone();
    }
  };
}
function csvOf(d) {
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  return ['标题', '类型', '标签', '分数', '简介', '内容', '资源下载', '其他来源', '封面图', '来源页', '年份', '地区', '大小', '格式', '作者'].join(',') + '\n'
    + [d.draft.title, d.draft.type, (d.draft.tags || []).join(' '), d.draft.score, d.draft.summary, '', '', '', d.draft.cover, d.draft.sourceUrl, d.draft.year, d.draft.region, d.draft.size, d.draft.format, d.draft.author].map(esc).join(',');
}

/* 格式说明 */
function showFormatHelp() {
  const cols = [
    ['标题', '必填。用于搜索与去重合并；支持中英文、数字、连字符。'],
    ['类型', '电影 / 剧集 / 动漫 / 音乐 / 软件 / 游戏 / 电子书 / 素材 / 其他；留空自动归入「其他」。'],
    ['标签', '空格、逗号或 # 分隔，最多 10 个，用于筛选。'],
    ['分数', '0-10 的数字（支持一位小数）。'],
    ['简介', '一句话介绍，显示在卡片与详情页顶部。'],
    ['内容', '详细介绍；单元格内换行会保留为段落。'],
    ['资源下载', '网盘 / 磁力 / ed2k / 迅雷 / 直链，一行一个或逗号分隔；提取码会自动识别（pwd=、?pwd、?password、提取码：xxxx）。'],
    ['其他来源', '在线播放站、详情页、镜像站等普通 http(s) 链接。'],
    ['封面图 / 图片链接', '直接给图片地址；若只给网页链接，系统会抓取网页中的 og:image 与正文图片。'],
    ['来源页 / 年份 / 地区 / 大小 / 格式 / 作者 / 备注', '可选补充字段。'],
  ];
  modal({
    title: 'Excel / CSV 字段格式说明', size: 'modal--wide',
    sub: '表头名称支持中英文别名（如 title / 名称、score / 评分、downloads / 网盘链接）。',
    body: '<div class="table-wrap"><table class="table"><thead><tr><th>列名</th><th>说明</th></tr></thead><tbody>'
      + cols.map(([a, b]) => '<tr><td><b>' + escapeHtml(a) + '</b></td><td class="small dim">' + escapeHtml(b) + '</td></tr>').join('')
      + '</tbody></table></div><div class="divider"></div><div class="hint-strip"><span>🧪</span><div>仓库自带示例文件 <b>samples/demo-resources.xlsx</b> 与 <b>samples/demo-resources.csv</b>，直接上传即可体验完整流程。</div></div>',
  });
}


/* 通用资源表单：提交页与后台编辑器共用 */
import { el, escapeHtml, store, imgSrc, toast, modal, copy, openLink, providerInitial, fmtBytes, Api } from './core.js';

const LINK_FIELDS = [
  ['url', '链接', 'https://pan.baidu.com/s/… 或 magnet:?xt=…', 3],
  ['label', '名称', '百度网盘 / 磁力', 1],
  ['code', '提取码', 'ab12', 1],
  ['size', '大小', '2.4 GB', 1],
  ['quality', '版本', '4K', 1],
];

export function formKit(host, initial = {}, opts = {}) {
  const b = store.bootstrap || { types: [], tags: [] };
  const v = {
    title: '', type: '', tags: [], score: '', summary: '', content: '', cover: '', gallery: [],
    downloads: [], others: [], sourceUrl: '', year: '', region: '', size: '', format: '', author: '', notes: '',
    status: 'published', featured: false, altTitles: [],
  };
  Object.keys(v).forEach((k) => { if (initial[k] !== undefined && initial[k] !== null) v[k] = initial[k]; });
  v.tags = [...(v.tags || [])];
  v.gallery = (v.gallery || []).map((g) => (typeof g === 'string' ? { url: g, caption: '' } : { ...g }));
  v.downloads = (v.downloads || []).map((l) => ({ ...l }));
  v.others = (v.others || []).map((l) => ({ ...l }));

  const scoreStep = opts.compact ? 1 : 1;
  host.innerHTML = [
    '<div class="form-grid">',
    field('标题', '<input class="input" data-k="title" value="' + esc(v.title) + '" placeholder="资源 / 作品名称" />', true),
    field('别名（逗号分隔）', '<input class="input" data-k="altTitles" value="' + esc((v.altTitles || []).join(', ')) + '" placeholder="英文名 / 其他叫法" />'),
    '<div class="field"><label>类型</label><div class="select-wrap"><select class="select" data-k="type">' + typeOptions(v.type) + '</select></div></div>',
    field('分数（0-10）', '<input class="input" type="number" min="0" max="10" step="0.1" data-k="score" value="' + esc(v.score) + '" placeholder="7.5" />'),
    '<div class="field span-2"><label>标签<span class="tiny mono muted" data-tag-count style="margin-left:auto"></span></label><div class="tag-input" data-tags><input data-tag-input placeholder="输入后回车添加，退格删除" list="tagSuggest" /></div><datalist id="tagSuggest">' + (b.tags || []).map((t) => '<option value="' + esc(t.name) + '">').join('') + '</datalist></div>',
    '<div class="field span-2"><label>简介</label><textarea class="textarea" data-k="summary" style="min-height:74px" placeholder="一两句话说明这是什么资源">' + esc(v.summary) + '</textarea></div>',
    '<div class="field span-2"><label>内容 / 图文 <span class="tiny muted">支持简版 Markdown：**加粗**、- 列表、&gt; 引用、![图](url)、[链接](url)</span></label><textarea class="textarea" data-k="content" style="min-height:' + (opts.compact ? 110 : 168) + 'px">' + esc(v.content) + '</textarea>'
      + '<div class="row row--wrap" style="gap:8px;margin-top:8px"><button class="btn btn--sm btn--quiet" data-act="grab">抓取链接图文</button><button class="btn btn--sm btn--quiet" data-act="preview">预览正文</button></div></div>',
    field('年份', '<input class="input" data-k="year" value="' + esc(v.year) + '" placeholder="2024" />'),
    field('地区 / 语言', '<input class="input" data-k="region" value="' + esc(v.region) + '" placeholder="日本 / 中英双字" />'),
    field('大小', '<input class="input" data-k="size" value="' + esc(v.size) + '" placeholder="12.4 GB" />'),
    field('格式 / 版本', '<input class="input" data-k="format" value="' + esc(v.format) + '" placeholder="MKV / v2.4.1" />'),
    field('作者 / 制作', '<input class="input" data-k="author" value="' + esc(v.author) + '" />'),
    field('来源页', '<input class="input" data-k="sourceUrl" value="' + esc(v.sourceUrl) + '" placeholder="https://…" />'),
    '</div>',
    '<div class="divider"></div>',
    '<div class="row row--between" style="margin-bottom:10px"><h4 style="font-size:14.5px">封面与图集</h4><div class="row" style="gap:8px"><button class="btn btn--sm btn--quiet" data-act="pickCover">从媒体库选择</button><button class="btn btn--sm btn--quiet" data-act="upload">上传图片</button></div></div>',
    '<div class="field">' + '<div class="row row--wrap" style="gap:14px;align-items:flex-start"><div style="width:132px"><div class="cover-box" data-cover><span class="tiny muted">无封面</span></div><input class="input" style="margin-top:8px" data-k="cover" value="' + esc(v.cover) + '" placeholder="封面图 URL" /></div><div class="grow" style="min-width:220px"><div class="gallery-grid" data-gallery></div><button class="btn btn--sm btn--quiet" style="margin-top:8px" data-act="addImage">+ 添加图片</button></div></div></div>',
    '<div class="divider"></div>',
    section('资源下载', 'downloads', '网盘 / 磁力 / ed2k / 迅雷 / 直链'),
    section('其他来源', 'others', '在线站点 / 详情页 / 镜像'),
    '<div class="divider"></div>',
    '<div class="row row--wrap" style="gap:16px"><label class="switch"><input type="checkbox" data-k="featured"' + (v.featured ? ' checked' : '') + ' /><span class="switch__track"></span><span class="small">标记为精选</span></label>'
      + (opts.withStatus ? '<div class="select-wrap"><select class="select" data-k="status"><option value="published"' + (v.status === 'published' ? ' selected' : '') + '>已发布</option><option value="draft"' + (v.status === 'draft' ? ' selected' : '') + '>草稿</option><option value="archived"' + (v.status === 'archived' ? ' selected' : '') + '>已归档</option></select></div>' : '')
      + '<span class="grow"></span><span class="tiny mono muted" data-completeness></span></div>',
    '<input type="file" data-file accept="image/*" hidden />',
  ].join('');

  const q = (sel) => host.querySelector(sel);
  const qa = (sel) => Array.from(host.querySelectorAll(sel));
  const emit = () => { if (api.onChange) api.onChange(api.value()); };

  qa('[data-k]').forEach((n) => {
    const key = n.dataset.k;
    n.addEventListener('input', () => {
      if (n.type === 'checkbox') v[key] = n.checked;
      else v[key] = n.value;
      if (key === 'cover') drawCover();
      if (key === 'score' || key === 'summary' || key === 'title' || key === 'content') drawCompleteness();
      emit();
    });
    n.addEventListener('change', () => { if (n.type === 'checkbox' || n.tagName === 'SELECT') { if (n.type === 'checkbox') v[key] = n.checked; else v[key] = n.value; emit(); } });
  });

  /* 标签 */
  const tagBox = q('[data-tags]');
  const tagInput = q('[data-tag-input]');
  let drawSuggest = () => {};
  function drawTags() {
    qa('.tag-pill', tagBox).forEach((n) => n.remove());
    v.tags.forEach((t) => {
      const pill = el('<span class="tag-pill">' + escapeHtml(t) + '<button type="button" aria-label="删除">×</button></span>');
      pill.querySelector('button').onclick = () => { v.tags = v.tags.filter((x) => x !== t); drawTags(); emit(); };
      tagBox.prepend(pill);
    });
    const count = q('[data-tag-count]');
    if (count) count.textContent = v.tags.length ? v.tags.length + ' / 12' : '';
    drawSuggest();
  }
  function addTag(raw) {
    String(raw).split(/[,，#;；\s]+/).map((s) => s.trim()).filter(Boolean).forEach((t) => { if (!v.tags.includes(t) && v.tags.length < 12) v.tags.push(t); });
    drawTags();
    emit();
  }
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ' ') { e.preventDefault(); if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; } }
    else if (e.key === 'Backspace' && !tagInput.value && v.tags.length) { v.tags.pop(); drawTags(); emit(); }
  });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; } });
  /* 常用标签：装进同一个容器里横向换行，超出部分折叠，不再一个标签占一行 */
  const SUGGEST_FOLD = 8;
  const suggestNames = (b.tags || []).slice(0, 18).map((t) => t.name).filter(Boolean);
  const suggestBox = el('<div class="tag-suggest"><span class="tag-suggest__lab mono tiny">常用</span><div class="tag-suggest__row" data-suggest-row></div></div>');
  const suggestRow = suggestBox.querySelector('[data-suggest-row]');
  const suggestMore = el('<button type="button" class="tag-suggest__more mono tiny" hidden></button>');
  let suggestOpen = false;
  suggestMore.onclick = () => { suggestOpen = !suggestOpen; drawSuggest(); };
  const suggestChips = suggestNames.map((name) => {
    const chip = el('<button type="button" class="tag-suggest__chip">#' + escapeHtml(name) + '</button>');
    chip.onclick = () => {
      if (v.tags.includes(name)) { v.tags = v.tags.filter((x) => x !== name); drawTags(); emit(); } else addTag(name);
    };
    suggestRow.append(chip);
    return chip;
  });
  suggestRow.append(suggestMore);
  suggestBox.hidden = !suggestChips.length;
  tagBox.after(suggestBox);
  drawSuggest = () => {
    const extra = suggestChips.length - SUGGEST_FOLD;
    suggestChips.forEach((n, i) => {
      n.hidden = !suggestOpen && i >= SUGGEST_FOLD;
      n.classList.toggle('is-on', v.tags.includes(suggestNames[i]));
    });
    suggestMore.hidden = extra <= 0;
    suggestMore.textContent = suggestOpen ? '收起' : '+' + extra + ' 个';
  };
  drawTags();

  /* 链接行 */
  const lists = { downloads: q('[data-list="downloads"]'), others: q('[data-list="others"]') };
  function drawList(key) {
    const box = lists[key];
    box.innerHTML = '';
    if (!v[key].length) { box.append(el('<p class="tiny muted">暂无条目，点击下方按钮添加。</p>')); }
    v[key].forEach((item, idx) => {
      const row = el('<div class="link-editor-row" data-idx="' + idx + '"></div>');
      row.innerHTML = '<div class="link-editor-row__head"><span class="badge" style="background:' + esc(item.color || '#94a3b8') + '22;color:' + esc(item.color || '#94a3b8') + ';border-color:' + esc(item.color || '#94a3b8') + '55"><i class="dot" style="color:' + esc(item.color || '#94a3b8') + '"></i>' + esc(item.label || item.provider || '新链接') + '</span>'
        + '<span class="grow"></span><button class="icon-btn icon-btn--sm" data-a="detect" title="识别此链接">✨</button>'
        + '<button class="icon-btn icon-btn--sm" data-a="copy" title="复制">⧉</button>'
        + '<button class="icon-btn icon-btn--sm" data-a="open" title="打开">↗</button>'
        + '<button class="icon-btn icon-btn--sm" data-a="up" title="上移">↑</button>'
        + '<button class="icon-btn icon-btn--sm" data-a="down" title="下移">↓</button>'
        + '<button class="icon-btn icon-btn--sm" data-a="del" title="删除">×</button></div>';
      const grid = el('<div class="link-editor-row__grid"></div>');
      LINK_FIELDS.forEach(([k, label, ph, span]) => {
        const cell = el('<div class="field' + (span > 1 ? ' span-' + span : '') + '"><label>' + label + '</label><input class="input" data-f="' + k + '" value="' + esc(item[k] == null ? '' : item[k]) + '" placeholder="' + esc(ph) + '" /></div>');
        cell.querySelector('input').addEventListener('input', (e) => { item[k] = e.target.value; if (k === 'url') autoClassify(item, row); drawCompleteness(); emit(); });
        grid.append(cell);
      });
      row.append(grid);
      row.onclick = async (e) => {
        const btn = e.target.closest('[data-a]');
        if (!btn) return;
        const act = btn.dataset.a;
        if (act === 'del') { v[key].splice(idx, 1); drawList(key); emit(); }
        if (act === 'copy') copy(item.url, '链接已复制');
        if (act === 'open') openLink(item.url);
        if (act === 'up' && idx > 0) { const t = v[key][idx - 1]; v[key][idx - 1] = v[key][idx]; v[key][idx] = t; drawList(key); emit(); }
        if (act === 'down' && idx < v[key].length - 1) { const t = v[key][idx + 1]; v[key][idx + 1] = v[key][idx]; v[key][idx] = t; drawList(key); emit(); }
        if (act === 'detect') {
          btn.disabled = true;
          try {
            const enr = await Api.enrich([item.url], true);
            const r = enr.items[0];
            if (r && r.ok) {
              applyEnrichedLink(item, r.result);
              if (!v.cover && r.result.images && r.result.images[0]) { v.cover = r.result.images[0].url; q('[data-k="cover"]').value = v.cover; drawCover(); }
              const add = (r.result.images || []).slice(0, 4).map((i) => ({ url: i.url, caption: r.result.title || '' })).filter((i) => !v.gallery.some((g) => g.url === i.url));
              if (add.length) v.gallery = v.gallery.concat(add);
              if (!v.summary && r.result.description) { v.summary = r.result.description.slice(0, 220); q('[data-k="summary"]').value = v.summary; }
              drawGallery();
              drawList(key);
              toast('已识别：' + (r.result.title || r.result.providerName || ''), 'ok');
              emit();
            } else toast('识别失败：' + (r && r.error ? r.error : '未知'), 'warn');
          } catch (err) { toast('识别失败：' + err.message, 'bad'); }
          btn.disabled = false;
        }
      };
      box.append(row);
    });
    const addBtn = el('<button class="btn btn--sm btn--quiet" data-add-link>+ 添加一行</button>');
    addBtn.onclick = () => { v[key].push({ url: '', label: '', provider: '', kind: '', color: '#94a3b8', code: '', size: '', quality: '', note: '' }); drawList(key); emit(); };
    box.append(addBtn);
  }

  /* 图集 */
  const galBox = q('[data-gallery]');
  function drawGallery() {
    galBox.innerHTML = '';
    v.gallery.forEach((g, i) => {
      const cell = el('<div class="g-cell"><img src="' + imgSrc(g.url, g.caption || '') + '" alt="" loading="lazy" />' + (g.url === v.cover ? '<span class="g-cell__flag">封面</span>' : '') + '<span class="g-cell__acts"><button data-a="cover" title="设为封面">★</button><button data-a="del" title="删除">×</button></span></div>');
      cell.onclick = (e) => {
        const btn = e.target.closest('[data-a]');
        if (!btn) return;
        if (btn.dataset.a === 'del') { v.gallery.splice(i, 1); drawGallery(); emit(); }
        if (btn.dataset.a === 'cover') { v.cover = g.url; q('[data-k="cover"]').value = v.cover; drawCover(); drawGallery(); emit(); }
      };
      galBox.append(cell);
    });
  }
  const coverBox = q('[data-cover]');
  function drawCover() {
    coverBox.innerHTML = v.cover ? '<img src="' + imgSrc(v.cover, '封面') + '" alt="封面预览" />' : '<span class="tiny muted">无封面</span>';
  }

  host.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'addImage') {
      const url = window.prompt('图片地址（http(s) 或 /uploads/…）');
      if (url) { v.gallery.push({ url: url.trim(), caption: '' }); drawGallery(); emit(); }
    }
    if (act === 'upload') host.querySelector('[data-file]').click();
    if (act === 'pickCover') pickFromMedia((url) => { v.cover = url; q('[data-k="cover"]').value = url; drawCover(); emit(); });
    if (act === 'grab') grabLinks(btn);
    if (act === 'preview') previewContent();
  });
  host.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const b64 = await readB64(f);
    try {
      const res = await Api.admin.upload({ name: f.name, base64: b64 });
      v.gallery.push({ url: res.url, caption: f.name });
      if (!v.cover) { v.cover = res.url; q('[data-k="cover"]').value = res.url; drawCover(); }
      drawGallery();
      toast('图片已上传', 'ok');
      emit();
    } catch (err) { toast('上传失败：' + err.message, 'bad'); }
    e.target.value = '';
  };

  function grabLinks(btn) {
    const urls = [...v.downloads, ...v.others, { url: v.sourceUrl }].map((x) => (x.url || '').trim()).filter((u) => /^https?:/i.test(u));
    if (!urls.length) return toast('先填写至少一个 http(s) 链接', 'warn');
    btn.disabled = true;
    btn.textContent = '抓取中…';
    Api.enrich(urls, true).then((res) => {
      let imgs = 0;
      (res.items || []).forEach((it) => {
        if (!it.ok) return;
        const r = it.result;
        const match = [...v.downloads, ...v.others].find((x) => x.url === it.url);
        if (match) applyEnrichedLink(match, r);
        (r.images || []).forEach((im) => { if (!v.gallery.some((g) => g.url === im.url)) { v.gallery.push({ url: im.url, caption: r.title || '' }); imgs++; } });
        if (!v.cover && r.images && r.images[0]) { v.cover = r.images[0].url; q('[data-k="cover"]').value = v.cover; drawCover(); }
        if (!v.summary && r.description) { v.summary = String(r.description).slice(0, 220); q('[data-k="summary"]').value = v.summary; }
        if ((!v.content || v.content.length < 20) && (r.text || r.textPreview)) {
          v.content = String(r.text || r.textPreview).slice(0, 900).split('\n').filter(Boolean).map((l) => l.trim()).join('\n\n');
          q('[data-k="content"]').value = v.content;
        }
      });
      drawGallery();
      drawList('downloads');
      drawList('others');
      drawCompleteness();
      toast('已抓取 ' + urls.length + ' 个链接，新增 ' + imgs + ' 张图片', 'ok');
      emit();
    }).catch((err) => toast('抓取失败：' + err.message, 'bad')).finally(() => { btn.disabled = false; btn.textContent = '抓取链接图文'; });
  }

  function previewContent() {
    import('./core.js').then((m) => {
      modal({ title: '正文预览', size: 'modal--wide', body: '<div class="prose" style="font-size:14px">' + m.mdLite(v.content || '') + '</div>' });
    });
  }

  function drawCompleteness() {
    const node = q('[data-completeness]');
    if (!node) return;
    const need = [['标题', v.title], ['类型', v.type], ['标签', v.tags && v.tags.length], ['分数', Number(v.score) > 0], ['简介', v.summary], ['内容', v.content], ['封面或图片', v.cover || (v.gallery && v.gallery.length)], ['下载链接', v.downloads.length]];
    const okCount = need.filter((x) => x[1]).length;
    const pct = Math.round((okCount / need.length) * 100);
    node.innerHTML = '完整度 ' + pct + '% · 缺：' + (need.filter((x) => !x[1]).map((x) => x[0]).join('、') || '无');
    node.style.color = pct === 100 ? 'var(--green)' : pct >= 60 ? 'var(--amber)' : 'var(--red)';
  }

  const api = {
    host,
    get value() { return snapshot(); },
    set(patch) {
      Object.keys(patch).forEach((k) => {
        if (k === 'tags' || k === 'downloads' || k === 'others' || k === 'gallery' || k === 'altTitles') v[k] = Array.isArray(patch[k]) ? patch[k].slice() : v[k];
        else if (patch[k] !== undefined && patch[k] !== null) v[k] = patch[k];
      });
      qa('[data-k]').forEach((n) => {
        const key = n.dataset.k;
        if (key === 'featured' || key === 'status') { n.checked = !!v[key]; if (n.tagName === 'SELECT') n.value = v[key]; return; }
        if (v[key] !== undefined && !n.value) n.value = Array.isArray(v[key]) ? v[key].join(', ') : v[key];
        else if (v[key] !== undefined) n.value = Array.isArray(v[key]) ? v[key].join(', ') : v[key];
      });
      drawTags();
      drawList('downloads');
      drawList('others');
      drawGallery();
      drawCover();
      drawCompleteness();
      emit();
    },
    onChange: null,
  };
  function snapshot() {
    const clean = (arr) => arr.map((l) => ({ ...l })).filter((l) => l.url && String(l.url).trim());
    return {
      title: String(v.title || '').trim(), altTitles: String(v.altTitles || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      type: v.type || '其他', tags: v.tags.filter(Boolean), score: Number(v.score) || 0,
      summary: String(v.summary || '').trim(), content: String(v.content || '').trim(),
      cover: String(v.cover || '').trim(), gallery: v.gallery.filter((g) => g.url),
      downloads: clean(v.downloads), others: clean(v.others),
      year: v.year, region: v.region, size: v.size, format: v.format, author: v.author,
      sourceUrl: String(v.sourceUrl || '').trim(), notes: v.notes, featured: !!v.featured, status: v.status,
    };
  }
  drawList('downloads');
  drawList('others');
  drawGallery();
  drawCover();
  drawCompleteness();
  return api;
}

function esc(s) { return escapeHtml(s == null ? '' : String(s)); }
function field(label, input, required) {
  return '<div class="field"><label>' + label + (required ? ' <span class="req">*</span>' : '') + '</label>' + input + '</div>';
}
function typeOptions(current) {
  const types = (store.bootstrap && store.bootstrap.types) || [];
  return '<option value="">自动判断</option>' + types.map((t) => '<option value="' + esc(t.key) + '"' + (t.key === current ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('');
}
function section(title, key, hint) {
  return '<div class="row row--between" style="margin:14px 0 8px"><h4 style="font-size:14.5px">' + title + ' <span class="tiny muted">' + hint + '</span></h4></div><div class="link-editor-list" data-list="' + key + '"></div>';
}
function autoClassify(item, row) {
  const url = String(item.url || '');
  const c = classifyLocal(url);
  if (c) {
    item.provider = c.provider; item.kind = c.kind; item.color = c.color;
    if (!item.label) item.label = c.name;
    if (c.code && !item.code) item.code = c.code;
  }
}
function applyEnrichedLink(item, r) {
  if (!r) return;
  if (!item.label && (r.title || r.providerName)) item.label = String(r.title || r.providerName).slice(0, 60);
  if (r.provider) item.provider = r.provider;
  if (r.kind) item.kind = r.kind;
  if (r.code && !item.code) item.code = r.code;
  if (r.color) item.color = r.color;
}
function readB64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(new Error('读取失败'));
    fr.readAsDataURL(file);
  });
}
function pickFromMedia(onPick) {
  modal({
    title: '从媒体库选择', size: 'modal--wide',
    body: '<div class="row muted" style="gap:10px"><span class="spinner"></span><span class="small">读取媒体库…</span></div>',
    onMount: async (node, close) => {
      const hostEl = node.querySelector('.modal__body');
      try {
        const res = await Api.admin.media();
        hostEl.innerHTML = '';
        if (!res.items.length) { hostEl.innerHTML = '<p class="muted">媒体库还是空的，先上传或导入图片。</p>'; return; }
        const grid = el('<div class="media-grid"></div>');
        res.items.forEach((m) => {
          const cell = el('<button class="media-cell"><img src="' + esc(m.url) + '" alt="' + esc(m.name) + '" loading="lazy" /><span class="tiny mono">' + esc(m.name.slice(0, 22)) + '</span><span class="tiny muted">' + fmtBytes(m.size) + '</span></button>');
          cell.onclick = () => { onPick(m.url); close(); toast('已选用 ' + m.name, 'ok', 1800); };
          grid.append(cell);
        });
        hostEl.append(grid);
      } catch (err) { hostEl.innerHTML = '<p class="muted">' + escapeHtml(err.message) + '（需管理员登录）</p>'; }
    },
  });
}
function classifyLocal(url) {
  if (!url) return null;
  const map = [
    [/pan\.baidu\.com/i, { provider: 'baidu', name: '百度网盘', kind: 'netdisk', color: '#4f7cff' }],
    [/alipan|aliyundrive/i, { provider: 'alipan', name: '阿里云盘', kind: 'netdisk', color: '#ff6a00' }],
    [/pan\.quark\.cn/i, { provider: 'quark', name: '夸克网盘', kind: 'netdisk', color: '#3d7bff' }],
    [/lanzou|lanzn/i, { provider: 'lanzou', name: '蓝奏云', kind: 'netdisk', color: '#22a7f0' }],
    [/115\.com/i, { provider: '115', name: '115网盘', kind: 'netdisk', color: '#00a870' }],
    [/cloud\.189\.cn/i, { provider: 'tianyi', name: '天翼云盘', kind: 'netdisk', color: '#e6484d' }],
    [/drive\.uc\.cn/i, { provider: 'uc', name: 'UC网盘', kind: 'netdisk', color: '#f97316' }],
    [/123pan|123684/i, { provider: '123', name: '123云盘', kind: 'netdisk', color: '#2563eb' }],
    [/mypikpak/i, { provider: 'pikpak', name: 'PikPak', kind: 'netdisk', color: '#7c5cff' }],
    [/onedrive|1drv\.ms/i, { provider: 'onedrive', name: 'OneDrive', kind: 'netdisk', color: '#0364b1' }],
    [/drive\.google/i, { provider: 'gdrive', name: 'Google Drive', kind: 'netdisk', color: '#29b65b' }],
    [/dropbox/i, { provider: 'dropbox', name: 'Dropbox', kind: 'netdisk', color: '#0061fe' }],
    [/^magnet:/i, { provider: 'magnet', name: '磁力链接', kind: 'magnet', color: '#f43f5e' }],
    [/^ed2k:/i, { provider: 'ed2k', name: 'eD2k', kind: 'ed2k', color: '#fb7185' }],
    [/^thunder:/i, { provider: 'thunder', name: '迅雷', kind: 'thunder', color: '#22d3ee' }],
    [/\.(zip|rar|7z|iso|exe|dmg|apk|pdf|epub|mp4|mkv)(\?|$)/i, { provider: 'httpdl', name: '直链下载', kind: 'direct', color: '#94a3b8' }],
    [/^https?:/i, { provider: 'web', name: '网页来源', kind: 'web', color: '#94a3b8' }],
  ];
  for (const entry of map) {
    if (entry[0].test(url)) {
      const out = Object.assign({}, entry[1]);
      const pwd = /[?&](?:pwd|password|code)=([\w-]{2,10})/i.exec(url);
      if (pwd) out.code = pwd[1];
      return out;
    }
  }
  return null;
}
export { classifyLocal, readB64 };

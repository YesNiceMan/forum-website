
/* 手动添加 / 投稿 */
import { el, escapeHtml, Api, store, toast, modal, reveal, rippleAll, navigate } from '../core.js';
import { resourceCard, linkRow, galleryGrid } from '../ui.js';
import { formKit } from '../form.js';


export async function submitView(host, ctx) {
  const b = store.bootstrap;
  host.innerHTML = [
    '<div class="shell section--tight" style="padding-top:26px">',
    '<div class="sec-head" style="margin-bottom:16px"><div><span class="eyebrow">Manual add</span><h2 data-page-title>手动添加资源</h2><p>粘贴一段推广文案或网盘链接，系统自动拆出标题、链接、提取码与图片；信息不全也可以先提交，管理员在后台补全后发布。</p></div>',
    '<div class="row" style="gap:8px"><a class="btn btn--sm btn--quiet" href="#/import">批量导入 Excel</a></div></div>',
    '<div class="submit-layout">',
    '<div>',
    '<div class="card card--pad paste-box" data-reveal>',
    '<div class="field"><label>粘贴识别 <span class="req">*</span> <span class="grow"></span><span class="tiny muted">支持微博 / 公众号 / 资源站推广文案，一行一个链接</span></label>',
    '<textarea class="textarea" id="pasteArea" placeholder="例：&#10;《极光之境》4K HDR 中英双字&#10;链接：https://pan.baidu.com/s/1Example?pwd=ab12&#10;备用：https://pan.quark.cn/s/abcdef&#10;标签：科幻 冒险 蓝光"></textarea></div>',
    '<div class="row row--wrap" style="gap:10px;margin-top:12px">',
    '<button class="btn btn--primary" id="detectBtn">识别内容</button>',
    '<button class="btn btn--quiet" id="fillSample">填入示例</button>',
    '<span class="grow"></span>',
    '<span class="tiny muted" id="detectHint">识别后会自动填入下方表单，只覆盖空白项</span>',
    '</div>',
    '</div>',
    '<div class="card card--pad" style="margin-top:14px" data-reveal><div id="formHost"></div></div>',
    '<div class="row row--wrap" style="gap:10px;margin-top:14px" data-reveal>',
    '<button class="btn btn--brand btn--lg" id="submitBtn">提交入库</button>',
    '<button class="btn btn--quiet btn--lg" id="draftBtn">仅保存草稿</button>',
    '<a class="btn btn--quiet btn--lg" href="#/library">去资源库</a>',
    '</div>',
    '</div>',
    '<aside class="preview-sticky">',
    '<div class="card card--pad" data-reveal><h3 style="font-size:15px;margin-bottom:10px">实时预览</h3><div id="previewHost"></div></div>',
    '<div class="card card--pad" data-reveal><h3 style="font-size:15px;margin-bottom:10px">识别到的链接</h3><div id="linkHost" class="dl-list"><p class="tiny muted">粘贴内容后点击「识别内容」</p></div></div>',
    '<div class="card card--pad" data-reveal><h3 style="font-size:15px;margin-bottom:10px">填写建议</h3><ul class="prose small" style="margin:0;padding-left:18px"><li>标题尽量写作品原名，便于聚合搜索命中</li><li>多个网盘地址放同一行的「资源下载」里，失效时访客可换源</li><li>有提取码请直接粘贴完整链接，系统会自动抽取</li><li>图片留空也可：导入与识别阶段会自动抓来源页首图</li></ul></div>',
    '</aside>',
    '</div>',
    '</div>',
  ].join('');
  const form = formKit(host.querySelector('#formHost'), {});
  bindDetect(host, form);
  bindSubmit(host, form);
  host.querySelector('#fillSample').onclick = async () => {
    host.querySelector('#pasteArea').value = '《午夜黑胶》2024 复刻版 FLAC+CUE\nhttps://pan.baidu.com/s/1SampleMidnight?pwd=vn8l\n备用：https://cloud.189.cn/t/sampleLink\n标签：爵士 黑胶 无损\n评分 8.6';
    await host.querySelector('#detectBtn').click();
  };
  updatePreview(host, form);
  form.onChange = () => updatePreview(host, form);
  reveal(host);
  rippleAll(host);
}

function bindDetect(host, form) {
  const btn = host.querySelector('#detectBtn');
  const area = host.querySelector('#pasteArea');
  btn.onclick = async () => {
    const text = area.value.trim();
    if (!text) { toast('先粘贴一段内容'); area.focus(); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> 识别中…';
    try {
      const parsed = await Api.detect(text);
      const patch = {
        title: parsed.title || form.value.title,
        summary: parsed.summary || form.value.summary,
        tags: (parsed.tags || []).length ? parsed.tags : form.value.tags,
        score: parsed.score || form.value.score,
        year: parsed.year || form.value.year,
        size: parsed.size || form.value.size,
        downloads: (parsed.links || []).filter((l) => ['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes(l.kind)),
        others: (parsed.links || []).filter((l) => !['netdisk', 'magnet', 'ed2k', 'thunder', 'direct'].includes(l.kind)),
      };
      form.set(patch);
      host.querySelector('#detectHint').textContent = '已识别 ' + (parsed.links || []).length + ' 条链接 · ' + (parsed.images || []).length + ' 张图片 · ' + (parsed.tags || []).length + ' 个标签';
      renderLinkHost(host, patch.downloads, patch.others, parsed.images || []);
      updatePreview(host, form);
      if (parsed.links && parsed.links.length) {
        try {
          const enr = await Api.enrich([parsed.sourceCandidates && parsed.sourceCandidates[0] ? parsed.sourceCandidates[0].url : parsed.links[0].url], true);
          const r = enr.items[0];
          if (r && r.ok && r.result) {
            const res2 = r.result;
            const imgs = (res2.images || []).slice(0, 6);
            if (imgs.length && !form.value.gallery.length) {
              form.set({ gallery: imgs.map((i) => ({ url: i.url, caption: res2.title || '' })), cover: form.value.cover || imgs[0].url });
            }
            if (!form.value.summary && res2.description) form.set({ summary: res2.description.slice(0, 200) });
            toast('已从来源页补全图片与简介', 'ok');
            updatePreview(host, form);
            renderLinkHost(host, form.value.downloads, form.value.others, imgs);
          }
        } catch {}
      }
    } catch (err) {
      toast('识别失败：' + err.message, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = '识别内容';
    }
  };
}

function renderLinkHost(host, downloads, others, images) {
  const box = host.querySelector('#linkHost');
  box.innerHTML = '';
  const all = (downloads || []).concat(others || []);
  if (!all.length) { box.innerHTML = '<p class="tiny muted">未识别到链接</p>'; return; }
  all.forEach((l) => box.append(linkRow(l, l.kind === 'web' ? 'other' : 'download')));
  if (images && images.length) {
    box.append(el('<div class="divider-dots" style="margin:12px 0"><span>识别到 ' + images.length + ' 张图片</span></div>'));
    box.append(galleryGrid(images.map((i) => ({ url: typeof i === 'string' ? i : i.url, caption: typeof i === 'string' ? '' : i.alt || '' }))));
  }
}

function bindSubmit(host, form) {
  const submit = (asDraft) => async () => {
    const v = form.value;
    if (!v.title) { toast('请填写标题', 'bad'); return; }
    if (!v.downloads.length && !v.others.length && !v.sourceUrl) { toast('至少提供一个下载或来源链接', 'bad'); return; }
    const btn = host.querySelector(asDraft ? '#draftBtn' : '#submitBtn');
    btn.disabled = true;
    const label = btn.textContent;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span> 提交中';
    try {
      const res = await Api.submit(Object.assign({}, v, { status: asDraft ? 'draft' : undefined }));
      const msg = res.resource ? (res.message || '已提交，等待管理员审核') : '已提交';
      modal({
        title: asDraft ? '草稿已保存' : (res.resource && res.resource.status === 'published' ? '已直接发布' : '已提交审核'),
        size: 'modal--narrow',
        body: '<div class="empty" style="padding:20px 0"><div class="empty__art">🎉</div><h3>' + escapeHtml(res.resource ? res.resource.title : v.title) + '</h3><p>' + escapeHtml(msg) + (res.completeness ? '<br /><span class="mono tiny">信息完整度 ' + res.completeness.percent + '%</span>' : '') + '</p></div>',
        foot: '<button class="btn btn--quiet" data-act="more">继续添加</button><a class="btn btn--primary" href="#/resource/' + (res.resource ? res.resource.id : '') + '" data-act="go">查看资源</a>',
        onMount(node, close) {
          node.querySelector('[data-act="more"]').onclick = () => { close(); location.reload(); };
          node.querySelector('[data-act="go"]').onclick = () => close();
        },
      });
    } catch (err) {
      toast('提交失败：' + err.message, 'bad', 4600);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  host.querySelector('#submitBtn').onclick = submit(false);
  host.querySelector('#draftBtn').onclick = submit(true);
}

function updatePreview(host, form) {
  const box = host.querySelector('#previewHost');
  const v = form.value;
  const card = resourceCard({
    id: 'preview', title: v.title || '（未填写标题）', type: v.type || '其他', tags: v.tags, score: Number(v.score) || 0,
    summary: v.summary, cover: v.cover || (v.gallery && v.gallery[0] && v.gallery[0].url) || '',
    downloads: v.downloads || [], others: v.others || [], gallery: v.gallery || [], createdAt: new Date().toISOString(),
    completeness: null, featured: false, meta: {},
  });
  card.style.pointerEvents = 'none';
  card.classList.remove('card--hover');
  box.innerHTML = '';
  box.append(card);
}

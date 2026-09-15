/* E2E（真实 Chrome + CDP）：覆盖导入向导、聚合搜索、详情页、手动投稿、收藏、命令面板 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const PORT = Number(process.env.PORT || 9344);
const ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const dir = mkdtempSync(join(tmpdir(), 'aurora-e2e-'));
const chrome = spawn(CH, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-component-update', '--metrics-recording-only', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let info = null;
for (let i = 0; i < 50 && !info; i++) {
  try { info = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); } catch { await sleep(400); }
}
if (!info) { console.log('CDP 未就绪 ' + chromeErr.slice(0, 500)); chrome.kill(); process.exit(1); }
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const msgs = [];
ws.onmessage = (raw) => {
  const m = JSON.parse(raw.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    msgs.push('EXC ' + ((d.exception && d.exception.description) || d.text).split('\n').slice(0, 2).join(' | '));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') msgs.push('LOG ' + m.params.entry.text.slice(0, 140));
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 90000);
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
for (const e of ['Runtime.enable', 'Log.enable', 'Page.enable', 'DOM.enable']) await send(e, {}, sessionId);
const J = (v) => JSON.stringify(v);
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) return 'EVAL-ERR ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0];
  return r.result.value;
};
const txt = () => ev('document.getElementById("view").innerText.replace(/\\s+/g," ")');
const mtxt = () => ev('(function(){var m=document.querySelector("#modalRoot .modal");return m?m.innerText.replace(/\\s+/g," "):""})()');
const has = (sel) => ev('!!document.querySelector(' + J(sel) + ')');
const num = (sel) => ev('document.querySelectorAll(' + J(sel) + ').length');
const click = (sel) => ev('(function(){var n=document.querySelector(' + J(sel) + ');if(!n)return 0;n.click();return 1})()');
const act = (name) => ev('[].slice.call(document.querySelectorAll("[data-act]")).forEach(function(b){if(b.dataset.act===' + J(name) + ')b.click()})');
const goto = async (hash, ms = 2600) => { await ev('location.hash = ' + J(hash) + ';1'); await sleep(ms); };
const waitFor = async (sel, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await has(sel)) return true; await sleep(700); }
  return false;
};
let fail = 0;
const step = (name, ok, extra) => { console.log((ok ? '✓ ' : '✗ ') + name + (extra ? '   ' + String(extra).slice(0, 190) : '')); if (!ok) fail++; };

await send('Page.navigate', { url: BASE + '/' }, sessionId);
await sleep(3400);

/* 1. 首页 */
let t = await txt();
step('首页：主标题 / 统计计数 / 精选与最新', /站内资源/.test(t) && /(编辑精选|最新上架)/.test(t), t.slice(0, 90));

/* 2. 导入向导（要求 1、2） */
await goto('#/import', 2000);
const doc = await send('DOM.getDocument', {}, sessionId);
const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#dz input[type=file]' }, sessionId);
step('导入：上传入口就绪', !!nodeId, 'nodeId=' + nodeId);
await send('DOM.setFileInputFiles', { nodeId, files: [join(ROOT, 'samples', 'demo-resources.xlsx')] }, sessionId);
await sleep(6500);
t = await txt();
step('导入：解析 Excel → 字段映射', /列 ↔ 字段映射/.test(t) && /行数据/.test(t) && !/\[object Object\]/.test(t), t.replace(/.*列 ↔ 字段映射/, '').slice(0, 140));
step('导入：自动映射命中字段', Number(await num('.map-item.filled')) >= 4, 'filled=' + await num('.map-item.filled'));
await click('#toEnrich');
await sleep(1700);
step('导入：进入链接识别', await has('#startEnrich'), '');
const beforePreview = await num('#reviewList .review-row');
await click('#startEnrich');
await sleep(9000);
t = await txt();
step('导入：识别产出统计（文字 + 图片）', /(链接成功|抓到图片|已补字段|识别完成|失败|预览与补全)/.test(t), t.replace(/.*(识别链接中的图片与文字)/, '').slice(0, 170));
const ready = await waitFor('#openPreview', 26000);
await sleep(1200);
step('导入：识别后自动进入预览步骤', ready && (await has('#reviewList')), 'reviewRows=' + await num('#reviewList .review-row') + ' (之前 ' + beforePreview + ')');
await click('#openPreview');
await sleep(1700);
let mt = await mtxt();
step('导入：弹窗支持全部导入 / 导入勾选项', /全部导入/.test(mt) && /导入勾选项/.test(mt) && /已勾选/.test(mt), mt.slice(0, 120));
await ev('[].slice.call(document.querySelectorAll("#mFilter [data-f]")).forEach(function(b){if(b.dataset.f==="bad")b.click()})');
await sleep(1000);
step('导入：「仅未完善」筛选生效', /已勾选/.test(await mtxt()) && Number(await num('#mList .review-row')) < 12, 'rows=' + await num('#mList .review-row'));
await act('all');
await sleep(900);
const before = Number(await ev('fetch("/api/resources?pageSize=1").then(function(r){return r.json()}).then(function(j){return j.total})'));
await act('commitPicked');
await sleep(3000);
const gate = await has('[data-imp-ok]');
step('导入：匿名写库触发口令闸门', gate, gate ? '出现登录弹窗' : '未出现登录弹窗');
if (gate) {
  await ev('document.querySelector("#impLoginPass").value=' + J(process.env.ADMIN_PASS || 'aurora888') + ';1');
  await click('[data-imp-ok]');
  await sleep(8000);
}
const after = Number(await ev('fetch("/api/resources?pageSize=1").then(function(r){return r.json()}).then(function(j){return j.total})'));
step('导入：确认导入后写库（同名合并）', after > before, before + ' → ' + after);

/* 3. 聚合搜索（要求 4） */
await goto('#/search?q=%E6%9E%81%E5%85%89', 10000);
t = await txt();
step('搜索：命中本站资源', /极光/.test(t) && /(本站|站内|资源库)/.test(t), t.slice(0, 110));
step('搜索：外部来源 / 跳转检索', /(网盘|磁力|跳转)/.test(t) && ((await has('.src-card')) || (await has('.jump-btn')) || (await has('.agg-src'))), '');

/* 4. 详情页（要求 3） */
const rid = await ev('fetch("/api/resources?q=%E6%9E%81%E5%85%89&pageSize=1").then(function(r){return r.json()}).then(function(j){return j.items[0].id})');
await goto('#/resource/' + rid, 3000);
t = await txt();
step('详情：下载 / 其他来源 / 简介分区', /资源下载/.test(t) && /其他来源/.test(t) && /简介/.test(t), t.slice(0, 140));
step('详情：分数与标签可见', /(★|评分|分)/.test(t) && /#/.test(t), '');

/* 5. 手动添加 / 粘贴识别（要求 2） */
await goto('#/submit', 2200);
await ev('(function(){var b=document.querySelector("#pasteBox");if(!b)return 0;b.value="极昼之下 4K 纪录 https://pan.quark.cn/s/2f1c9d 提取码: 8k2d\\n覆盖城市天际线图集 https://www.dropbox.com/s/ab12cd?dl=0";b.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
await click('#pasteGo');
await sleep(5000);
t = await txt();
step('手动：粘贴文案拆出链接与提取码', /(quark|dropbox|网盘|提取码|8k2d)/.test(t), t.slice(0, 130));

/* 6. 收藏 */
await goto('#/library', 2600);
const fav = await ev('(function(){var b=document.querySelector("[data-fav],.rcard__fav");if(!b)return "no-btn";b.click();return "clicked"})()');
await sleep(800);
const favCount = await ev('(function(){var raw=localStorage.getItem("aurora.vault.v1")||"{}";try{return (JSON.parse(raw).favorites||[]).length}catch(e){return -1}})()');
step('收藏：本机收藏夹写入', fav === 'clicked' && Number(favCount) >= 1, fav + ' count=' + favCount);

/* 7. 命令面板 */
await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"k",metaKey:true,bubbles:true}))');
await sleep(1000);
step('⌘K 命令面板打开', (await has('.palette')) || (await has('#palette:not([hidden])')), '');
await ev('(function(){var i=document.querySelector("#paletteInput");if(!i)return 0;i.value="极光";i.dispatchEvent(new Event("input",{bubbles:true}));return 1})()');
await sleep(1600);
step('面板实时搜索资源', Number(await num('#paletteList .palette__item')) > 0, 'items=' + await num('#paletteList .palette__item'));

const errs = msgs.filter((m) => !/favicon|net::ERR|Failed to load resource|ERR_CONNECTION|ERR_NAME|CORS|Access to fetch/i.test(m));
step('全程无未捕获 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(fail ? '\nE2E FAILED: ' + fail : '\nE2E ALL OK');
ws.close();
chrome.kill('SIGKILL');
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

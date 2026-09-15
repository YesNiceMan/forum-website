/* 需求四自检（真实 Chrome + CDP，离线可跑）：
   1) 找更多来源 → 点一下文字 / 图片就插进资源对应位置
   2) 后台「批量补全」只填空白位置（预览 / 真写 / 行内单条）
   3) 后台刷新 / 切前台再回来不再掉登录
   用法：另起一个隔离实例（AURORA_DATA_DIR=... PORT=5211 node server/index.mjs），
        再 BASE=http://127.0.0.1:5211 node tools/optimize-check.mjs */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:5211';
const CDP = Number(process.env.CDP_PORT || 9411);
const PASS = process.env.ADMIN_PASS || 'aurora888';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* CDP 端口必须空闲：否则可能连到上一轮没退干净的浏览器，测试结果全是假的 */
try {
  const busy = await Promise.race([fetch('http://127.0.0.1:' + CDP + '/json/version').then(() => 'busy'), sleep(1200).then(() => 'free')]);
  if (busy === 'busy') { console.log('CDP 端口 ' + CDP + ' 已被占用，请先关掉残留的 headless Chrome（或换 CDP_PORT）'); process.exit(2); }
} catch { /* 空闲 */ }

const dir = mkdtempSync(join(tmpdir(), 'aurora-opt-'));
const chrome = spawn(CH, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-component-update', '--metrics-recording-only', '--mute-audio',
  '--remote-debugging-port=' + CDP, '--user-data-dir=' + dir, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} rmSync(dir, { recursive: true, force: true }); });
let info = null;
for (let i = 0; i < 60 && !info; i++) {
  try { info = await (await fetch('http://127.0.0.1:' + CDP + '/json/version')).json(); } catch { await sleep(400); }
}
if (!info) { console.log('CDP 未就绪\n' + chromeErr.slice(0, 400)); process.exit(1); }
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (raw) => {
  const m = JSON.parse(raw.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errs.push('EXC ' + ((d.exception && d.exception.description) || d.text).split('\n').slice(0, 2).join(' | '));
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('LOG ' + m.params.entry.text.slice(0, 160));
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('CDP 超时 ' + method)); } }, 150000);
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
for (const e of ['Runtime.enable', 'Log.enable', 'Page.enable']) await send(e, {}, sessionId);
const J = (v) => JSON.stringify(v);
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) return 'EVAL-ERR ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n').slice(0, 2).join(' | ');
  return r.result.value;
};
const has = (sel) => ev('!!document.querySelector(' + J(sel) + ')');
const num = async (sel) => Number(await ev('document.querySelectorAll(' + J(sel) + ').length')) || 0;
const click = (sel) => ev('(function(){var n=document.querySelector(' + J(sel) + ');if(!n)return 0;n.click();return 1})()');
const text = (sel) => ev('(function(){var n=document.querySelector(' + J(sel) + ');return n?n.innerText.replace(/\s+/g," ").trim():""})()');
const goto = async (url, ms = 2600) => { await send('Page.navigate', { url }, sessionId); await sleep(ms); };
/** 轮询等待某个 DOM 条件成立（外部检索耗时不定，不用固定 sleep 猜） */
const waitFor = async (expr, ms = 30000, tick = 700) => {
  const n = Math.max(1, Math.floor(ms / tick));
  for (let i = 0; i < n; i++) { if (await ev(expr)) return true; await sleep(tick); }
  return false;
};
const gate = () => ev('(function(){var g=document.getElementById("adminLogin");return g?!g.hidden&&g.offsetParent!==null:null})()');
let fail = 0;
const step = (name, ok, extra) => { console.log((ok ? '✓ ' : '✗ ') + name + (extra ? '   ' + String(extra).slice(0, 200) : '')); if (!ok) fail++; };

/* ---------- 0. 前置：准备两条自检资源 ---------- */
await goto(BASE + '/', 3200);
const boot = JSON.parse(await ev('fetch("/api/bootstrap").then(function(r){return r.json()}).then(function(j){return JSON.stringify(j.session)})'));
step('匿名 bootstrap 如实报告未登录（前后台共用一个登录态）', boot && boot.authed === false, JSON.stringify(boot));
const login = await ev('fetch("/api/admin/login",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({user:"admin",pass:' + J(PASS) + ',remember:true})}).then(function(r){return r.json()})');
step('登录：记住登录 + 返回会话到期时间', !!(login && login.user === 'admin' && login.remember === true && login.expires > Date.now()), JSON.stringify(login).slice(0, 120));
const seed = JSON.parse(await ev('(async function(){'
  + 'var post=function(p,b){return fetch(p,{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify(b)}).then(function(r){return r.json()})};'
  + 'var a=await post("/api/admin/resources",{title:"自检·极光之境 缺补项",type:"",tags:[],summary:"",content:"",cover:"",gallery:[],downloads:[],others:[],sourceUrl:"https://example.com/",status:"published"});'
  + 'var c=await post("/api/admin/resources",{title:"自检·极光之境 参考项",type:"纪录片",tags:["极光","延时摄影","4K"],summary:"这是一条内容齐全的参考条目，用来验证「找更多来源」把简介与图片搬到缺内容那条的对应位置。",content:"<p>参考正文段落。</p>",cover:"/uploads/seed/ridge.svg",gallery:[{url:"/uploads/seed/ridge.svg",caption:"参考图"}],downloads:[{url:"https://pan.quark.cn/s/selfcheck01",label:"夸克网盘"}],others:[],status:"published"});'
  + 'return JSON.stringify({a:a.resource&&a.resource.id,c:c.resource&&c.resource.id})})()'));
step('自检数据准备完成', !!seed.a && !!seed.c, JSON.stringify(seed));
const cleanup = (ids) => ev('(async function(){var ids=' + J(ids) + ';for(var i=0;i<ids.length;i++){if(ids[i])await fetch("/api/admin/resources/"+ids[i],{method:"DELETE",credentials:"same-origin"}).catch(function(){})}return ids.length})()');

/* ---------- 1. 找更多来源：点一下即插入 ---------- */
await goto(BASE + '/#/search?q=' + encodeURIComponent('自检·极光之境') + '&id=' + seed.a + '&sources=site', 3000);
step('搜索页：绑定提示条说明「点一下就插进去」', /点结果里的文字/.test(await text('.hint-strip--bind')));
const gotResults = await waitFor('(function(){return document.querySelectorAll(".result-block").length>0})()', 45000, 800);
const chips = await num('.pick');
step('结果里出现可点选片段芯片（文字 / 图片 / 标签）', gotResults && chips > 0, 'blocks=' + (await num('.result-block')) + ' picks=' + chips);
if (chips > 0) {
  const firstSlot = await text('.pick');
  const before = JSON.parse(await ev('fetch(' + J('/api/resources/' + seed.a) + ').then(function(r){return r.json()}).then(function(j){return JSON.stringify({s:j.resource.summary,g:(j.resource.gallery||[]).length,t:j.resource.tags.length,p:j.completeness.percent})})'));
  await click('.pick:not(.is-done)');
  await waitFor('(function(){return document.querySelectorAll(".pick.is-done").length>0})()', 15000, 500);
  const after = JSON.parse(await ev('fetch(' + J('/api/resources/' + seed.a) + ').then(function(r){return r.json()}).then(function(j){return JSON.stringify({s:j.resource.summary,g:(j.resource.gallery||[]).length,t:j.resource.tags.length,p:j.completeness.percent})})'));
  const grew = String(after.s || '').length > String(before.s || '').length || after.g > before.g || after.t > before.t;
  step('单击芯片：内容写进资源对应位置（只填空位 / 追加）', grew, '落点「' + firstSlot + '」 完整度 ' + before.p + '% → ' + after.p + '%');
  step('芯片翻成「已插入」并锁定防重复', (await num('.pick.is-done')) > 0, 'done=' + (await num('.pick.is-done')));
  step('提示条累计本次插入数', /已插入/.test(await text('#bindCount')), await text('#bindCount'));
  await click('.pick-more');
  await waitFor('(function(){return document.querySelectorAll(".ins-row").length>0})()', 8000, 400);
  const rows = await num('.ins-row');
  const selects = await num('.ins-row select[data-target]');
  step('「选位置插入」面板：片段清单 + 落点下拉', rows > 0 && selects > 0, 'rows=' + rows + ' selects=' + selects);
  step('面板底部提示已选数量与写入规则', /已选/.test(await text('#insFoot')), await text('#insFoot'));
  await click('.modal__close');
  await sleep(500);
  const fetchBtn = await num('.pick-fetch');
  console.log((fetchBtn > 0 ? '✓ ' : '· ') + '结果带「抓正文与图片」入口：' + fetchBtn + ' 个（外链结果上才出现，纯站内结果没有）');
} else {
  step('（跳过芯片断言：结果区没有可用片段）', false, 'blocks=' + (await num('.result-block')));
}
/* 访客路径：未登录插入应进待审队列，而不是直接改库 */
const asVisitor = JSON.parse(await ev('(async function(){var out=await fetch("/api/resources/' + seed.a + '/insert",{method:"POST",credentials:"omit",headers:{"content-type":"application/json"},body:JSON.stringify({source:"自检",inserts:[{field:"notes",value:"访客补录的一段说明文字"}]})}).then(function(r){return r.json()});return JSON.stringify({mode:out.mode,msg:out.message,sub:(out.submission||{}).id})})()'));
step('访客插入 → 待审内容补充投稿（不直接写库）', asVisitor.mode === 'pending' && !!asVisitor.sub, JSON.stringify(asVisitor).slice(0, 130));
await goto(BASE + '/admin#/submissions', 3000);
const badgeText = await ev('(function(){return [].slice.call(document.querySelectorAll(".rcard .badge")).map(function(b){return b.textContent.trim()}).slice(0,10).join("|")})()');
step('后台投稿：区分「内容补充」与普通投稿', /内容补充/.test(badgeText), badgeText.slice(0, 90));
const opened = await ev('(function(){var cs=[].slice.call(document.querySelectorAll(".rcard")).filter(function(x){return /内容补充/.test(x.innerText)});for(var i=0;i<cs.length;i++){var b=cs[i].querySelector("[data-s=\\"detail\\"]");if(b){b.click();return 1+100*i}}return 0})()');
await waitFor('(function(){return document.querySelectorAll(".sub-insert-list .ins-row").length>0})()', 9000, 500);
const patchRows = await num('.sub-insert-list .ins-row');
step('投稿详情：逐条勾选要写入的位置', !!opened && patchRows > 0, 'opened=' + opened + ' rows=' + patchRows + ' modal=' + (await has('.modal')));
step('面板说明写入规则', /已选/.test(await text('#subHint')), await text('#subHint'));
await click('.modal [data-act="publish"]');
await waitFor('(function(){var m=document.querySelector(".modal");return !m||m.offsetParent===null})()', 12000, 600);
const written = JSON.parse(await ev('fetch(' + J('/api/resources/' + seed.a) + ').then(function(r){return r.json()}).then(function(j){return JSON.stringify({notes:(j.resource.notes||"").length})})'));
step('点「写入所选」后内容落到资源上', written.notes > 0, JSON.stringify(written));

/* ---------- 3. 登录持久化（本次优化重点） ---------- */
await goto(BASE + '/admin', 2800);
step('后台首屏：已登录，无需再输口令', (await gate()) === false);
await send('Page.reload', {}, sessionId); await sleep(2600);
step('刷新后台：保持登录', (await gate()) === false);
await goto(BASE + '/', 2000);
await sleep(400);
await goto(BASE + '/admin#/dash', 2800);
step('切到前台再回后台：保持登录', (await gate()) === false);
const note1 = await text('#sessionNote');
step('侧栏显示会话有效期与自动续期', /会话：记住登录/.test(note1), note1);
const heart = await ev('fetch("/api/admin/session",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(j){return JSON.stringify({a:j.authed,r:j.remember,e:j.expires>Date.now()})})');
step('心跳接口：会话有效', JSON.parse(heart).a === true && JSON.parse(heart).e === true, heart);

/* ---------- 2. 后台批量补全空白 ---------- */
await goto(BASE + '/admin#/gaps', 3200);
step('批量补全视图渲染（位置勾选 / 范围 / 待补清单）', (await num('.gap-field')) >= 10 && (await has('#gapRun')) && (await has('#gapPreviewHost')));
const onCount = await num('.gap-field.is-on');
const blanks = JSON.parse(await ev('(function(){return JSON.stringify([].slice.call(document.querySelectorAll(".gap-field .gap-count")).map(function(s){return parseInt(s.textContent,10)||0}).filter(function(n){return n>0}).slice(0,6))})()'));
step('默认勾选推荐位置并显示每处还空着几条', onCount >= 5 && blanks.length > 0, 'on=' + onCount + ' blanks=' + JSON.stringify(blanks));
await click('#gapPreview');
await waitFor('(function(){return /预览完成|没有|失败/.test((document.getElementById("gapNote")||{}).textContent||"")})()', 60000, 1200);
const dryNote = await text('#gapNote');
step('「预览能补什么」给出可补数量且不写库', /预览完成/.test(dryNote), dryNote);
const beforeFill = JSON.parse(await ev('fetch(' + J('/api/resources/' + seed.a) + ').then(function(r){return r.json()}).then(function(j){return JSON.stringify({p:j.completeness.percent})})'));
await ev('(function(){var c=document.getElementById("gAuto");if(c&&c.checked)c.click();return c?c.checked:"none"})()');   // 只跑一批，结论才会停在提示行上
await click('#gapRun');
await waitFor('(function(){return /跑完|停止|没能补到|批次完成/.test((document.getElementById("gapNote")||{}).textContent||"")})()', 150000, 2000);
const runNote = await text('#gapNote');
const stat2 = await text('#gapStat');
step('「开始批量补全」逐条出报告', (await num('.gap-item')) > 0 && /跑完|没能补到|停止/.test(runNote), runNote.slice(0, 130));
step('执行统计显示已处理与剩余', /已处理/.test(stat2), stat2.slice(0, 110));
const afterFill = JSON.parse(await ev('fetch(' + J('/api/resources/' + seed.a) + ').then(function(r){return r.json()}).then(function(j){return JSON.stringify({p:j.completeness.percent,m:(j.completeness.missing||[]).map(function(x){return x.key})})})'));
step('批量补全后目标资源完整度上升', afterFill.p > beforeFill.p, beforeFill.p + '% → ' + afterFill.p + '% 仍缺 ' + JSON.stringify(afterFill.m));
await goto(BASE + '/admin#/resources', 2600);
step('资源管理：行内 ✦ 单条补全 + 顶部批量入口', (await num('[data-a="fill"]')) > 0 && (await has('#gapsGo')));
await ev('(function(){var b=document.querySelector("[data-a=\"fill\"]");if(b)b.click()})()');
await sleep(15000);
const okFill = (await gate()) === false && !/加载失败|出错了/.test(String(await ev('document.getElementById("adminMain").innerText.slice(0,160)')));
step('行内「✦」补全单条不报错', okFill);

await cleanup([seed.a, seed.c]);
const jsErrs = errs.filter((e) => !/favicon|net::ERR|Failed to load resource|ERR_CONNECTION|ERR_NAME|CORS|Access to fetch|Failed to fetch|401|403|404/i.test(e));
step('全程无未捕获 JS 异常', jsErrs.length === 0, jsErrs.slice(0, 3).join(' | '));
console.log(fail ? '\nOPTIMIZE CHECKS FAILED: ' + fail : '\nOPTIMIZE CHECKS OK');
process.exit(fail ? 1 : 0);

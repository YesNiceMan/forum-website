/* 版式体检：CDP 渲染后检测横向溢出 / 破图 / 裁切 / 空白块 / JS 异常 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const PORT = Number(process.env.PORT || 9388);
const S = String.fromCharCode(10);
const dir = mkdtempSync(join(tmpdir(), 'aurora-qa-'));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars',
  '--disable-background-networking', '--disable-sync', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let info = null;
for (let i = 0; i < 50 && !info; i++) { try { info = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); } catch { await sleep(300); } }
if (!info) { console.log('chrome 未启动'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error((p.method || "NA") + " -> " + m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text).split(S)[0]);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej, method });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 45000);
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId); return r.result && r.result.value; };
const J = (v) => JSON.stringify(v);
const PROBE = ["(function(){","  var out = { overflowX: 0, wide: [], broken: [], clipped: [], blank: 0, count: document.querySelectorAll(\"*\").length };","  out.overflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;","  var vw = innerWidth;","  var SKIP = /aurora|blob|mask|skel|marquee|scroll-y|table-wrap|textarea|prose|code|logs|media-grid|pill|tag|truncate|clamp|__sum|stat|ripple|collage|hero-band__bg|__line|line$/;","  function info(n){ return n.tagName + \".\" + String(n.getAttribute(\"class\")||\"\").split(\" \")[0]; }","  Array.prototype.slice.call(document.querySelectorAll(\"body *\")).slice(0, 4500).forEach(function(n){","    var cs = getComputedStyle(n);","    if (cs.display === \"none\" || cs.visibility === \"hidden\" || parseFloat(cs.opacity) === 0) return;","    var cls = String(n.getAttribute(\"class\") || \"\");","    var r = n.getBoundingClientRect();","    if (r.width > 24 && r.right > vw + 4 && !SKIP.test(cls) && !(n.closest && n.closest(\".marquee\") || (n.closest && n.closest(\".table-wrap\"))) && cs.position !== \"fixed\") out.wide.push(info(n).slice(0,42) + \" right=\" + Math.round(r.right) + \" <\" + (n.parentElement ? info(n.parentElement) : \"\") + \">\");","    if (cs.overflowY === \"hidden\" && n.clientHeight > 26 && !SKIP.test(cls)) {","      var maxB = 0; var worst = \"\";","      Array.prototype.slice.call(n.children).forEach(function(c){","        var cst = getComputedStyle(c);","        if (cst.position === \"absolute\" || cst.position === \"fixed\") return;","        if (cst.transform !== \"none\" || cst.marginTop !== \"0px\") return;","        var cr = c.getBoundingClientRect();","        if (cr.height < 2) return;","        var b = cr.bottom - r.top;","        if (b > maxB) { maxB = b; worst = info(c); }","      });","      if (maxB > n.clientHeight + 7) out.clipped.push(info(n).slice(0,40) + \" 容器\" + n.clientHeight + \" 内容\" + Math.round(maxB) + \" (\" + worst.slice(0,26) + \")\");","    }","    if (r.width > 60 && r.height > 60 && !n.children.length && !(n.textContent||\"\").trim() && cs.backgroundImage === \"none\" && cs.backgroundColor === \"rgba(0, 0, 0, 0)\" && !/IMG|SVG|INPUT|CANVAS/.test(n.tagName)) out.blank++;","  });","  Array.prototype.slice.call(document.querySelectorAll(\"img\")).forEach(function(im){","    if (im.complete && im.naturalWidth === 0 && im.offsetWidth > 10) out.broken.push((im.currentSrc || im.src || \"\").slice(0, 80));","  });","  out.wide = out.wide.slice(0, 5); out.clipped = out.clipped.slice(0, 6); out.broken = out.broken.slice(0, 5);","  return JSON.stringify(out);","})()"].join(S);
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '#/library', '#/resource/r_ridge09', '#/search?q=%E6%9E%81%E5%85%89', '#/search?q=%E6%9E%81%E5%85%89&id=r_ridge09', '#/import', '#/submit', '#/favs'];
let fail = 0;
let loggedIn = false;
const VW = Number(process.env.AUDIT_W || 1440); const VH = Number(process.env.AUDIT_H || 900);
await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: VW < 500 }, sessionId);
for (const route of routes) {
  const isAdmin = /admin/.test(route);
  let url;
  if (route.startsWith('http')) url = route;
  else if (isAdmin) url = BASE + '/admin' + (route.indexOf('#') >= 0 ? route.slice(route.indexOf('#')) : '#/dash');
  else url = BASE + (route.startsWith('#') ? '/index.html' + route : route);
  const before = errs.length;
  await send('Page.navigate', { url }, sessionId);
  await sleep(3000);
  if (isAdmin && !loggedIn) {
    await ev('(function(){var g=document.getElementById("adminLogin");var u=document.getElementById("loginUser"),p=document.getElementById("loginPass");if(g&&!g.hidden&&u&&p){u.value=' + J(process.env.ADMIN_USER || 'admin') + ';p.value=' + J(process.env.ADMIN_PASS || 'aurora888') + ';document.getElementById("loginForm").requestSubmit();return 1}return 0})()');
    await sleep(2600);
    loggedIn = true;
    await send('Page.navigate', { url }, sessionId);
    await sleep(2800);
  }
  await ev('window.scrollTo(0,0);document.querySelectorAll("[data-reveal]").forEach(function(n){n.classList.add("is-in")});1');
  await sleep(900);
  const o = JSON.parse(await ev(PROBE));
  const problems = [];
  if (o.overflowX > 4) problems.push('横向溢出 ' + o.overflowX + 'px');
  if (o.wide.length) problems.push('超出视口: ' + o.wide.join(' | '));
  if (o.broken.length) problems.push('破图 ' + o.broken.length + ' 张: ' + o.broken[0]);
  if (o.clipped.length) problems.push('内容被裁切: ' + o.clipped.join(' | '));
  if (o.blank > 8) problems.push('疑似空白块 ' + o.blank);
  const jsErr = errs.slice(before);
  if (jsErr.length) problems.push(jsErr[0]);
  if (problems.length) fail++;
  console.log((problems.length ? '✗ ' : '✓ ') + route.padEnd(28) + 'nodes=' + o.count + (problems.length ? S + '    ' + problems.join(S + '    ').slice(0, 700) : ' 无异常'));
}
console.log(fail ? S + '版式体检：' + fail + ' 个页面有问题' : S + '版式体检通过');
ws.close();
chrome.kill('SIGKILL');
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

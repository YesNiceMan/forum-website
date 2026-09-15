/* 通过 Chrome DevTools Protocol 真实驱动后台页面：登录 → 逐个视图 → 收集 console 错误与渲染文本 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const PORT = Number(process.env.PORT || 9333);
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || 'aurora888';
const dir = mkdtempSync(join(tmpdir(), 'aurora-cdp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-component-update', '--metrics-recording-only', '--mute-audio',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function version() {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json/version');
  return res.json();
}
let info = null;
for (let i = 0; i < 40; i++) {
  try { info = await version(); break; } catch { await sleep(500); }
}
if (!info) { console.log('CHROME DevTools 未启动\n' + chromeErr.slice(0, 900)); chrome.kill(); process.exit(1); }

const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const events = [];
const consoleMsgs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  else if (msg.method) {
    events.push(msg);
    if (msg.method === 'Runtime.consoleAPICalled') consoleMsgs.push((msg.params.type) + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' '));
    if (msg.method === 'Log.entryAdded' && /error|warning/i.test(msg.params.entry.level)) consoleMsgs.push(msg.params.entry.level + ': ' + msg.params.entry.text.slice(0, 200) + (msg.params.entry.url ? ' @' + msg.params.entry.url.slice(msg.params.entry.url.lastIndexOf('/') + 1, msg.params.entry.url.lastIndexOf('/') + 60) : ''));
    if (msg.method === 'Runtime.exceptionThrown') consoleMsgs.push('EXCEPTION: ' + ((msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description) || msg.params.exceptionDetails.text || '').split('\n').slice(0, 3).join(' | '));
  }
};
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 30000); });
}
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) return 'EVAL-ERR ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.navigate', { url: BASE + '/admin' }, sessionId);
await sleep(3200);
console.log('login:', await ev('(function(){var u=document.getElementById("loginUser"),p=document.getElementById("loginPass");if(!u||!p)return "no-form";u.value=' + JSON.stringify(USER) + ';p.value=' + JSON.stringify(PASS) + ';document.getElementById("loginForm").requestSubmit();return "submitted"})()'));
await sleep(2400);
const views = (process.argv.slice(2).length ? process.argv.slice(2) : ['dash', 'resources', 'new', 'submissions', 'import', 'archive', 'taxonomy', 'sources', 'media', 'logs', 'settings', 'backup']);
let fail = 0;
for (const v of views) {
  const before = consoleMsgs.length;
  await ev('location.hash = ' + JSON.stringify('#/' + v));
  await sleep(v === 'import' ? 1500 : 2100);
  const info2 = await ev('JSON.stringify((function(){var m=document.getElementById("adminMain");if(!m)return {err:"no #adminMain"};var t=(m.innerText||"").replace(/\\s+/g," ").trim();var gate=document.getElementById("adminLogin");return {len:t.length, spin:/admin-boot|spinner/.test(m.innerHTML), gate: gate? !!(gate.offsetParent):false, text:t.slice(0,300)}})())');
  const errs = consoleMsgs.slice(before);
  const obj = typeof info2 === 'string' ? JSON.parse(info2) : info2;
  const bad = !obj || obj.err || obj.len < 40 || obj.spin || obj.gate || errs.length || /加载失败|没有这个后台页面|请先登录/.test(obj.text || '');
  if (bad) fail++;
  console.log((bad ? '✗ ' : '✓ ') + v.padEnd(12) + ' text=' + (obj.len || 0) + (obj.spin ? ' [仍加载]' : '') + (obj.gate ? ' [掉回登录]' : ''));
  errs.slice(0, 4).forEach((e) => console.log('    ' + e.slice(0, 260)));
  if (process.env.DETAIL && obj.text) console.log('    ' + obj.text.slice(0, 220));
}
console.log(fail ? 'ADMIN CHECKS FAILED: ' + fail : 'ADMIN VIEWS OK');
ws.close();
chrome.kill('SIGKILL');
rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

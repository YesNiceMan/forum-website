/* 截图：node tools/shot.mjs <url-hash> [out.png]  例：node tools/shot.mjs "#/dash" /tmp/dash.png */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const PORT = Number(process.env.SHOT_PORT || 9377);
const target = process.argv[2] || '/';
const out = process.argv[3] || '/tmp/shot.png';
const W = process.env.SHOT_W || 1440;
const H = process.env.SHOT_H || 900;
const FULL = process.env.SHOT_FULL === '1';
const dir = mkdtempSync(join(tmpdir(), 'aurora-shot-'));
const chrome = spawn(CH, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars',
  '--force-color-profile=srgb', '--disable-background-networking', '--disable-sync', '--remote-debugging-port=' + PORT, '--user-data-dir=' + dir, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let info = null;
for (let i = 0; i < 50 && !info; i++) { try { info = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); } catch { await sleep(300); } }
if (!info) { console.log('chrome 未启动'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(info.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 45000);
});
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: Number(W), height: Number(H), deviceScaleFactor: 2, mobile: false }, sessionId);
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  return r.result && r.result.value;
};
const isAdmin = /admin/.test(target);
const url = target.startsWith('http') ? target : (target.startsWith('#') ? (isAdmin ? BASE + '/admin' : BASE + '/index.html') + target : BASE + target);
await send('Page.navigate', { url }, sessionId);
await sleep(3600);
if (isAdmin) {
  await ev('(function(){var u=document.getElementById("loginUser"),p=document.getElementById("loginPass");if(u&&p){u.value=' + JSON.stringify(process.env.ADMIN_USER || 'admin') + ';p.value=' + JSON.stringify(process.env.ADMIN_PASS || 'aurora888') + ';document.getElementById("loginForm").requestSubmit();}})()');
  await sleep(3000);
}
await ev('window.scrollTo(0,0);document.querySelectorAll("[data-reveal]").forEach(function(n){n.classList.add("is-in")});(document.scrollingElement||document.documentElement).scrollTop=0');
await sleep(1200);
const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: FULL, clip: FULL ? undefined : { x: 0, y: 0, width: Number(W), height: Number(H), scale: 1 } }, sessionId);
writeFileSync(out, Buffer.from(data, 'base64'));
console.log('saved', out, (data.length / 1024).toFixed(0) + 'KB', url);
ws.close();
chrome.kill('SIGKILL');
rmSync(dir, { recursive: true, force: true });

/* 无头渲染检查：抓 DOM + console，可带登录态检查后台视图 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:5180';
const opts = { admin: false, detail: false, budget: 12000, wait: 26000 };
const routes = [];
process.argv.slice(2).forEach((a) => {
  if (a === '--admin') opts.admin = true;
  else if (a === '--detail') opts.detail = true;
  else if (a.startsWith('--budget=')) opts.budget = Number(a.slice(9));
  else routes.push(a);
});
if (!routes.length) {
  routes.push('/', '#/library', '#/search?q=aurora', '#/import', '#/submit', '#/favs');
  try {
    const list = await (await fetch(BASE + '/api/resources?pageSize=1')).json();
    const first = list && list.items && list.items[0];
    if (first) routes.push('#/resource/' + first.id);
  } catch {}
}

async function render(route, dir, pre) {
  const full = route.startsWith('http') ? route : (route.startsWith('#') ? BASE + '/index.html' + route : BASE + route);
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', '--disable-component-update', '--metrics-recording-only', '--mute-audio',
    '--user-data-dir=' + dir, '--virtual-time-budget=' + opts.budget, '--timeout=' + (opts.budget + 8000),
    '--enable-logging=stderr', '--log-level=0', '--dump-dom', pre ? BASE + '/index.html' : full,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  await new Promise((resolve) => {
    const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, opts.wait);
    child.on('exit', () => { clearTimeout(t); resolve(); });
  });
  return { html: out, err };
}

let fail = 0;
for (const route of routes) {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-cr-'));
  const isBackend = /^#?(\/?admin)?\/(dash|resources|new|submissions|archive|taxonomy|sources|media|logs|settings|backup)/.test(route) || route === 'admin';
  let res = await render(route, dir);
  let consoleLines = (res.err.match(/INFO:CONSOLE[^\n]*/g) || []).filter((l) => !/DevTools|favicon/i.test(l));
  const scope = isBackend || route === 'admin' ? /(<div class="admin-main"|id="adminMain"|id="adminLogin")[\s\S]*/ : /<main[^>]*>[\s\S]*?<\/main>/;
  let html = res.html;
  let body = (html.match(scope) || [''])[0];
  if (opts.admin && isBackend && /id="adminLogin"/.test(body) && !/is-hidden|hidden/.test(body.match(/class="[^"]*"[^>]*id="adminLogin"|id="adminLogin"[^>]*class="[^"]*"/) || '')) {
    /* 未登录：第二次跑，先用 fetch 登录再跳转 */
    const res2 = await render('ADMIN_FLOW:' + route, dir, true);
    html = res2.html;
    body = (html.match(scope) || [''])[0];
  }
  const text = body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const empty = body.replace(/<(!|style|script)[\s\S]*?<\/\1>/g, '').replace(/\s/g, '') === '';
  const jsErr = consoleLines.filter((l) => /Uncaught|Error|error/i.test(l));
  const bad = empty || jsErr.length || /页面加载失败|无法连接服务|ReferenceError|TypeError: /.test(text);
  if (bad) fail++;
  console.log((bad ? '✗' : '✓') + ' ' + route + '  body=' + body.length + 'B');
  if (empty) console.log('   ! 视图为空');
  jsErr.slice(0, 5).forEach((l) => console.log('   JS ' + l.slice(0, 240)));
  if (opts.detail && text) console.log('   ' + text.slice(0, 260));
  rmSync(dir, { recursive: true, force: true });
}
console.log(fail ? 'CHECKS FAILED: ' + fail : 'ALL ROUTES RENDER OK');
process.exit(fail ? 1 : 0);

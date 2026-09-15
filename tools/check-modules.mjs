/* 静态解析 import 图 + vm 链接校验（不执行代码） */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// SourceTextModule 需要 --experimental-vm-modules；缺失时带该标志重启一次，仍不可用则退化为纯静态检查
if (typeof vm.SourceTextModule !== "function" && !process.env.AURORA_VM_RELIT) {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, ["--experimental-vm-modules", ...process.argv.slice(1)], {
    stdio: "inherit", env: { ...process.env, AURORA_VM_RELIT: "1" },
  });
  if (r.error) throw r.error;
  process.exit(r.status == null ? 1 : r.status);
}

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..', 'web', 'assets', 'js');
const context = vm.createContext({ document: { title: '' }, console });
const mods = new Map();
function specifiers(src) {
  const out = [];
  for (const m of src.matchAll(/(?:^|\n)\s*import[^'"]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of src.matchAll(/^[ \t]*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
  return [...new Set(out)];
}
function resolveFrom(file, spec) { return path.resolve(path.dirname(file), spec); }
function collect(file, seen = new Set()) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return;
  seen.add(abs);
  if (!fs.existsSync(abs)) { console.log('MISSING FILE: ' + path.relative(ROOT, abs)); return; }
  const src = fs.readFileSync(abs, 'utf8');
  if (typeof vm.SourceTextModule === "function") { const mod = new vm.SourceTextModule(src, { identifier: pathToFileURL(abs).href, context });
  mod.__file = abs;
  mods.set(abs, mod);
  }
  for (const s of specifiers(src)) collect(resolveFrom(abs, s), seen);
  return;
}
const entries = ['app.js', 'admin.js'].map((f) => path.join(ROOT, f));
const seen = new Set();
for (const e of entries) collect(e, seen);
const errs = [];
for (const [abs, mod] of mods) {
  try {
    mod.link((spec) => {
      const target = resolveFrom(abs, spec);
      if (!mods.has(target)) { errs.push(path.relative(ROOT, abs) + ' -> 无法解析 ' + spec); return null; }
      return mods.get(target);
    });
  } catch (err) {
    errs.push(path.relative(ROOT, abs) + ': ' + err.message);
  }
}
console.log('modules: ' + mods.size);
console.log(errs.length ? 'LINK ERRORS:\n' + [...new Set(errs)].join('\n') : 'ALL MODULES LINK OK');
process.exit(errs.length ? 1 : 0);

/* 重置演示数据：清空 data/db.json 与镜像上传的图片，保留 / 重建 web/uploads/seed 海报 */
import { rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const files = ['data/db.json', 'data/db.json.tmp'];
for (const f of files) {
  const t = resolve(root, f);
  if (existsSync(t)) { await rm(t, { force: true }); console.log('removed', f); } else console.log('skip (missing)', f);
}
const up = resolve(root, 'web/uploads');
if (existsSync(up)) {
  for (const name of await readdir(up)) {
    if (name === 'seed' || name === '.DS_Store') continue;
    await rm(join(up, name), { recursive: true, force: true });
  }
  console.log('cleaned web/uploads（保留 seed/ 海报）');
}
await mkdir(resolve(root, 'data'), { recursive: true });
const posters = resolve(root, 'web/uploads/seed');
if (!existsSync(posters) || (await readdir(posters)).length === 0) {
  console.log('重新生成种子海报…');
  spawnSync(process.execPath, [resolve(root, 'tools/make-posters.mjs')], { stdio: 'inherit' });
}
console.log('已重置。运行 npm start 后将重新播种演示数据（默认管理员 admin / aurora888）。');

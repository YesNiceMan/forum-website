// 生成站内示例海报 / 预览图（SVG，零依赖、离线可读）
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = new URL('../web/uploads/seed/', import.meta.url).pathname;

const PALETTES = {
  aurora: ['#06121f', '#0b3550', '#1e9f8f', '#7cf0c8', '#b9a6ff'],
  neon: ['#0a0618', '#241a4d', '#7c5cff', '#22d3ee', '#ff6ec7'],
  atlas: ['#120d08', '#3b2a17', '#a8752e', '#e8c88a', '#f6f1e6'],
  deepsig: ['#05090f', '#0e2a47', '#2f7bd6', '#7fd1ff', '#f7b955'],
  museum: ['#0b0f1a', '#1b2a52', '#5d7cff', '#b3c3ff', '#ffd9a8'],
  vinyl: ['#100610', '#3a1030', '#c2426b', '#ffb3c7', '#f6e6d8'],
  kestrel: ['#04100f', '#0d3b34', '#19b795', '#8ff0cd', '#f5f7e6'],
  cityatlas: ['#0c0d12', '#2b2f3f', '#7b86a8', '#cdd6ee', '#ffe9c2'],
  ridge: ['#12060f', '#43145a', '#b83cff', '#ff9d6e', '#ffe6a7'],
  orbit: ['#050b16', '#132a55', '#3f6bd8', '#9ec1ff', '#e7f0ff'],
  forest: ['#050f0a', '#123526', '#2f8a5d', '#a5e8b0', '#f2f7e0'],
};
const TITLES = {
  aurora: ['极光之境', 'AURORA REALM · 4K'],
  neon: ['NEON UI KIT', '1200+ 组件 / 暗色玻璃拟态'],
  atlas: ['ATLAS TILES', '8K PBR 地形材质'],
  deepsig: ['DEEP SIGNAL', '深度学习工程实践 2025'],
  museum: ['明日博物馆', 'MUSEUM OF TOMORROW'],
  vinyl: ['MIDNIGHT VINYL', 'Vol.3 · 黑胶采样包'],
  kestrel: ['KESTREL', '跨平台笔记内核 v2.4'],
  cityatlas: ['城市图集', '1900 — 2020'],
  ridge: ['RIDGE LOOK.dev', '完整工程包'],
  orbit: ['ORBIT', '天文观测数据工具'],
  forest: ['北境森林', '6 小时无损环境音'],
};

function rnd(seed) {
  let s = seed || 1;
  return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const codeOf = (name) => [...name].reduce((n, c) => n + c.charCodeAt(0) * 131, 7);
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function poster(key, variant) {
  const pal = PALETTES[key] || PALETTES.aurora;
  const title = TITLES[key] || [key, ''];
  const r = rnd(codeOf(key) + variant * 977);
  const w = variant === 0 ? 1200 : 1600;
  const h = variant === 0 ? 1600 : 900;
  const min = Math.min(w, h);
  const parts = [];
  for (let i = 0; i < 7; i++) {
    parts.push('<circle cx="' + Math.round(r() * w) + '" cy="' + Math.round(r() * h) + '" r="' + Math.round((0.12 + r() * 0.34) * min) + '" fill="' + pal[2 + Math.floor(r() * (pal.length - 2))] + '" opacity="' + (0.06 + r() * 0.16).toFixed(3) + '" filter="url(#blur)"/>');
  }
  for (let i = 0; i < 5; i++) {
    const y = Math.round(h * (0.15 + r() * 0.7));
    const amp = Math.round(28 + r() * 90);
    const d = 'M -40 ' + y + ' C ' + Math.round(w * 0.25) + ' ' + (y - amp) + ', ' + Math.round(w * 0.62) + ' ' + (y + amp) + ', ' + (w + 40) + ' ' + Math.round(y + (r() - 0.5) * amp);
    parts.push('<path d="' + d + '" fill="none" stroke="' + pal[3] + '" stroke-width="' + (0.6 + r() * 2.4).toFixed(1) + '" opacity="' + (0.12 + r() * 0.35).toFixed(2) + '"/>');
  }
  let grain = '';
  for (let i = 0; i < 90; i++) grain += '<circle cx="' + Math.round(r() * w) + '" cy="' + Math.round(r() * h) + '" r="' + (r() * 1.4).toFixed(2) + '" fill="#fff" opacity="' + (0.02 + r() * 0.16).toFixed(3) + '"/>';
  let grid = '';
  for (let i = 0; i < 9; i++) {
    const y = Math.round((h / 9) * i + h / 22);
    grid += '<line x1="0" y1="' + y + '" x2="' + w + '" y2="' + y + '" stroke="#ffffff" stroke-width="1" opacity="0.05"/>';
  }
  const big = Math.round(w * (variant === 0 ? 0.13 : 0.075));
  const left = Math.round(w * 0.07);
  return ['<svg xmlns="http://www.w3.org/2000/svg" width="', w, '" height="', h, '" viewBox="0 0 ', w, ' ', h, '" role="img" aria-label="', esc(title[0]), '">',
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="', pal[0], '"/><stop offset="0.55" stop-color="', pal[1], '"/><stop offset="1" stop-color="', pal[0], '"/></linearGradient>',
    '<radialGradient id="glow" cx="0.2" cy="0.15" r="0.9"><stop offset="0" stop-color="', pal[3], '" stop-opacity="0.5"/><stop offset="1" stop-color="', pal[0], '" stop-opacity="0"/></radialGradient>',
    '<filter id="blur"><feGaussianBlur stdDeviation="', Math.round(min * 0.06), '"/></filter>',
    '</defs>',
    '<rect width="', w, '" height="', h, '" fill="url(#bg)"/>',
    '<rect width="', w, '" height="', h, '" fill="url(#glow)"/>',
    grid, parts.join(''), grain,
    '<g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif">',
    '<text x="', left, '" y="', Math.round(h * (variant === 0 ? 0.52 : 0.48)), '" font-size="', big, '" font-weight="700" fill="#f8fafc" letter-spacing="-1">', esc(title[0]), '</text>',
    '<text x="', left + 2, '" y="', Math.round(h * (variant === 0 ? 0.575 : 0.56)), '" font-size="', Math.round(big * 0.28), '" fill="', pal[3], '" opacity="0.9" letter-spacing="2">', esc(title[1]), '</text>',
    '<text x="', left + 2, '" y="', Math.round(h * 0.93), '" font-size="', Math.round(big * 0.2), '" fill="#e2e8f0" opacity="0.55" letter-spacing="3">AURORA VAULT · SEED ', String(variant).padStart(2, '0'), '</text>',
    '</g></svg>'].join('');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let n = 0;
  for (const key of Object.keys(PALETTES)) {
    const variants = ['aurora', 'ridge', 'atlas'].includes(key) ? [0, 1, 2, 3] : ['neon', 'kestrel', 'museum'].includes(key) ? [0, 1, 2] : [0, 1];
    for (const v of variants) {
      const file = path.join(OUT, v === 0 ? key + '.svg' : key + '-' + (v + 1) + '.svg');
      await writeFile(file, poster(key, v), 'utf8');
      n++;
    }
  }
  console.log('已生成 ' + n + ' 张海报/预览图 -> web/uploads/seed/');
}
main().catch((err) => { console.error(err); process.exit(1); });

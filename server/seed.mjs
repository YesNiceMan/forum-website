// 种子数据：内置示例资源（配合生成的 SVG 海报）
import { NOW } from './lib/util.mjs';

const P = (n) => '/uploads/seed/' + n + '.svg';
const G = (n, i) => '/uploads/seed/' + n + '-' + i + '.svg';

const days = (n) => new Date(Date.now() - n * 86400000).toISOString();

export function seedResources() {
  return [
    {
      id: 'r_aurora01', slug: 'aurora-4k-2024', title: '极光之境 · 4K 纪录合集（2024 重制）',
      altTitles: ['Aurora Realm 4K'], type: '影视', tags: ['纪录片', '4K', '自然', '治愈', 'HDR'],
      score: 9.2, votes: 168, summary: '跨越 6 个纬度带拍摄的极光全记录，含 12 段 4K HDR 空镜与实拍环境声，适合作为长时间桌面背景与剪辑素材。',
      content: '<p>本片由 3 人小队在高纬度地区驻守 87 天完成，收录 <strong>12 段 4K HDR 空镜</strong>、6 段夜间延时与完整环境声轨。</p><ul><li>正片 4 集 × 48 分钟，HEVC 10bit</li><li>附赠 3.6GB 无损空镜包（可商用素材已标注）</li><li>中英双语硬字幕 / 纯字幕轨两版</li></ul>',
      cover: P('aurora'), gallery: [P('aurora'), G('aurora', 2), G('aurora', 3), G('aurora', 4)],
      downloads: [
        { url: 'https://pan.quark.cn/s/1a2b3c4d5e6f', label: '夸克网盘', provider: 'quark', kind: 'netdisk', color: '#3d7bff', code: '', size: '12.4 GB', quality: '4K HDR', note: '转存后即可在线原画播放' },
        { url: 'https://pan.baidu.com/s/1AvX9kQmZ0h8Lp2nN4dTg?pwd=aur7', label: '百度网盘', provider: 'baidu', kind: 'netdisk', color: '#4f7cff', code: 'aur7', size: '12.4 GB', quality: '4K HDR', note: '非会员限速，建议配合索引下载' },
        { url: 'magnet:?xt=urn:btih:0a1b2c3d4e5f60718293a4b5c6d7e8f901234567&dn=Aurora.Realm.2024.2160p.HEVC', label: '磁力链接', provider: 'magnet', kind: 'magnet', color: '#f43f5e', code: '', size: '11.9 GB', quality: '2160p HEVC', note: '种子 26 做种 / 完整度 100%' },
      ],
      others: [
        { url: 'https://www.bilibili.com/bangumi/play/ss38465', label: 'B 站番剧页（在线预览）', provider: 'web', kind: 'site', color: '#34d399' },
        { url: 'https://www.imdb.com/title/tt15442166/', label: 'IMDb 资料页', provider: 'web', kind: 'web', color: '#f5c518' },
      ],
      meta: { year: '2024', region: '冰岛 / 挪威 / 加拿大', size: '12.4 GB', language: '无对白 · 中英字幕', duration: '4×48 分钟', developer: 'Aurora Studio', format: 'MKV / HEVC 10bit' },
      sourceUrl: 'https://www.imdb.com/title/tt15442166/', sourceName: 'IMDb', status: 'published', featured: true, views: 4820, favorites: 612, createdAt: days(6), updatedAt: days(1),
    },
    {
      id: 'r_neon02', slug: 'neon-ui-kit', title: 'NEON UI KIT｜暗色玻璃拟态组件库（Figma + 代码）',
      type: '素材', tags: ['UI', 'Figma', '设计系统', '暗色', '组件库'], score: 8.8, votes: 94,
      summary: '1200+ 组件、6 套主题变量、包含 Web / RN 双端代码同步的设计系统源文件，附带 48 个动效原型。',
      content: '<p>组件全部基于变量（Variables）与 Auto Layout 构建，支持一键切换主题色。含 <em>48 个 Smart Animate 动效原型</em>，可直接复制到项目。</p><p>资源包含：Figma 源文件、设计 Token（JSON）、Tailwind / CSS Variables 映射表。</p>',
      cover: P('neon'), gallery: [P('neon'), G('neon', 2), G('neon', 3)],
      downloads: [
        { url: 'https://www.alipan.com/s/9pQmZ0hLp2nN4dTgvX9k', label: '阿里云盘', provider: 'alipan', kind: 'netdisk', color: '#ff6a00', code: '9pQm', size: '820 MB', quality: 'Figma + 代码', note: '含 1.2GB 高清预览图包' },
        { url: 'https://lanzn.com/NeonUIkit', label: '蓝奏云', provider: 'lanzou', kind: 'netdisk', color: '#22a7f0', code: '', size: '412 MB', quality: 'Token + 预览', note: '免登录直下' },
      ],
      others: [{ url: 'https://www.figma.com/community/file/1234567890', label: '社区原文页', provider: 'web', kind: 'web', color: '#a78bfa' }],
      meta: { year: '2025', size: '820 MB', language: '英文界面', developer: 'Studio Halide', format: 'Figma / JSON / TSX' },
      sourceUrl: 'https://www.figma.com/community', status: 'published', featured: true, views: 2310, favorites: 388, createdAt: days(12), updatedAt: days(2),
    },
    {
      id: 'r_atlas03', slug: 'atlas-tiles', title: 'ATLAS 高精度地形贴图库 8K（PBR 材质）',
      type: '素材', tags: ['贴图', 'PBR', '8K', 'Blender', '游戏美术'], score: 9.0, votes: 61,
      summary: '156 组 8K PBR 地形材质，含法线 / 粗糙度 / 高度通道，适配 Blender、UE5、Unity 与 Cinema4D。',
      content: '<p>所有材质均实拍扫描后手工接缝处理，可直接用于大地图混合（Layer Blend）。</p>',
      cover: P('atlas'), gallery: [P('atlas'), G('atlas', 2), G('atlas', 3)],
      downloads: [
        { url: 'https://pan.baidu.com/s/1Atlas8KTilesPack?pwd=atl3', label: '百度网盘', provider: 'baidu', kind: 'netdisk', color: '#4f7cff', code: 'atl3', size: '34.2 GB', quality: '8K PBR', note: '分 6 卷，需一并下载' },
        { url: 'thunder://QUFERFRpbGVzLnppcA==', label: '迅雷下载', provider: 'thunder', kind: 'thunder', color: '#22d3ee', code: '', size: '34.2 GB' },
      ],
      others: [{ url: 'https://polyhaven.com/textures', label: 'Poly Haven（同源免费）', provider: 'web', kind: 'web', color: '#34d399' }],
      meta: { year: '2023', size: '34.2 GB', developer: 'Atlas Scans', format: 'EXR / PNG' },
      status: 'published', views: 1580, favorites: 240, createdAt: days(28), updatedAt: days(9),
    },
    {
      id: 'r_deepsig04', slug: 'deep-signal-course', title: '《Deep Signal》深度学习工程实践 2025',
      type: '教程', tags: ['深度学习', 'Python', 'LLM', '工程化', '课件'], score: 8.5, votes: 132,
      summary: '从张量运算到分布式训练完整路线，28 小时视频 + 全套 Notebook 与作业评测脚本。',
      content: '<p>课程分 6 个模块：数学基础、PyTorch 内核、训练循环工程化、分布式与显存优化、推理加速、评测体系。每章配套可运行工程样例。</p>',
      cover: P('deepsig'), gallery: [P('deepsig'), G('deepsig', 2)],
      downloads: [
        { url: 'https://pan.quark.cn/s/deepsignal2025course', label: '夸克网盘', provider: 'quark', kind: 'netdisk', color: '#3d7bff', code: '', size: '18.7 GB', quality: '1080P', note: '含课件与代码包' },
        { url: 'https://drive.uc.cn/s/deepsignalUC', label: 'UC 网盘', provider: 'uc', kind: 'netdisk', color: '#f97316', code: '8f2d', size: '18.7 GB' },
      ],
      others: [{ url: 'https://github.com/deepsignal/syllabus', label: '官方课件仓库', provider: 'web', kind: 'site', color: '#8b949e' }],
      meta: { year: '2025', size: '18.7 GB', language: '中文', duration: '28 小时', developer: 'Deep Signal Lab', format: 'MP4 + IPYNB' },
      status: 'published', featured: false, views: 3620, favorites: 501, createdAt: days(20), updatedAt: days(3),
    },
    {
      id: 'r_museum05', slug: 'museum-of-tomorrow', title: '明日博物馆｜3D 互动展陈资源包',
      type: '其他', tags: ['Three.js', '互动', '展陈', '网页3D', '灵感'], score: 8.1, votes: 43,
      summary: '一套完整的网页 3D 展陈方案：场景漫游、展品聚焦、旁白音轨与无障碍导览逻辑。',
      content: '<p>基于 Three.js + React Three Fiber 实现，含 9 个展厅、42 个展品模型（glb）与 1 套旁白音频。</p>',
      cover: P('museum'), gallery: [P('museum'), G('museum', 2), G('museum', 3)],
      downloads: [
        { url: 'https://mypikpak.com/s/VfPPakMuseum2025', label: 'PikPak', provider: 'pikpak', kind: 'netdisk', color: '#7c5cff', code: '', size: '3.1 GB' },
        { url: 'https://github.com/aurora-vault/museum-of-tomorrow/archive/refs/heads/main.zip', label: '源码直链', provider: 'httpdl', kind: 'direct', color: '#94a3b8', code: '', size: '86 MB' },
      ],
      others: [{ url: 'https://museum.demo.aurora/', label: '在线体验', provider: 'web', kind: 'web', color: '#38bdf8' }],
      meta: { year: '2025', size: '3.1 GB', developer: 'Aurora Labs', format: 'glb / TSX' },
      status: 'published', views: 940, favorites: 133, createdAt: days(9), updatedAt: days(4),
    },
    {
      id: 'r_vinyl06', slug: 'midnight-vinyl', title: 'Midnight Vinyl｜午夜黑胶采样包 Vol.3',
      type: '音乐', tags: ['采样', 'Lo-Fi', 'Jazz', '黑胶', '无损'], score: 8.6, votes: 77,
      summary: '2.4GB 黑胶底噪 / 鼓组 / 和弦循环，全部为模拟台实录，附 Ableton 工程与 MIDI。',
      content: '<p>372 个采样，含 24 段完整 Loop 与 6 个工程模板。响度统一到 -14 LUFS，可直接入库使用。</p>',
      cover: P('vinyl'), gallery: [P('vinyl'), G('vinyl', 2)],
      downloads: [
        { url: 'ed2k://|file|Midnight.Vinyl.Vol3.flac.zip|24809284|ABCDEF0123456789|/', label: 'eD2k', provider: 'ed2k', kind: 'ed2k', color: '#fb7185', code: '', size: '2.4 GB', quality: 'FLAC' },
        { url: 'https://pan.xunlei.com/s/VXunleiVinylVol3', label: '迅雷云盘', provider: 'thunder', kind: 'netdisk', color: '#22d3ee', code: '', size: '2.4 GB' },
      ],
      others: [],
      meta: { year: '2024', size: '2.4 GB', format: 'WAV / FLAC / MIDI' },
      status: 'published', views: 1210, favorites: 205, createdAt: days(35), updatedAt: days(11),
    },
    {
      id: 'r_kestrel07', slug: 'kestrel-editor', title: 'Kestrel Editor｜跨平台轻量笔记内核',
      type: '应用', tags: ['开源', '笔记', 'Rust', '跨平台', '插件'], score: 8.9, votes: 118,
      summary: 'Rust 编写的内容内核 + Web 渲染层，支持块级编辑、双向链接、本地优先与端到端同步。',
      content: '<p>核心特性：CRDT 多人协作、SQLite 本地存储、插件沙箱、Markdown 与块结构双向转换。Windows / macOS / Linux 三平台安装包均已签名。</p>',
      cover: P('kestrel'), gallery: [P('kestrel'), G('kestrel', 2), G('kestrel', 3)],
      downloads: [
        { url: 'https://github.com/aurora-vault/kestrel/releases/download/v2.4.1/Kestrel-2.4.1-macos-universal.dmg', label: 'macOS 通用', provider: 'httpdl', kind: 'direct', color: '#94a3b8', code: '', size: '118 MB', quality: 'v2.4.1' },
        { url: 'https://cloud189.cn/web/share?code=Kestrel189', label: '天翼云盘', provider: 'tianyi', kind: 'netdisk', color: '#e6484d', code: '4d9c', size: '352 MB', quality: '全平台离线包' },
      ],
      others: [{ url: 'https://kestrel.app/docs', label: '官方文档', provider: 'web', kind: 'doc', color: '#a78bfa' }],
      meta: { year: '2025', version: 'v2.4.1', size: '118 MB', developer: 'Kestrel Community', format: 'DMG / EXE / AppImage' },
      status: 'published', views: 2760, favorites: 430, createdAt: days(16), updatedAt: days(5),
    },
    {
      id: 'r_atlasbook08', slug: 'city-atlas-book', title: '《城市图集 1900-2020》扫描版（含书签）',
      type: '图书', tags: ['建筑', '摄影集', 'PDF', '扫描', '书签'], score: 8.3, votes: 52,
      summary: '六个城市、120 年影像对照，含 460 页高清扫描与人工重建目录书签。',
      content: '<p>原书绝版，本版本为 600dpi 扫描后重建文字层（OCR 准确率 99.2%），并补齐目录与页码。</p>',
      cover: P('cityatlas'), gallery: [P('cityatlas'), G('cityatlas', 2)],
      downloads: [
        { url: 'https://115.com/s/1CityAtlasBook1900', label: '115 网盘', provider: '115', kind: 'netdisk', color: '#00a870', code: '', size: '1.9 GB', quality: '600dpi PDF' },
        { url: 'https://mega.nz/file/CityAtlasDlDemo#key', label: 'MEGA', provider: 'mega', kind: 'netdisk', color: '#e0d04a', code: '', size: '1.9 GB' },
      ],
      others: [{ url: 'https://openlibrary.org/works/OL12345W', label: 'Open Library 条目', provider: 'web', kind: 'doc', color: '#22a7f0' }],
      meta: { year: '2021', size: '1.9 GB', language: '中文 / 英文对照', format: 'PDF（含文字层）', developer: 'City Archive' },
      status: 'published', views: 1680, favorites: 262, createdAt: days(42), updatedAt: days(14),
    },
    {
      id: 'r_ridge09', slug: 'ridge-look-dev', title: 'RIDGE LOOK.dev｜独立游戏完整工程包',
      type: '游戏', tags: ['独立游戏', 'Unity', '像素', '源码', '横版'], score: 9.4, votes: 211,
      summary: '含可玩 Demo、美术源文件与关卡编辑器，附 40 分钟开发者解说与全部音乐分轨。',
      content: '<p>Steam 试玩节获奖作品。工程基于 Unity 2022 LTS，关卡数据全部为 JSON，便于二次创作。</p>',
      cover: P('ridge'), gallery: [P('ridge'), G('ridge', 2), G('ridge', 3), G('ridge', 4)],
      downloads: [
        { url: 'magnet:?xt=urn:btih:1122334455667788990011223344556677889900&dn=RIDGE.LOOK.dev.Complete.Pack', label: '磁力链接', provider: 'magnet', kind: 'magnet', color: '#f43f5e', code: '', size: '6.8 GB', note: '含全部美术源文件' },
        { url: 'https://pan.quark.cn/s/ridgeLookQuark', label: '夸克网盘', provider: 'quark', kind: 'netdisk', color: '#3d7bff', code: '', size: '6.8 GB' },
      ],
      others: [{ url: 'https://store.steampowered.com/app/1234567/', label: 'Steam 商店页', provider: 'web', kind: 'web', color: '#66c0f4' }],
      meta: { year: '2024', size: '6.8 GB', developer: 'Two Owls', format: 'Unity 2022 LTS' },
      status: 'published', featured: true, views: 5410, favorites: 890, createdAt: days(3), updatedAt: days(1),
    },
    {
      id: 'r_orbit10', slug: 'orbit-tracker', title: 'ORBIT Tracker｜开源天文观测数据工具',
      type: '应用', tags: ['天文', '开源', 'Python', '数据可视化'], score: 7.9, votes: 28,
      summary: '抓取公开星历数据并生成本地观测窗口建议，支持小行星 / 彗星 / 卫星凌日提醒。',
      content: '<p>命令行 + 网页仪表盘双形态，内置 40 万颗小行星轨道根数缓存。</p>',
      cover: P('orbit'), gallery: [P('orbit'), G('orbit', 2)],
      downloads: [{ url: 'https://123pan.com/s/OrbitTracker123', label: '123 云盘', provider: '123', kind: 'netdisk', color: '#2563eb', code: 'astr', size: '760 MB' }],
      others: [{ url: 'https://pypi.org/project/orbit-tracker/', label: 'PyPI', provider: 'web', kind: 'web', color: '#3775a9' }],
      meta: { year: '2025', size: '760 MB', developer: 'Orbit Community', format: 'Wheel / Docker' },
      status: 'draft', views: 320, favorites: 41, createdAt: days(2), updatedAt: days(1),
    },
  ];
}

export function seedSubmissions() {
  return [
    {
      id: 's_demo01', title: '北境森林｜无损环境音 6 小时', type: '音乐', tags: ['环境音', '白噪音', 'WAV'], score: 8.2,
      summary: '6 小时单段无损环境声，适合作为专注背景与视频底噪。',
      content: '来自站友 “木几” 投稿：录音设备为 Sound Devices Mix-5，双主麦 + MS 制式。',
      downloads: [{ url: 'https://pan.baidu.com/s/1ForestAudio6h?pwd=frst', label: '百度网盘', provider: 'baidu', kind: 'netdisk', color: '#4f7cff', code: 'frst', size: '3.8 GB' }],
      others: [{ url: 'https://freesound.org/people/forest/', label: '原始出处', provider: 'web', kind: 'web', color: '#34d399' }],
      cover: '/uploads/seed/forest.svg', sourceUrl: 'https://freesound.org/people/forest/', contact: 'muji@aurora.dev',
      status: 'pending', at: days(1), reviewedAt: '', reviewNote: '', resourceId: '', ip: '10.0.0.8',
    },
    {
      id: 's_demo02', title: '昭和平面设计年鉴（1968-1989）', type: '图书', tags: ['设计', '年鉴', '扫描'], score: 0,
      summary: '', content: '站外看到有人在群里发过，只有封面和一条网盘链接，信息不完整。',
      downloads: [{ url: 'https://pan.quark.cn/s/showwaYearbook', label: '夸克网盘', provider: 'quark', kind: 'netdisk', color: '#3d7bff', code: '', size: '' }],
      others: [], cover: '', sourceUrl: '', contact: '', status: 'pending', at: days(2), reviewedAt: '', reviewNote: '', resourceId: '', ip: '10.0.0.19',
    },
  ];
}

export function seedLogs() {
  return [
    { id: 'l_seed1', kind: 'system', message: '站点初始化完成，已载入 10 条示例资源与 15 个检索来源', meta: {}, at: NOW() },
    { id: 'l_seed2', kind: 'import', message: '示例 Excel 已生成：samples/demo-resources.xlsx（用于演示导入流程）', meta: {}, at: NOW() },
  ];
}

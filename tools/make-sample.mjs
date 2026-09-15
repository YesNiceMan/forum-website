// 生成演示用 Excel：samples/demo-resources.xlsx（手写最小 OOXML + ZIP，零依赖）
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';

const OUT = new URL('../samples/', import.meta.url).pathname;

const ROWS = [
  ['标题', '类型', '标签', '评分', '简介', '资源下载', '其他来源', '封面', '年份', '大小', '格式', '作者'],
  ['星尘档案馆｜科幻片单 108 部', '影视', '科幻,剧情,蓝光原盘', '8.9', '按时间线整理的 108 部科幻长片清单，含 4K 与原盘两种版本索引，附带影评手记。', 'https://pan.quark.cn/s/9f2c1d8e7a6b 提取码：sd23', 'https://m.imdb.com/list/ls025119890/', 'https://images.unsplash.com/photo-1419242170436-54522e1fff86?w=1200', '2024', '86.4 GB', 'MKV', 'Aurora 编辑部'],
  ['深海回声：水下录音素材包', '素材', '环境音,水声,无损', '8.1', '由科考队带回来的 42 段水下录音，覆盖 3 种深度层，24bit/96kHz，适合纪录片与游戏氛围。', 'https://pan.baidu.com/s/1Xk9dQm2lZp8vN0aB7cDeFg?pwd=echo', 'https://freesound.org/people/underwater/', 'https://images.unsplash.com/photo-1439405326854-014607f694d7?w=1200', '2023', '12.7 GB', 'WAV', 'Ocean Lab'],
  ['Rust 系统编程实战（第 2 版）', '图书', 'Rust,编程,电子书', '9.1', '从所有权模型到异步运行时，配 60 个可运行示例与课后练习答案。', 'https://www.alipan.com/s/5rTnB5kQmZ0hLp2nN4dTgvX 提取码：rs02', 'https://github.com/aurora-vault/rust-handbook', 'https://images.unsplash.com/photo-1515879218367-84db206ddbb6?w=1200', '2025', '1.2 GB', 'PDF+EPUB', 'K. Asahi'],
  ['霓虹夜行｜赛博城市参考图集', '素材', '参考图,赛博,摄影', '7.8', '东京 / 重庆 / 曼谷三地夜间街景摄影 1420 张，含镜头参数与拍摄点位，概念设计参考。', 'https://pan.xunlei.com/s/VNetNeonCityPack1', 'https://unsplash.com/t/urban', 'https://images.unsplash.com/photo-1493514789931-5864bc228af3?w=1200', '2024', '9.8 GB', 'JPG', 'Studio Halide'],
  ['旧世界交响：管弦采样库', '音乐', '采样,管弦, Kontakt', '8.7', '录制于布拉格鲁道夫芬厅，82 件乐器、1.2 万个采样，支持 Kontakt 7 与脚本引擎。', 'magnet:?xt=urn:btih:2b7f4e0a9c6d3e1f5a8b0c2d4e6f8a0b1c3d5e7f&dn=OldWorld.Symphony.Kontakt', 'https://www.spitfireaudio.com/', 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?w=1200', '2022', '64.5 GB', 'NKI', 'Prague Sessions'],
  ['像素地牢生成器 v3', '应用', '开源,程序化,游戏工具', '8.4', '一键生成可玩的 Roguelike 地牢，含编辑器、导出 JSON 与 Unity/Godot 插件。', 'https://github.com/aurora-vault/pixel-dungeon-gen/releases/download/v3.2.0/pdgen-3.2.0-win.zip', 'https://godotengine.org/asset-library', 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200', '2025', '148 MB', 'ZIP', 'Pixel Smith'],
  ['亚洲纪录片：茶马古道全 6 集', '影视', '纪录片,历史,国语', '9.0', '沿滇藏线实地拍摄，走访 40 余个马帮后人家庭，含完整解说词文稿。', 'https://pan.baidu.com/s/1TeaHorseRoadDoc?pwd=tea6', 'https://www.douban.com/location/drama/26798222/', 'https://images.unsplash.com/photo-1519681393784-d1ba614f2f43?w=1200', '2021', '18.2 GB', 'MP4', '央视纪录'],
  ['三维扫描文物数据集（第一批）', '其他', '文物,3D,扫描,科研', '8.6', '包含 216 件青铜器与瓷器的毫米级扫描模型，附法线与贴图，可用于教学与复原研究。', 'https://drive.uc.cn/s/7c4f2a1b9e8d6c5a 提取码：muse', 'https://www.smithsonian.gov/3d/', 'https://images.unsplash.com/photo-1554907984-15263bfd5574?w=1200', '2024', '33.6 GB', 'OBJ+GLB', 'Heritage Lab'],
  ['手写字体：山间集', '素材', '字体,手写,中文', '7.5', '覆盖 6763 个常用汉字，含简繁两套与连笔替换字集，商用授权已获作者确认。', 'https://lanzou.com/s/3a9k2l', 'https://www.zcool.com.cn/', '', '2023', '42 MB', 'TTF+OTF', '字绘工作室'],
  ['世界建筑图鉴（全 4 册）', '图书', '建筑,图鉴,扫描', '8.8', '从罗马巴西利卡到当代木构，2400 页高清扫描，含书签与索引重建。', 'https://115.com/s/1ArchAtlas4Vol', 'https://openlibrary.org/search.json?q=architecture%20atlas', 'https://images.unsplash.com/photo-1487958449943-2429e8be8625?w=1200', '2020', '4.6 GB', 'PDF', 'Phaidon'],
  ['未命名草稿：某个群里的资源', '其他', '', '', '只有链接，其余信息待补全（用于演示"信息不全 → 补全 → 勾选导入"）', 'https://pan.quark.cn/s/0d9c8b7a6f5e4d3c', '', '', '', '', '', ''],
];

function xmlEsc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}
function sheetXml(rows) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach((row, ri) => {
    out.push('<row r="' + (ri + 1) + '">');
    row.forEach((cell, ci) => {
      const v = String(cell == null ? '' : cell);
      if (!v) return;
      const ref = colName(ci) + (ri + 1);
      out.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>');
    });
    out.push('</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

const FILES = {
  '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '</Types>',
  '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>',
  'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="资源清单" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '</Relationships>',
  'xl/worksheets/sheet1.xml': sheetXml(ROWS),
};

/** 极简 ZIP（store + deflate 自动选择） */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c | 0;
    }
  }
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
  return ~c >>> 0;
}
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const [name, str] of Object.entries(entries)) {
    const data = Buffer.from(str, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length - 12;
    const payload = useDeflate ? deflated : data;
    const crc = crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centrals.length / 2 | 0, 8);
  eocd.writeUInt16LE(centrals.length / 2 | 0, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

mkdirSync(OUT, { recursive: true });
const buf = zip(FILES);
const file = path.join(OUT, 'demo-resources.xlsx');
writeFileSync(file, buf);
console.log('已生成 ' + file + '（' + (buf.length / 1024).toFixed(1) + ' KB，' + (ROWS.length - 1) + ' 条数据）');

const csvHeader = ROWS[0].join(',');
const csvBody = ROWS.slice(1).map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
writeFileSync(path.join(OUT, 'demo-resources.csv'), '\ufeff' + csvHeader + '\n' + csvBody, 'utf8');
console.log('已生成 ' + path.join(OUT, 'demo-resources.csv'));

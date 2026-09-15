// XLSX / CSV 解析：零依赖 ZIP + SpreadsheetML 解析器（Node zlib 解压）
import { inflateRawSync, gunzipSync, unzipSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** 读取 ZIP（xlsx 本质是 zip）→ Map<name, Buffer> */
export function readZip(buf) {
  if (buf.length < 22) throw new Error('文件过小，不是有效的 XLSX/ZIP');
  let eocd = -1;
  const start = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('未找到 ZIP 结束标记：文件可能不是 .xlsx（可另存为 .xlsx 或改用 .csv）');
  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CD) break;
    const method = buf.readUInt16LE(p + 10);
    let compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== SIG_LOCAL) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (!compSize) {
      // 流式写入（data descriptor）时中央目录大小为 0：向后扫描下一个头
      let q = dataStart;
      while (q + 4 <= buf.length && buf.readUInt32LE(q) !== SIG_LOCAL && buf.readUInt32LE(q) !== SIG_CD) q++;
      compSize = q - dataStart;
    }
    const raw = buf.slice(dataStart, dataStart + compSize);
    if (name.endsWith('/')) continue;
    try {
      files.set(name, method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null);
    } catch (err) {
      files.set(name, null);
    }
  }
  return files;
}

const XML_ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export function unesc(s = '') {
  return String(s).replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, (m) => {
    if (XML_ENT[m]) return XML_ENT[m];
    const code = m[3] === 'x' ? parseInt(m.slice(4, -1), 16) : parseInt(m.slice(3, -1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}
const attrOf = (tag, name) => {
  const m = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : '';
};

function sharedStrings(xml = '') {
  const out = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const body = m[1];
    let text = '';
    const tre = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let t;
    while ((t = tre.exec(body))) text += unesc(t[1] ?? '');
    out.push(text);
  }
  return out;
}

/** styles.xml：找出日期样式的 xf 索引（用于把 Excel 序列号还原为日期） */
function dateStyleIndexes(xml = '') {
  const fmts = new Map();
  for (const m of String(xml).matchAll(/<numFmt\s+numFmtId="(\d+)"\s+formatCode="([^"]*)"/g)) {
    fmts.set(Number(m[1]), unesc(m[2]));
  }
  const builtInDate = new Set([14,15,16,17,18,19,20,21,22,27,30,36,45,46,47,50,57,58]);
  const isDateFmt = (id, code) => builtInDate.has(id) || (!!code && /[yYdD]/.test(code) && !/[hmssAM]/i.test(code.replace(/\[[^\]]*\]/g, '')));
  const idx = new Set();
  const cx = /<cellXfs(?:\s[^>]*)?>([\s\S]*?)<\/cellXfs>/.exec(String(xml));
  if (cx) {
    let i = 0;
    for (const m of cx[1].matchAll(/<xf\b[^>]*>/g)) {
      const id = Number(attrOf(m[0], 'numFmtId') || 0);
      if (isDateFmt(id, fmts.get(id))) idx.add(i);
      i++;
    }
  }
  return idx;
}

const EPOCH = Date.UTC(1899, 11, 30);
function serialToDate(n) {
  const ms = EPOCH + Math.round(n * 86400000);
  const d = new Date(ms);
  const date = d.toISOString().slice(0, 10);
  const frac = n - Math.floor(n);
  return frac > 1e-6 ? date + ' ' + d.toISOString().slice(11, 16) : date;
}

function colIndex(ref = '') {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase());
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 解析单个工作表 XML → string[][]（稀疏列补齐、公式取缓存值） */
function parseSheet(xml = '', { strings = [], dateStyles = new Set() } = {}) {
  const rows = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const head = rm[1] || '';
    const body = rm[2] || '';
    const rowNum = Number(attrOf(head, 'r') || rows.length + 1);
    const cells = [];
    let expected = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(body))) {
      const tag = cm[1] || '';
      const inner = cm[2] || '';
      let col = colIndex(attrOf(tag, 'r'));
      if (col < 0) col = expected;
      expected = col + 1;
      const type = attrOf(tag, 't');
      const style = Number(attrOf(tag, 's') || 0);
      let value = '';
      if (type === 'inlineStr' || type === 'is') {
        const t = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inner);
        value = t ? unesc(t[1]) : '';
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
        const f = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(inner);
        if (v) {
          const raw = v[1];
          if (type === 's') value = strings[Number(raw)] ?? '';
          else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'e') value = '';
          else if (type === 'str') value = unesc(raw);
          else {
            const n = Number(raw);
            value = Number.isFinite(n) && dateStyles.has(style) && n > 0 && n < 2958466 ? serialToDate(n) : raw;
          }
        } else if (f) value = '';
      }
      while (cells.length < col) cells.push('');
      cells[col] = String(value).replace(/\r/g, '').trim();
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (rowNum >= 1) {
      while (rows.length < rowNum - 1) rows.push([]);
      rows[rowNum - 1] = cells;
    }
  }
  return rows;
}

/** 解析 .xlsx → { sheets:[{name, rows}], rows, headers } */
export function parseXlsx(buf) {
  const zip = readZip(buf);
  const get = (n) => {
    const b = zip.get(n);
    return b ? b.toString('utf8') : '';
  };
  const wbXml = get('xl/workbook.xml') || get('xl//workbook.xml');
  if (!wbXml) throw new Error('xl/workbook.xml 缺失：不是标准 Excel 工作簿');
  const relXml = get('xl/_rels/workbook.xml.rels');
  const rels = new Map();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g)) {
    rels.set(m[1], m[2].replace(/^\.\.\//, '').replace(/^\//, ''));
  }
  const strings = sharedStrings(get('xl/sharedStrings.xml'));
  const dateStyles = dateStyleIndexes(get('xl/styles.xml'));
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const head = m[1];
    const name = unesc(attrOf(head, 'name')) || ('Sheet' + (sheets.length + 1));
    const rid = attrOf(head, 'r:id') || attrOf(head, 'id') || attrOf(head, 'r:embed');
    let target = rels.get(rid) || '';
    if (!target) target = 'worksheets/sheet' + (sheets.length + 1) + '.xml';
    if (!target.startsWith('xl/')) target = 'xl/' + target.replace(/^\/+/, '');
    const xml = get(target);
    const rows = xml ? parseSheet(xml, { strings, dateStyles }) : [];
    sheets.push({ name, rows: rows.filter((r) => r && r.length) });
  }
  if (!sheets.length) throw new Error('未找到任何工作表');
  const sheet = sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a), sheets[0]);
  return { kind: 'xlsx', sheets: sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })), activeSheet: sheet.name, rows: sheet.rows };
}

/** 多编码解码：UTF-8 BOM → UTF-8 → GB18030 回退（Excel 导出的 CSV 常见） */
export function decodeText(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.slice(3).toString('utf8'), encoding: 'utf-8-bom' };
  const utf = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  const bad = (utf.match(/\uFFFD/g) || []).length;
  if (bad > Math.max(2, utf.length * 0.002)) {
    try {
      const g = new TextDecoder('gb18030').decode(buf);
      if (g && (g.match(/\uFFFD/g) || []).length <= bad) return { text: g, encoding: 'gb18030' };
    } catch {}
  }
  return { text: utf, encoding: 'utf-8' };
}

export function parseDelimited(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim());
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows.map((r) => (r.length > 1 || r[0] !== '' ? r : null)).filter(Boolean);
}

/** 解析 .csv / .tsv / .txt（制表符） */
export function parseCsv(buf) {
  const { text, encoding } = decodeText(buf);
  const head = text.slice(0, 4096);
  const counts = { ',': (head.match(/,/g) || []).length, '\t': (head.match(/\t/g) || []).length, ';': (head.match(/;/g) || []).length };
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
  const rows = parseDelimited(text, delim).map((r) => r.map((c) => String(c).replace(/^"|"$/g, '').trim()));
  return { kind: 'csv', encoding, delimiter: delim === '\t' ? 'tab' : delim, sheets: [{ name: 'CSV', rowCount: rows.length }], activeSheet: 'CSV', rows };
}

/** 通用：把 rows 规范成 { headers, records } ，自动识别表头行 */
export function toTable(rows = []) {
  const grid = rows.map((r) => (Array.isArray(r) ? r : []));
  const maxCol = grid.reduce((n, r) => Math.max(n, r.length), 0);
  let headerIdx = 0;
  const scoreRow = (r) => {
    const filled = r.filter((c) => String(c ?? '').trim() !== '').length;
    const texty = r.filter((c) => /[\u4e00-\u9fa5A-Za-z]/.test(String(c ?? '')) && !/^(https?:|magnet:|ed2k:|\d{13,})/i.test(String(c ?? ''))).length;
    return filled + texty * 0.5;
  };
  let best = -1;
  for (let i = 0; i < Math.min(grid.length, 8); i++) {
    const s = scoreRow(grid[i] || []);
    if (s > best) { best = s; headerIdx = i; }
  }
  const rawHeader = grid[headerIdx] || [];
  const headers = [];
  for (let c = 0; c < maxCol; c++) {
    const h = String(rawHeader[c] ?? '').replace(/\s+/g, ' ').trim();
    headers.push(h || '列' + (c + 1));
  }
  const records = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const cells = {};
    let used = false;
    headers.forEach((h, c) => {
      const v = String(r[c] ?? '').trim();
      cells[h] = v;
      if (v) used = true;
    });
    if (used) records.push({ __line: i + 1, cells });
  }
  return { headers, records, headerLine: headerIdx + 1, totalRows: grid.length };
}

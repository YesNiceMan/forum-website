// 链接识别 / 网盘与磁力分类 / Excel 表头字段映射
import { uniq } from './util.mjs';

export const PROVIDERS = [
  { key: 'baidu',    name: '百度网盘',   kind: 'netdisk', color: '#4f7cff', re: /pan\.baidu\.com|yun\.baidu\.com/i, codeParam: 'pwd' },
  { key: 'alipan',   name: '阿里云盘',   kind: 'netdisk', color: '#ff6a00', re: /alipan\.com|aliyundrive\.com/i, codeParam: '提取码' },
  { key: 'quark',    name: '夸克网盘',   kind: 'netdisk', color: '#3d7bff', re: /pan\.quark\.cn/i, codeParam: 'pwd' },
  { key: 'lanzou',   name: '蓝奏云',     kind: 'netdisk', color: '#22a7f0', re: /lanzou[a-z]*\.|lanzn\.com|lanzoux\.com/i, codeParam: '' },
  { key: '115',      name: '115网盘',    kind: 'netdisk', color: '#00a870', re: /115\.com|115cdn\.com/i, codeParam: '' },
  { key: 'tianyi',   name: '天翼云盘',   kind: 'netdisk', color: '#e6484d', re: /cloud\.189\.cn|189cn\.cn/i, codeParam: 'pwdcode' },
  { key: 'yidong',   name: '移动云盘',   kind: 'netdisk', color: '#12b76a', re: /yun\.139\.com/i, codeParam: 'code' },
  { key: 'uc',       name: 'UC网盘',     kind: 'netdisk', color: '#f97316', re: /drive\.uc\.cn/i, codeParam: 'pwd' },
  { key: '123',      name: '123云盘',    kind: 'netdisk', color: '#2563eb', re: /123pan\.com|123684\.com|123link\.tv/i, codeParam: 'pwd' },
  { key: 'pikpak',   name: 'PikPak',     kind: 'netdisk', color: '#7c5cff', re: /mypikpak\.com/i, codeParam: 'pass_code' },
  { key: 'onedrive', name: 'OneDrive',   kind: 'netdisk', color: '#0364b1', re: /1drv\.ms|onedrive(-cn)?\.(live|microsoft)\.com/i, codeParam: '' },
  { key: 'gdrive',   name: 'Google Drive', kind: 'netdisk', color: '#29b65b', re: /drive\.google\.com|drive\.usercontent\.com/i, codeParam: '' },
  { key: 'dropbox',  name: 'Dropbox',    kind: 'netdisk', color: '#0061fe', re: /dropbox\.com|dbxusercontent\.com/i, codeParam: '' },
  { key: 'mega',     name: 'MEGA',       kind: 'netdisk', color: '#e0d04a', re: /mega\.nz|mega\.co\.nz/i, codeParam: '' },
  { key: 'wensu',    name: '文叔叔',     kind: 'netdisk', color: '#ff8a3d', re: /wenshuyun|video.4006668899/i, codeParam: '' },
  { key: 'magnet',   name: '磁力链接',   kind: 'magnet',  color: '#f43f5e', re: /^magnet:\?/i, codeParam: '' },
  { key: 'ed2k',     name: 'eD2k 链接',  kind: 'ed2k',    color: '#fb7185', re: /^ed2k:\/\//i, codeParam: '' },
  { key: 'thunder',  name: '迅雷',       kind: 'thunder', color: '#22d3ee', re: /^thunder:\/\/|xtuan\.com|thunderurl\.com/i, codeParam: '' },
  { key: 'httpdl',   name: '直链下载',   kind: 'direct',  color: '#94a3b8', re: /^https?:\/\/.+\.(zip|rar|7z|tar|gz|iso|apk|exe|dmg|msi|pdf|epub|mobi|mp4|mkv|avi|mov|torrent)(\?|$)/i, codeParam: '' },
];

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(\?|$)/i;
const IMAGE_HOST = /images\.unsplash\.com|\/(?:img|image|photo|pic)[0-9]*\.|gw\.alicdn|img\.douanio|picsum\.photos|via\.placeholder|lorapic|imgur\.com\/.*\.(png|jpe?g)|cdn\.webp\.express|.(?:cdn\.)?(?:pic|img)\.[a-z]/i;
const VIDEO_HOST = /bilibili\.com|v\.youku\.com|v\.qq\.com|miaozhen|iQIYI|iqiyi\.com|youtube\.com|youtu\.be|dailymotion|vimeo\.com|douyin\.com|xigua\.com/i;
const DOC_HOST = /docs\.google|yuque\.com|feishu\.cn|notion\.so|shimo\.im|kan3\.cloud|weread\.qq/i;
const SITE_HOST = /bilibili|youtube|douban\.com|imdb\.com|mal\.com|steam\.com|epicgames|gitee\.com|github\.com|gitlab|npmjs\.com|pypi\.org|3dmgame|gamersky|nicexgpu|cineviz|a9a9|mteampt|pttime/i;

export function classify(rawUrl = '', hintText = '') {
  const url = String(rawUrl).trim();
  if (!url) return null;
  for (const p of PROVIDERS) if (p.re.test(url)) return providerOut(p, url, hintText);
  if (/^https?:\/\//i.test(url)) {
    if (IMAGE_EXT.test(url) || IMAGE_HOST.test(url)) return { kind: 'image', provider: 'image', providerName: '图片直链', url, color: '#38bdf8' };
    if (VIDEO_HOST.test(url)) return { kind: 'video', provider: 'video', providerName: '视频站点', url, color: '#f472b6' };
    if (DOC_HOST.test(url)) return { kind: 'doc', provider: 'doc', providerName: '文档站点', url, color: '#a78bfa' };
    if (SITE_HOST.test(url)) return { kind: 'site', provider: 'web', providerName: '在线站点', url, color: '#34d399' };
    return { kind: 'web', provider: 'web', providerName: '网页链接', url, color: '#94a3b8' };
  }
  return { kind: 'other', provider: 'other', providerName: '其他', url, color: '#94a3b8' };
}
function providerOut(p, url, hintText) {
  return {
    kind: p.kind, provider: p.key, providerName: p.name, url, color: p.color,
    code: p.codeParam ? extractCode(url, p.codeParam, hintText) : '',
  };
}

export function extractCode(url = '', param = '', hint = '') {
  try {
    if (/^https?:/i.test(url)) {
      const u = new URL(url);
      for (const key of [param, 'pwd', 'password', 'code', '提取码', 'passcode', 'pwdcode'].filter(Boolean)) {
        const v = u.searchParams.get(key);
        if (v && /^[\w-]{2,12}$/.test(v)) return v;
      }
    }
  } catch {}
  const fromUrl = /[#?&=]([\w]{4})(?:[&/?]|$)/.exec(url);
  const textHint = /[提取密码口令code]+[码号]?\s*[:：是为]\s*([\w]{3,8})/i.exec(hint);
  const tail = /\s+([\w]{4})\s*$/.exec(hint);
  return (textHint && textHint[1]) || (tail && tail[1]) || (fromUrl && fromUrl[1]) || '';
}

/** 从任意文本中抽取全部链接（含磁力 / ed2k / 迅雷） */
export function extractUrls(text = '') {
  const s = String(text);
  const out = [];
  const re = /(?:https?:\/\/|magnet:\?(?:xt)?|ed2k:\/\/|thunder:\/\/)[^\s"'<>\u4e00-\u9fa5，。；、）)】》\]，]+/gi;
  for (const m of s.matchAll(re)) out.push(m[0].replace(/[,.;:，。；、)）]】》]+$/, ''));
  // 中文文本里常见 “链接：https://xxx 提取码：abcd”
  return uniq(out);
}

/** 从文本中抽取图片地址（markdown ![]() / html img / 裸链接） */
export function extractImages(text = '') {
  const s = String(text);
  const urls = [];
  for (const m of s.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) urls.push(m[1]);
  for (const m of s.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.push(m[1]);
  for (const m of s.matchAll(/url\(["']?(https?:\/\/[^)"']+)/gi)) urls.push(m[1]);
  for (const u of extractUrls(s)) if (classify(u)?.kind === 'image') urls.push(u);
  return uniq(urls.map((u) => u.replace(/[)）,，。;；]$/, '')));
}

/** 人类可读大小 → 字节 */
export function parseSize(str = '') {
  const m = /([\d.]+)\s*(TB|GB|MB|KB|T|G|M|K|B)/i.exec(String(str));
  if (!m) return 0;
  const units = { B: 1, K: 1024, KB: 1024, M: 1048576, MB: 1048576, G: 1073741824, GB: 1073741824, T: 1099511627776, TB: 1099511627776 };
  return Math.round(Number(m[1]) * (units[m[2].toUpperCase()] || 1));
}
export function formatSize(bytes = 0) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n >= 100 ? 0 : 1) : Math.round(n)) + ' ' + units[i];
}

/** 表头 → 资源字段自动映射 */
export const FIELD_ALIASES = {
  title:    ['标题','名字','名称','资源名称','资源标题','影片名称','书名','课程名称','软件名称','项目','title','name','资源','作品名','别名','副标题'],
  type:     ['类型','分类','类别','频道','栏目','格式类型','type','category','kind','资源类型'],
  tags:     ['标签','关键词','关键字','题材','地区','标注','tag','tags','label','风格'],
  score:    ['评分','分数','评价','得分','星级',' IMDb','rating','score','豆评分','豆瓣评分'],
  summary:  ['简介','摘要','描述','说明','介绍','内容介绍','概要','summary','description','desc','introduce','备注'],
  content:  ['内容','正文','详情','详细介绍','内容说明','详细说明','富文本','body','content','detail','details'],
  downloads:['资源下载','下载','下载链接','网盘','网盘链接','下载地址','资源链接','链接','link','links','download','downloads','url','磁力','种子','文件链接'],
  others:   ['其他来源','其它来源','其他地址','备用链接','更多来源','镜像','other','others','alternative','alternatives','source','来源'],
  cover:    ['封面','封面图','主图','图片','缩略图','海报','cover','poster','image','img','thumbnail','图片链接'],
  gallery:  ['图集','截图','预览图','插图','图片集','gallery','images','photos','screenshots','preview'],
  year:     ['年份','发行年','上映','时间','发布日期','year','date','released','publish'],
  region:   ['地区','国家','语言','语种','region','language','country'],
  size:     ['大小','体积','容量','文件大小','size','file size'],
  author:   ['作者','制片','导演','开发','制作','出品','主演','作者名','artist','author','director','developer','publisher','uploader','上传者'],
  format:   ['格式','清晰度','版本','画质','分辨率','集数','版本类型','format','quality','version','resolution','episodes'],
  price:    ['价格','收费','是否免费','费用','price','cost'],
  status:   ['状态','更新状态','连载','已完结','status','state'],
  sourceUrl:['来源地址','原始链接','出处','详情页','source url','origin','参考链接','文档链接'],
};
const normalizeKey = (s = '') => String(s).toLowerCase().replace(/[\s_\-()（）:：*·]/g, '').trim();

export function mapHeaders(headers = []) {
  const mapping = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    let best = null;
    let bestScore = 0;
    for (const h of headers) {
      if (used.has(h)) continue;
      const nk = normalizeKey(h);
      if (!nk) continue;
      for (const alias of aliases) {
        const na = normalizeKey(alias);
        if (!na) continue;
        let score = 0;
        if (nk === na) score = 3;
        else if (nk.includes(na) || na.includes(nk)) score = 2;
        if (score > bestScore) { bestScore = score; best = h; }
      }
    }
    if (best && bestScore >= 2) { mapping[field] = best; used.add(best); }
  }
  return mapping;
}

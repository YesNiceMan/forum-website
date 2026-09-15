# 极昼资源库 · AURORA VAULT

一个「用户资源管理网站」的完整实现：Excel 批量导入 + 链接图文自动识别 + 信息补全弹窗 + 聚合搜索 + 后台管理。
零 npm 依赖（只用 Node 内置模块），前端为原生 ES Module + Hash 路由，无需构建步骤，约 8.6k 行自研代码。

---

## 快速开始

```bash
node -v        # 需要 >= 18.17（Node 20/22/24/26 均可，无需 npm install）
npm start      # 启动后访问 http://127.0.0.1:5180
```

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| 前台 | http://127.0.0.1:5180 | 资源库 / 搜索 / 导入 / 投稿 / 收藏 |
| 后台 | http://127.0.0.1:5180/admin | 默认账号 `admin` / 口令 `aurora888` |

- 首次启动会自动播种 9 条演示资源与演示投稿（`data/db.json`）。
- **上线前请务必修改默认口令**：后台 → 站点设置 → 账号 → 修改口令。
- 环境变量：`PORT`（默认 5180）、`HOST`（默认 127.0.0.1）、`AURORA_ADMIN_PASS`（覆盖初始口令）。
- 数据落在 `data/db.json`，上传与镜像图片落在 `web/uploads/`（`web/uploads/seed/` 为内置演示海报）。

```bash
npm run reset    # 清空数据与上传文件并重新播种（请先停止服务）
npm run sample   # 重新生成 samples/demo-resources.xlsx / .csv
npm run posters  # 重新生成演示海报 SVG
```

---

## 五项需求 → 实现对照

| # | 需求 | 落地位置 | 关键点 |
| --- | --- | --- | --- |
| 1 | 上传 Excel 导入，并通过文档中的链接识别图片和文字 | 前台 `#/import`、后台「导入」 | 手写 XLSX 解析（ZIP 中央目录 + inflateRaw + sharedStrings + 样式/日期判定），另支持 CSV/TSV 并自动识别 UTF-8 / GB18030；表头模糊映射到 18 个字段；服务端抓取链接页面：`title/meta/og` → 标题与简介，正文 → 富文本内容，页面图片 → 封面/图集，并把外链图片镜像到本地 |
| 2 | 信息不全可补全，补全信息在弹窗中可全部导入或勾选导入 | 导入向导第 3、4 步 + 预览弹窗 | 按 8 个字段加权计算「完善度百分比」（标题16 类型10 标签10 分数8 简介14 内容/图片18 下载16 其他来源8 = 100），未达 100% 的行标黄；支持整批自动补全、单条重抓、手动编辑；预览弹窗提供 **全部导入 / 导入勾选项 / 全选 / 反选 / 仅看未完善** |
| 3 | 资源页包含标题、类型、标签、分数、简介、内容/图片、资源下载、其他来源 | 详情页 `#/resource/:id` | Hero 区展示标题 + 类型 + 标签 + 分数环 + 简介；下方四个标签页：内容/图文、图集（灯箱）、资源下载（按网盘/磁力/直链分组，含提取码与复制）、其他来源；侧栏「资源信息」列出年份/地区/格式/体积等元数据 |
| 4 | 通过标题/名字搜索到其他资源（网盘、网站、磁力等） | 聚合搜索 `#/search?q=…` | 本地库 + 15 个内置来源并发检索，来源模式共 5 种：`local`（本站库）、`api`（JSON 接口）、`xml`（RSS/Atom）、`html`（抓取页面链接）、`url`（跳转兜底）；结果按 provider 分类打标签（百度网盘、阿里云盘、夸克、蓝奏、115、天翼、移动、UC、123、PikPak、OneDrive、Drive、Dropbox、MEGA、磁力、ed2k、迅雷、直链、网站）；自动提取 `提取码/口令/code`；可后台增删与在线测试 |
| 5 | 后台能够进行信息管理 | `/admin`（12 个视图） | 见下节 |

---

## 前台页面

| 路由 | 页面 | 能力 |
| --- | --- | --- |
| `#/` | 首页 | Aurora 光斑背景、跑马灯标签、数据计数动画、精选橱窗、最新资源瀑布流 |
| `#/library` | 资源库 | 类型/标签/排序/状态筛选、卡片与列表双视图、分页、骨架屏 |
| `#/resource/:id` | 资源详情 | 需求 3 的全部字段 + 收藏、复制下载链接、关联推荐、浏览计数 |
| `#/search?q=` | 聚合搜索 | 本地 + 外部来源并发、来源开关、结果分类、跳外部兜底、无结果时的搜索建议 |
| `#/import` | 导入向导 | 拖拽/点击上传、粘贴文本直读、字段映射、批量补全、预览弹窗勾选导入（需管理员口令确认） |
| `#/submit` | 我要投稿 | 粘贴一段文字即可自动识别标题/链接/图片/标签，提交后进入后台审核 |
| `#/favs` | 收藏 | 本地收藏（localStorage `aurora.vault.v1`）|

交互与动效：圆形揭示的主题切换（View Transitions）、按钮波纹、卡片视差倾斜、滚动渐显、数字滚动、图片灯箱、⌘K / Ctrl+K 全局命令面板、顶栏滚动进度条；并完整遵循 `prefers-reduced-motion`。

---

## 后台 `/admin`

| 视图 | 能力 |
| --- | --- |
| 总览 `#/dash` | 12 项统计、14 天新增/浏览趋势图、标签与类型分布条、最新资源、待处理时间线、操作日志、一键自检 |
| 资源 `#/resources` | 关键字/状态/类型/缺失字段筛选、排序、分页、批量发布/草稿/加精/取消加精/归档/删除、行内 ★ 加精、✎ 编辑、◉ 上下架、⌕ 链接自检、× 删除、完善度进度条 |
| 编辑器 `#/new`、`#/edit/:id` | 全字段表单（标签、下载链接与提取码、图集、其他来源、状态/加精/置顶）、**自动补全**按钮（抓取链接回填）、链接可用性检测 |
| 回收站 `#/archive` | 归档资源恢复 / 彻底删除 |
| 投稿 `#/submissions` | pending/approved/rejected 分段、查看与编辑、补全、通过入库或驳回（可附说明） |
| 导入 `#/import` | 与前台同一套向导，提交后无需口令（已是管理员会话） |
| 分类与标签 `#/taxonomy` | 类型卡片增删；标签改名、固定、换色、批量合并、删除 |
| 检索来源 `#/sources` | 增删改查来源、字段映射 JSON、`listPath`、跳转模板、在线测试按钮 |
| 媒体库 `#/media` | 上传（多图/拖拽）、网格预览、复制链接、删除、未引用统计 |
| 日志 `#/logs` | 操作日志流（登录、导入、批量操作、抓取失败等）按类型筛选 |
| 设置 `#/settings` | 站点名/副标题/标语、开放投稿、需审核、允许用户导入、搜索兜底、主题色、默认口令提示、**修改口令**、危险区（重建计数 / 链接自检 / 清空镜像 / 恢复演示数据） |
| 备份 `#/backup` | 一键导出 JSON、上传恢复（合并 / 替换） |

---

## Excel / CSV 表格怎么准备

推荐表头（顺序任意，支持中英文别名，多余列会被忽略但可在映射步骤手动指认）：

```text
标题 | 类型 | 标签 | 评分 | 简介 | 内容 | 资源下载 | 其他来源 | 封面 | 图集 | 年份 | 地区 | 大小 | 作者 | 格式 | 价格 | 状态 | 来源地址
```

- 每个字段都接受常见别名，例如 `资源名称/作品名/name` → 标题，`网盘/下载链接/download` → 资源下载，`海报/thumbnail` → 封面。
- 「资源下载 / 其他来源 / 图集」单元格可放多条，用换行、空格或逗号分隔；识别 `magnet:`、`ed2k://`、`thunder://`、各类网盘与直链。
- 提取码可直接写在链接后面：`https://pan.baidu.com/s/1xxx 提取码：a1b2`。
- 只给链接也能导：抓取阶段会回填标题、简介、封面、图集与正文。
- 现成样例：`samples/demo-resources.xlsx`（工作表「资源清单」，12 列 × 11 行，含网盘、磁力、IMDb 等外链）；`npm run sample` 可重新生成。

---

## 检索来源配置格式

后台「检索来源」保存的对象结构（也内置于 `server/lib/sources.mjs`）：

```jsonc
{
  "key": "mydisk",
  "name": "我的资源站",
  "mode": "api",              // local | api | xml | html | url
  "url": "https://ex.com/s?wd={query}",
  "listPath": "data.list",    // api 模式下结果数组所在位置
  "map": { "title": "name", "url": "link", "cover": "pic" },
  "jumps": [ { "name": "谷歌", "url": "https://www.google.com/search?q={query}" } ]
}
```

- `api`：请求 JSON；`xml`：RSS/Atom；`html`：抓取页面中的 `<a>`（可给 `selector`）；`url`：不请求，只在前台展示跳转按钮。
- 所有 `mode=url` 的来源汇总为搜索页的「去外部看看」兜底入口，避免聚合无结果。

---

## 自检脚本

```bash
npm run check:modules  # 12 个前端模块的 import 图能否解析并链接
npm run check          # 接口冒烟：46 个路由的关键路径（60 条断言，结束后自动清理自检写入的数据）
npm run check:ui       # 无头 Chrome 渲染各前台路由，检查空视图与控制台异常
npm run check:admin    # CDP 登录后台，遍历 12 个视图并校验渲染文本量
npm run check:flow     # 端到端：上传 xlsx → 映射 → 抓取 → 弹窗勾选 → 口令闸门 → 入库 → 搜索/详情/投稿/收藏/⌘K
npm run check:layout   # 前台 7 页 + 后台 12 视图：检测横向溢出、破图、内容裁切、空白块、JS 异常（AUDIT_W=390 AUDIT_H=844 node tools/layout-audit.mjs 可复测窄屏）
npm run check:all      # 依次执行以上全部
```

另有 `node tools/shot.mjs <路由> <文件.png>` 可用无头 Chrome 出图（如 `node tools/shot.mjs "#/library" lib.png`），便于人工复核视觉稿。

注意：`check:flow` 会真实写入一份导入数据（跑完后 `npm run reset` 可回到初始 9 条演示数据）。

`check:ui`/`check:admin`/`check:flow`/`check:layout` 依赖本机 Chrome / Chromium，可用 `CHROME_PATH=/Applications/.../Chrome` 指定路径（默认 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`）。服务需先运行在 `127.0.0.1:5180`。

---

## 安全与限制

- 口令：`sha256(口令 + 每实例随机 salt)`，登录会话为 httpOnly Cookie（`aurora_sid`）并持久化；同一账号 6 次失败锁定 5 分钟；修改口令会使所有会话失效。
- 链接识别 / 补全依赖外网访问：离线或目标站屏蔽抓取时，该行会记录失败并保持原字段（不会阻塞导入，可稍后在后台重抓）。
- 抓取有 SSRF 防护：`safeUrl()` 拒绝回环、私有网段、链路本地与元数据地址，只放行 http/https。
- 图片代理 `GET /api/proxy?url=` 在抓取失败时返回内联占位 SVG（200，`no-store`），前台不会出现破图与 404 噪音。
- 存储为单 JSON 文件（原子写 + 防抖），适合中小规模与本机/内网部署；如需公网多实例或百万级数据，请替换存储层。
- 若要公网部署：置于 HTTPS 反向代理之后、修改默认口令与 `admin` 用户名、并按需关闭「允许用户导入 / 开放投稿」。

---

## 目录结构

```text
server/
  index.mjs              # HTTP 入口、静态资源、公开 API、登录与会话
  seed.mjs               # 演示数据播种
  lib/util.mjs           # 通用工具（HTML 清洗、JSON 响应、并发限制…）
  lib/store.mjs          # JSON 存储、索引、统计、完善度评分、日志
  lib/xlsx.mjs           # 零依赖 XLSX/CSV/TSV 解析
  lib/links.mjs          # 链接分类、网盘/磁力识别、提取码、表头别名映射
  lib/enrich.mjs         # 抓取网页 → 标题/简介/正文/图片、图片镜像
  lib/sources.mjs        # 聚合检索（api/xml/html/url）与内置来源
  lib/importer.mjs       # 导入解析、批量补全、入库
  lib/admin-routes.mjs   # 46 条路由中的管理端部分
web/
  index.html / admin.html
  assets/css/{base,pages,admin}.css
  assets/js/{core,ui,form,app,admin}.js + pages/*.js
  uploads/               # 上传与镜像图片
tools/                   # 样例生成、重置、以及 5 个自检脚本
samples/                 # 演示 xlsx / csv
data/                    # 运行时数据（db.json）
```

前端模块划分：`core.js`（路由/请求/状态/动效原语）、`ui.js`（弹窗、灯箱、Toast）、`form.js`（表单控件与字段编辑器）、`app.js`（外壳、导航、⌘K、主题）、`pages/*.js`（7 个前台页面）、`admin.js`（后台 SPA）。

---

## 许可

代码为本项目自研，可自由用于学习与二次开发。

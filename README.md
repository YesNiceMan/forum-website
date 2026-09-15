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
| 5 | 后台能够进行信息管理 | `/admin`（13 个视图） | 见下节 |

---

## 第四轮：找更多来源与后台补全

| 需求 | 落地位置 | 关键点 |
| --- | --- | --- |
| 1 从「找更多来源」点一下文字 / 图片，直接插进资源的对应位置 | 详情页空位 →「找更多来源」→ 聚合搜索 `#/search?q=…&id=…`（绑定模式） | 每条结果下方拆出一排**片段芯片**（简介 / 正文段落 / 图片 / 标签 / 链接），单击即写入对应位置，芯片翻成「已插入」并锁手；`⌥/Alt + 单击` 或「✚ 选位置插入」打开面板，可逐条勾选、改落点（下拉列出该资源当前为空的格子）、切换「只填空位 / 追加」。站内同名条目之间也能互相搬运（把库里另一条的简介 / 封面 / 标签补给这一条）；外链结果另给「⇣ 抓正文与图片」，服务端抓回该页后再挑段落。写入走 `POST /api/resources/:id/insert`：管理员 / 关闭审核时立即入库并回传资源快照与完整度；开启审核时生成 `kind=patch` 的「内容补充」投稿，后台可逐条勾选后「写入所选」 |
| 2 后台批量补全资源里缺失的空白位置 | 后台 `#/gaps`（导航「✧ 批量补全」） | 左栏按分组（文字 / 图片 / 归类 / 元数据 / 链接）勾选要补的**位置**，每处显示「还空着几条」；中栏圈定范围（状态 / 类型 / 关键词 / 仅勾选的资源 / 每批条数 + 四个开关：允许联网检索、补下载与其他来源、图片转存本地、自动跑完剩余批次）；先「预览能补什么」（不落库）再「开始批量补全」，右栏待补清单按完整度升序给出前 20 条与可抓链接，逐条报告写明写入位置或补不上的原因。引擎在 `server/lib/gaps.mjs`：只往空格里写（正文 / 图集 / 标签 / 链接为追加去重），资源自身的 `sourceUrl` 优先，缺下载链接时可发起一次标题检索；另有行内 `✦` 单条补全与编辑器「自动补全」的预览式回填（不落库，先在表单里预览） |
| 3 刷新页面或切到前台再回后台，不再要求重新登录 | `server/index.mjs` 会话层 + `web/assets/js/admin.js` | 会话改为**自包含签名令牌**（HMAC-SHA256 + 时间戳）写入 httpOnly Cookie：普通登录 12 小时，勾选「记住登录」30 天，使用中自动续期（`touchSession`）；服务端重启、页面刷新、切前台再回后台都不掉线。后台 SPA 由 `/api/bootstrap` 直接带出登录态（不再多跑一次请求），每 4 分钟 + `visibilitychange` / `focus` 心跳确认，401 时先复核再决定是否弹登录框，避免「点了才提示过期」。改密仍可即时踢人：`invalidBefore` 时间戳 + `revoked` 名单，旧令牌当场失效，本设备保持登录 |


---

## 前台页面

| 路由 | 页面 | 能力 |
| --- | --- | --- |
| `#/` | 首页 | Aurora 光斑背景、跑马灯标签、数据计数动画、精选橱窗、最新资源瀑布流 |
| `#/library` | 资源库 | 类型/标签/排序/状态筛选、卡片与列表双视图、分页、骨架屏 |
| `#/resource/:id` | 资源详情 | 需求 3 的全部字段 + 收藏、复制下载链接、关联推荐、浏览计数；下载 / 其他来源 / 简介为空时直接给出「找更多来源」入口（带资源 id 跳到绑定模式的搜索） |
| `#/search?q=` | 聚合搜索 | 本地 + 外部来源并发、来源开关（`&sources=site,github` 可锁定来源）、结果分类、跳外部兜底、无结果时的搜索建议；带 `&id=` 时进入**补源绑定模式**：结果里的文字 / 图片小块点一下即插入该资源对应位置（详见上节） |
| `#/import` | 导入向导 | 拖拽/点击上传、粘贴文本直读、字段映射、批量补全、预览弹窗勾选导入（需管理员口令确认） |
| `#/submit` | 我要投稿 | 粘贴一段文字即可自动识别标题/链接/图片/标签，提交后进入后台审核 |
| `#/favs` | 收藏 | 本地收藏（localStorage `aurora.vault.v1`）|

交互与动效：圆形揭示的主题切换（View Transitions）、按钮波纹、卡片视差倾斜、滚动渐显、数字滚动、图片灯箱、⌘K / Ctrl+K 全局命令面板、顶栏滚动进度条；并完整遵循 `prefers-reduced-motion`。

---

## 后台 `/admin`

| 视图 | 能力 |
| --- | --- |
| 总览 `#/dash` | 12 项统计、14 天新增/浏览趋势图、标签与类型分布条、最新资源、待处理时间线、操作日志、一键自检 |
| 资源 `#/resources` | 关键字/状态/类型/缺失字段筛选、排序、分页、批量发布/草稿/加精/取消加精/归档/删除、行内 ★ 加精、✎ 编辑、◉ 上下架、⌕ 链接自检、✦ 只补这一条的空位、× 删除、完善度进度条；顶部「✧ 批量补全空白」直达补全视图 |
| 批量补全 `#/gaps` | 勾选要补的**位置**（文字 / 图片 / 归类 / 元数据 / 链接，每处显示还空着几条）→ 圈定范围与开关 → 「预览能补什么」（不写库）→「开始批量补全」：分批推进度、待补清单、逐条报告（写入位置 / 跳过原因 / 已镜像），可中断、可自动跑完剩余批次 |
| 编辑器 `#/new`、`#/edit/:id` | 全字段表单（标签、下载链接与提取码、图集、其他来源、状态/加精/置顶）、**自动补全**按钮（抓取链接回填）、链接可用性检测 |
| 回收站 `#/archive` | 归档资源恢复 / 彻底删除 |
| 投稿 `#/submissions` | pending/approved/rejected 分段、查看与编辑、补全、通过入库或驳回（可附说明）；前台「点选插入」产生的**内容补充**投稿会标出目标资源与每一处待写内容，可逐条勾选后「写入所选」 |
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

```bash
npm run check:modules  # 13 个前端模块的 import 图能否解析并链接
npm run check          # 接口冒烟：全部路由的关键路径（92 条断言，含会话 / 点选插入 / 批量补全，结束后自动清理自检写入的数据）
npm run check:ui       # 无头 Chrome 渲染各前台路由，检查空视图与控制台异常
npm run check:admin    # CDP 登录后台，遍历 13 个视图并校验渲染文本量
npm run check:flow     # 端到端：上传 xlsx → 映射 → 抓取 → 弹窗勾选 → 口令闸门 → 入库 → 搜索/详情/投稿/收藏/⌘K
npm run check:layout   # 前台 8 页（含补源绑定模式）+ 后台 13 视图：检测横向溢出、破图、内容裁切、空白块、JS 异常（AUDIT_W=390 AUDIT_H=844 node tools/layout-audit.mjs 可复测窄屏）
npm run check:opt      # 需求四专项：片段芯片点选插入、内容补充投稿写入、会话不掉线、后台批量补全跑批
npm run check:all      # 依次执行以上全部
```

浏览器类脚本默认打 `127.0.0.1:5180`，用 `BASE=http://127.0.0.1:5211` 可指向别的实例。想拿真数据做验证又不动库，用一份隔离环境跑：

```bash
mkdir -p /tmp/aurora-check/data /tmp/aurora-check/uploads
cp data/db.json /tmp/aurora-check/data/ && cp -r web/uploads/. /tmp/aurora-check/uploads/
AURORA_DATA_DIR=/tmp/aurora-check/data AURORA_UPLOADS_DIR=/tmp/aurora-check/uploads PORT=5211 node server/index.mjs &
BASE=http://127.0.0.1:5211 npm run check:all
```

另有 `node tools/shot.mjs <路由> <文件.png>` 可用无头 Chrome 出图（如 `node tools/shot.mjs "#/library" lib.png`），便于人工复核视觉稿。

注意：`check:flow` 会真实写入一份导入数据（跑完后 `npm run reset` 可回到初始 9 条演示数据）。

`check:ui`/`check:admin`/`check:flow`/`check:layout`/`check:opt` 依赖本机 Chrome / Chromium，可用 `CHROME_PATH=/Applications/.../Chrome` 指定路径（默认 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`）；`check:opt` 用 `CDP_PORT`（默认 9411）指定调试端口，端口被残留浏览器占用时会直接报错退出，避免连到旧浏览器拿到假结果。
## 部署

### 单机 / 内网（功能完整，推荐）

```bash
AURORA_ADMIN_PASS='强口令' PORT=8080 HOST=0.0.0.0 node server/index.mjs
```

数据在 `data/db.json`，上传与镜像图在 `web/uploads/`，配合 pm2 / systemd / 反代长期运行。导入、编辑、投稿、上传、计数在这条路径上都能真正落盘。

### Vercel（Serverless）

仓库自带 `api/index.mjs` + `vercel.json`：静态资源由 Vercel CDN 直出（`outputDirectory: web`），`/api/*`、`/uploads/*` 与页面兜底改写到一个 Node.js 函数；该函数复用 `server/index.mjs` 导出的 `handle(req, res)`，不需要 `listen`（同一模块靠 `DIRECT_RUN` 判断：`node server/index.mjs` 时才监听端口）。

1. 导入 GitHub 仓库后，把 **Framework Preset 由 `Node.js` 改成 `Other`**。选 Node.js 时 Vercel 只会在 `app.js` / `src/index.mjs` 这批候选名里找入口，本项目入口是 `server/index.mjs`，这就是 `No entrypoint found in "/vercel/path0"` 的来源。
2. Environment Variables 加 `AURORA_ADMIN_PASS`；不设则后台仍是默认口令 `admin / aurora888`。
3. Deploy。前台浏览、搜索、详情、聚合检索、Excel 解析预览、后台登录都可用。

**云端限制**：Vercel 函数根文件系统只读，只有 `/tmp` 可写且随冷启动清空。所以 `DATA` / `UPLOADS` 会自动指向 `/tmp/aurora-data`、`/tmp/aurora-uploads`（可用 `AURORA_DATA_DIR`、`AURORA_UPLOADS_DIR` 覆盖），写入只在当前实例存活期间生效，不跨实例、不跨冷启动——后台的编辑 / 入库 / 投稿 / 上传在 Vercel 上属于"可演示、不可依赖"。

- 想让云端显示本地真实数据：`git add -f data/db.json` 一并提交，冷启动会自动复制进 `/tmp`（见 `primeFromSnapshot()`）。注意 `db.json` 含投稿、操作日志与后台口令哈希，公开仓库请三思。
- 需要真正的持久化：换带磁盘的平台（Fly.io / Railway / Render / 自建 VPS，代码零改动），或把存储层换成 Vercel Blob + Postgres/KV。

---

- 口令：`sha256(口令 + 每实例随机 salt)`；登录会话是**自包含签名令牌**（HMAC-SHA256，密钥派生自库内 `admin.secret`）写入 httpOnly + SameSite=Lax Cookie `aurora_sid`，12 小时或（勾选记住登录）30 天，使用中自动滑动续期；服务端重启不会让已登录设备掉线。
- 会话可即时作废：改密写 `invalidBefore` 时间戳 + 把当前 `sid` 放进 `revoked` 名单（本设备保留），登出只撤销这一个 `sid`；签名被篡改、过期、被撤销一律 401。登录接口 5 次失败锁定 5 分钟。
- 前台「点选插入」(`POST /api/resources/:id/insert`)：字段限定在 14 个白名单位置，服务端只往**空格子**写（正文 / 图集 / 标签 / 链接为追加去重，已有内容不会被覆盖），外链图片先镜像再入库；未登录访客受「开放投稿 / 需审核」约束（默认只生成待审投稿，由管理员逐条决定写不写），并限流 24 次/分钟；草稿资源不接受访客写入。
- 链接识别 / 补全依赖外网访问：离线或目标站屏蔽抓取时，该行会记录失败并保持原字段（不会阻塞导入，可稍后在后台重抓；批量补全同理，抓不到就写进逐条报告）。
- 抓取有 SSRF 防护：`safeUrl()` 拒绝回环、私有网段、链路本地与元数据地址，只放行 http/https；批量补全与插入路径共用同一套校验。
- 图片代理 `GET /api/proxy?url=` 在抓取失败时返回内联占位 SVG（200，`no-store`），前台不会出现破图与 404 噪音。
- 存储为单 JSON 文件（原子写 + 防抖），适合中小规模与本机/内网部署；如需公网多实例或百万级数据，请替换存储层。注意：**别让两个服务进程共用同一个数据目录**，各自内存里的副本会互相覆盖。
- 若要公网部署：置于 HTTPS 反向代理之后（Cookie 的 `Secure` 位会随 `X-Forwarded-Proto` 自动打开）、修改默认口令与 `admin` 用户名、并按需关闭「允许用户导入 / 开放投稿」。
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
  lib/gaps.mjs           # 空白位置引擎：位置分组、空位统计、单条/批量「只填空位」补全
  lib/admin-routes.mjs   # 53 条路由中的管理端部分（35 条，含空白统计与批量补全）
web/
  index.html / admin.html
  assets/css/{base,pages,admin}.css
  assets/js/{core,ui,form,app,admin}.js + pages/*.js
  uploads/               # 上传与镜像图片
api/index.mjs            # Vercel / Serverless 入口（复用 server/index.mjs 的 handle）
vercel.json              # Vercel 构建配置：web/ 静态直出 + 动态请求改写
tools/                   # 样例生成、重置、以及 6 个自检脚本
samples/                 # 演示 xlsx / csv
data/                    # 运行时数据（db.json）
```

前端模块划分：`core.js`（路由/请求/状态/动效原语）、`ui.js`（弹窗、灯箱、Toast）、`form.js`（表单控件与字段编辑器）、`app.js`（外壳、导航、⌘K、主题）、`pages/insert.js`（「找更多来源」点选插入：片段拆分、落点推断、插入面板与本地记录，搜索页与详情页共用）、`pages/*.js`（7 个前台页面）、`admin.js`（后台 SPA）。

---

## 许可

代码为本项目自研，可自由用于学习与二次开发。

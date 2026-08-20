# Binge（汉化版）

> 基于 [ordureconnoisseur/binge](https://github.com/ordureconnoisseur/binge) v0.4.0 的中文汉化 + 功能修复分支。当前版本 **v0.6.2**。

为 [Stash](https://github.com/stashapp/stash) 提供的 Instagram 风格社交与发现层：竖屏 Reel、Stories、演员档案、StashDB 驱动的发现功能——全部基于 Stash 既有的 GraphQL API。Web 插件形态。

<p align="center"><img src="screenshots/hero.png" alt="binge — reels, stories, and discovery for your Stash library" width="840" /></p>

---

## 功能特性

- **竖屏 Reel** — 滑动浏览场景，双击点赞，操作栈（评分、多视图、Scribe、保存、⋯）。
- **首页 Stories + Feed** — IG 风格的演员 Stories 行（库内 + StashDB + 可选 Reddit）位于分页场景流上方。批量导入折叠为单个 Pack 卡片。
- **演员档案** — 简介、统计、场景网格、图库网格、社交链接条（Twitter / Instagram / TikTok / Reddit / OnlyFans / Fansly 品牌图标）。库内 + StashDB-only 变体共享布局。
- **StashDB 发现** — 首页的 DISCOVER + TRENDING 卡片；关注演员 + 添加你尚未拥有的场景。
- **移动优先** — 底部导航、悬停卡片迷你档案、演员 `@mention` 链接。触屏 + 桌面端一致体验。

---

## 汉化版变更说明

### UI 汉化

- **全部用户可见 UI 字符串翻译为中文**（导航、按钮、状态、设置、演员信息、场景信息、错误提示等）
- **日期格式**：`YYYY年M月D日`（如 `2024年2月28日`）
- **相对时间**：`刚刚` / `X分钟前` / `X小时前` / `X天前` / `X周` / `X个月` / `X年`
- **排序选项**：`最近` / `最多播放` / `最多高潮` / `最高评分` / `最近添加` 等
- **评分维度**：`总体` / `默契度` / `美感` / `制作质量` / `创意` / `外形` / `表现` 等
- 品牌名保持英文：Stash、StashDB、Reddit、X (Twitter)、PornHub、Cookie、forage、binge-server、HLS、MP4、WebM

### i18n 多语言架构（v0.4.17 新增）

v0.4.17 将原硬编码中文迁移为基于 `react-i18next` 的动态多语言架构：

- **中英双语**：内置中文（`zh`）和英文（`en`）两套翻译资源，默认中文，可在设置页切换语言，无需刷新
- **242 个翻译键**：按功能域分组，支持 `{{interpolation}}` 插值
- **语言偏好持久化**：`localStorage` key `binge.language`
- 详见 [汉化及修复.md](./汉化及修复.md)

### 功能修复

#### v0.6.2

- **演员详情页 PornHub 瓦片黑屏修复**：hover 预览（mediabook）在多数商业片源上不存在，preview 代理返回 404 时原实现留下黑色矩形盖住封面；现在加载失败即自动隐藏视频层，保留封面、时长与标题正常显示。封面不显示（thumb 代理 410，CDN 签名 URL 过期）的彻底修复在 binge-server 侧——thumb 代理遇 410/403 自动回源 watch 页重提新签名 URL 并自愈缓存行，需另行部署更新版 daemon

#### v0.6.1

- **合并上游全部 48 个未合并提交**（25 文件，+2200/−960）：Home 信息流（未识别场景分类开关 + 空库提示、批次卡片重构、演员名超长截断、信息来源推断、Reel 滚动落位修复）、安全加固（daemon URL 信任规则——未在此确认过的公共地址不发送 Stash API Key / Cookie，凭证卡片显示发送目标、Cookie 过期提示）、Explore / StashDB（Discover 行单次宽查询优先 + 仅 Explore 可见时才请求，保留本地 10s 超时）、安装脚本 SHA256 校验、死模块清理（筛选预设、全部演员弹窗）。跳过捐赠链接与 README/WebP 改动
- **图库套用上游画廊改动**（本地实现保留）：准入标准与场景对齐——未关联演员的图库不再进首页动态（Stash 图库无 stash_ids，演员是唯一凭证），空状态分别提示未识别场景/图库数；Lightbox 完整图库分页——点图库卡片打开后可翻完全部图片（每页 60 张、接近末尾自动预取、计数显示真实总数），此前仅能看前 20 张
- **首页静音图标修复**：自动播放被浏览器拦截降级静音时，图标立即显示"静音"真实状态（原来仍显示"开启"）；过滤滚动离开的 AbortError 避免误降级
- **首页 Stories 头像行秒开**：无缓存首次打开原来要等 StashDB / Reddit / PornHub 三段外部请求串行完成（合计十多秒）才显示头像行；现在本地库数据 1–2 秒内先上屏，三个外部源后台并行合并（等待从三者之和降为最慢一个），单个源挂掉只降级不整行失败；"已拥有场景"全库查询延迟到确认有新场景后才发（缓存命中且无新场景时省 ~1.2s，与发现页共享同一请求）
- **汉化恢复**：新增 34 个 i18n key（含设置页 daemon 信任提示、cookies.txt 解析消息、未识别图库计数等），zh/en 各 585 key 零缺失

#### v0.5.8

- **随机时段播放**：更多选项新增开关 + "循环时长"输入框（秒）。从随机位置开始播放；留空 = 播到影片结尾（自动滚动开则切下一个场景，关则结尾后 A→B 循环）；填秒数 = 该时长后回随机起点循环或切换下一个。手动拖进度条即取消本场景的循环时长；进入全屏立即中断计时，持续播放到结尾。转码流用 `?start=` 预置随机起点，无双重等待
- **进度条时间码**：进度条下方左侧已播放 / 右侧总时长（`00:00` / `000:00` 分钟制）。等宽数字防跳动，字号随屏宽缩放，两侧留 4 数字宽避让手机圆角。竖屏常驻，全屏 UI 淡出时同步隐藏
- **竖屏播放横屏视频位置优化**：非全屏上下黑边过大（≥60px）时视频内容上移黑边的 40%，缓解画面整体偏下；字幕与暂停播放/静音按钮组跟随移动，全屏恢复居中
- **Saved 页窄屏两列**：≤420px 强制两列，修复 375px（iPhone SE）收藏夹卡片掉成单列（`auto-fill` 列数按 track max 计算的坑）

#### v0.5.0–v0.5.7

- **合并上游 v0.5.0–v0.5.5**（25 个提交，125 文件）：Stash 写入容错（null guard）、StashDB 缓存健壮性、保存过滤器修复（`StashIDCriterionInput` 不发 value）、评分 round-half-to-even 对齐、IPv6 安全检查（公网 daemon 不传 API key 明文）
- **StashDB 网络降级**：`postStashDB` 加超时（Stories/Feed 10s、发现页头像 20s）+ 12h 缓存 + 刷新按钮联动清缓存，断网时快速降级不再卡死
- **全屏体验**：操作栈全屏按钮、UI 3 秒自动隐藏、水平滑动快进快退、长按 2× 倍速；进入前固定 height 防止 virtualizer 卸载，退出时等 `orientationchange` 完成再 `scrollToIndex`
- **移动端容器高度**：`100dvh` + `estimateSize` 用 `clientHeight`，解决 mobile Chrome 地址栏遮挡
- **字幕**：自动加载 Stash sidecar `.srt`/`.vtt`，`text-shadow` 描边替代黑底，位置随 `object-fit:contain` 内容区，字体随视频宽度缩放
- **binge-server 集成**：API Key 认证（query param）、URL 派生、一键安装（docker 优先）、cookies.txt 导入
- **详情卡片**：窄屏可滚动查看完整技术信息 + handle 始终可见 + 社交 tab 失败重试按钮
- **UI 细节**：移动端地址栏背景色、回到顶部按钮、Stories 头像缩小、顶部导航放大、Lightbox 箭头描边、设置页 max-width 1100px、窄屏断点统一 720px
- **移除 demo 模式 + 隐藏标签**：清理 459 行 demoContent + `HIDDEN_TAG_IDS`
- **导航按钮改用 PluginApi.patch**：SPA 重渲染无需重注入，可在 Stash 设置勾选显隐
- **演员分页放宽**：`PAGE_SIZE` 24→60；**锁定 Prettier 配置**：`.prettierrc.json` + `.prettierignore`

#### v0.4.17–v0.4.19

- i18n 多语言架构（react-i18next，中英双语，设置页切换）
- 补全 242 个翻译键 + 硬编码中文迁移为 `t()` 调用
- 移除 681 处 fallback 字符串（bundle −17KB）
- 首页图库卡片精简（DOM 简化，−28 行）
- Stash 标签语言联动（切换语言后手动同步标签名）
- 修复演员"又名"不显示别名（`{{aliases}}` 占位符丢失）
- 修复 binge.yml 版本号未同步（Stash 显示旧版本号）
- 修复极窄屏幕下演员详情页影片每行仅显示 1 部（≤380px 强制最少 2 列）
- 修复设置页极窄屏幕排版（≤480px 控件下移、输入框占满宽度）
- README 重排序 + 功能修复大幅精简

#### v0.4.0–v0.4.16 历史修复

- **X tab**：视频就地播放、保存到 Stash、Referer 403 修复（blob URL 代理）、下载进度条
- **输入法**：合成阶段预输入误存 + 确认后保存修复
- **转码**：AVI/WMV 快进修复、自动转码不兼容容器
- **封面布局**：多处右对齐、3:4/4:3 自适应、图库卡片比例调整
- **合集**：默认合集自动创建、tagName 中文化、卡片图标 + 删除保护
- **搜索**：历史持久化、输入法兼容
- **播放**：自动播放修复、进度条 seek 竞态、静音按钮失效
- **主题**：refract 白底白字修复、favicon 主题自适应
- **导航**：首页/发现页跳转修复

> 完整修复记录详见 [汉化及修复.md](./汉化及修复.md)。

### 技术实现

所有修改在 **TypeScript 源码级别**完成（非压缩 JS 补丁），具体见 [汉化及修复.md](./汉化及修复.md)。

---

## 安装

### 方式一：下载 Release

1. 前往 [Releases 页面](https://github.com/k6cc/binge-cn/releases)
2. 下载最新版本的 `binge-vX.Y.Z.zip`
3. 解压到 Stash 插件目录（zip 内文件直接放在 binge 目录下）：
   - **Windows**: `%USERPROFILE%\.stash\plugins\binge\`
   - **Linux/macOS**: `~/.stash/plugins/binge/`
4. Stash → 设置 → 插件 → 重新加载插件

### 方式二：添加插件源

在 **Stash → 设置 → 插件 → 可用插件 → 添加源** 中添加以下任一 URL：

**推荐（GitHub Pages，需启用 Pages）**：
```
https://k6cc.github.io/stash-plugins/plugins/main/index.yml
```

**备用（raw URL，无需启用 Pages，立即可用）**：
```
https://raw.githubusercontent.com/k6cc/stash-plugins/main/plugins/main/index.yml
```

> **启用 Pages 步骤**：stash-plugins 仓库 → Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / `(root)` → Save。等待 1-2 分钟后 `k6cc.github.io/stash-plugins/` 即可访问。

> 此 URL 是统一插件源，同时包含 Binge、nfoSceneParser、sceneTranslate 等多个插件，可一并安装。

然后从列表中安装 **Binge**。Stash 主导航栏会出现一个无穷符号按钮——点击即可。

### 手动部署

```bash
unzip binge-vX.Y.Z.zip -d ~/.stash/plugins/binge/
# 然后：Stash → 设置 → 插件 → 重新加载插件
```

偏好设置存储在 `localStorage` 的 `binge.*` 命名空间下——不会修改 Stash 自身的配置。

---

## 设置

打开 binge → ⋯ → 设置（桌面端）或 菜单 → 设置（移动端）。

| 设置项 | 默认值 | 说明 |
|-|-|-|
| 显示性别 | 全部 | 五个开关。驱动发现流 + 发现演员行。 |
| 流媒体类型 | 自动 | 自动 / 直连 / MP4 / WebM / HLS |
| 在动态中显示图库 | 开 | 在首页混入图库 |
| 近期窗口 | 30 天 | "新"的回溯范围。7 / 14 / 30 / 60 / 90 / 180 / 365 |
| 在故事中包含 StashDB 新发布 | 开 | 无 StashDB API 密钥时无效。 |
| 场景混入演员档案 | 关 | 也可在档案场景标题处通过 pill 切换 |
| 在故事中包含 Reddit 帖子 | 开 | 需要 binge-server 可达（否则静默跳过） |
| binge-server URL | `http://localhost:7878` | 远程时覆盖 |
| binge-server 配置 | — | 自动检测 Stash API 密钥 + 接受 Reddit cookie。仅在 binge-server 可达时可见。 |
| 跟随 refract 强调色 | 关 | 将 refract 的强调色调色板镜像到 binge |
| 自动滚动 | 关 | 当前场景结束时前进到下一个（reel ⋯ 菜单） |
| 随机时段 | 关 | 从随机位置开始播放；循环时长留空播到结尾，填秒数到时循环/切换（reel ⋯ 菜单） |
| 显示调试覆盖层 | 关 | 每个幻灯片的调试 HUD；reel 中按 `\` 热键 |

---

## 伴侣插件集成

运行时检测——按需安装任一；binge 在缺失时优雅降级。

| 插件 | 增加的功能 |
|-|-|
| [Refract](https://github.com/ordureconnoisseur/stash-refract) | 将 binge 的强调色调整为匹配你的 refract 调色板（可选开关） |
| [stash-multiview](https://github.com/ordureconnoisseur/stash-multiview) | 操作栈中的 4 格网格按钮——点击排队，长按打开 |
| [stash-advanced-rating](https://github.com/ordureconnoisseur/stash-advanced-rating) | Reel + 档案中的按维度 0–5 评分模态框 |
| [stash-scribe](https://github.com/ordureconnoisseur/stash-scribe) | Scribe 铅笔 → LLM 驱动的评价撰写 |
| [binge-server](https://github.com/ordureconnoisseur/binge-server) | Stories 行中的 Reddit 帖子（独立的 Go 守护进程） |

---

## 架构

- **Vite + React 19 + TypeScript** 打包为单文件 SPA（`dist/index.html`），由 Stash 从 `/plugin/binge/assets/index.html` 提供。`binge.entry.js` 注入导航按钮。
- **所有 Stash 数据通过 GraphQL**（`/graphql`，同源 cookie 认证）。binge 自身后端。
- **StashDB 直连** — 使用用户的 API 密钥查询 `https://stashdb.org/graphql`（从 Stash 的 stashbox 配置读取）。12 小时 localStorage 缓存。
- **哈希路由** — `#/home`、`#/foryou`、`#/explore`、`#/following`、`#/saved`、`#/settings`、`#/menu`、`#/p/<id>`、`#/sdbp/<id>`。支持直接深链 + 浏览器后退。
- **运行时插件检测** — ASR / scribe / multiview / refract 在启动时查询，通过 React Context 门控。

---

## 开发

```bash
git clone https://github.com/k6cc/binge-cn.git
cd binge-cn
npm install
npm run dev     # Vite 开发（仅 SPA — 无 Stash 数据）
npm run build   # 产出 dist/index.html
```

技术栈：Vite · React 19 · TypeScript · TanStack Virtual（Reel 虚拟化）。

### i18n 工具

`scripts/i18n/` 下提供 6 个 Node.js 脚本辅助翻译键维护（详见 [scripts/i18n/README.md](./scripts/i18n/README.md)）：

| 脚本 | 用途 |
|-|-|
| `scan_missing_keys.cjs` | 扫描 `t()` 调用，找出 zh.ts / en.ts 中缺失的键 |
| `find_hardcoded_chinese.cjs` | 扫描未用 `t()` 包裹的硬编码中文字符串 |
| `sync_en_from_source.cjs` | 英文源码升级后，同步 en.ts 的大小写/空格/标点 |
| `validate_en.cjs` | 校验 en.ts 的空值、中文残留、`{{*}}` 残留 |
| `remove_fallbacks.cjs` | 批量移除 `t()` 调用中的冗余 fallback 字符串 |
| `analyze_bundle.cjs` | 分析 i18n bundle 体积构成 |

```bash
node scripts/i18n/scan_missing_keys.cjs      # 新增组件后检查缺失键
node scripts/i18n/find_hardcoded_chinese.cjs # 检查遗漏的硬编码中文
node scripts/i18n/sync_en_from_source.cjs    # 英文源码升级后同步 en.ts
```

---

## License

AGPL-3.0. See [LICENSE](./LICENSE).（与 Stash 自身许可证一致。）

---

## 致谢

- 原项目：[ordureconnoisseur/binge](https://github.com/ordureconnoisseur/binge)
- 汉化及修复详见 [汉化及修复.md](./汉化及修复.md)

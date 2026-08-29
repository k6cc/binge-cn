# Binge（汉化版）

> 基于 [ordureconnoisseur/binge](https://github.com/ordureconnoisseur/binge) v0.4.0 的中文汉化 + 功能修复分支。当前版本 **v0.7.7**。

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

#### v0.7.x

- **PH 保存超时修复**：`saveToStash` 超时 30s → 245s，对齐 daemon 4 分钟同步下载预算——上游 30s 会掐断 daemon 端仍在进行的 yt-dlp 下载（且无断点续传，重试从零开始），大视频永远下不完；daemon 认证回退为上游 `ApiKey` header 写法（CORS preflight 问题上游已随 binge-server v0.3.0 修复，消除 fork 最后一处刻意偏离）
- **设置页输入框窄屏溢出修复**：极窄屏下「要忽略的图库文件夹」「要忽略的文件夹名」「守护进程写入路径」不再超出屏幕——输入框改 `box-sizing: border-box`（原 content-box 使 `min-width: 100%` 叠加 padding/border 必然溢出），与按钮同行的输入框解除 min-width 下限以允许 flex 收缩
- **合并上游 0.12.0 系**（upstream HEAD 1b9e803）：设置页搜索 + 分组（含 Advanced Rating / Multiview / Scribe 伴侣插件状态展示）、StashDB 网络降级优化（限流/缓存/超时上调，瞬时故障不再误判）、安全修复（外部 URL 过滤、`redirect: "error"` 防密钥泄露）、演员图片网格无限滚动修复、Pack 卡片 mosaic 点击直达场景；本地定制全部保留（两层图库架构、默认合集保护、chained 播放模式等），按用户决策移除上游测试栈与保存进度跟踪定制（放弃 binge-server fork、改用上游镜像）
- **进度条拖动擦洗 + 命中区扩容**：拖动实时显示时间码气泡（加粗纯白、深色圆角底），松手才跳转（转码流硬 seek 安全模式）；命中区上下对称扩容，鼠标/触屏拖动更易命中、移动端擦洗不易滑出；移动端去除浏览器默认点按高亮，点按反馈由元素自身状态承担
- **转码流加载指示 + 居中定位修复**：转码冷启动 / 硬 seek / 断线重连期间画面中央弧形转圈，不再黑屏无反馈；从演员/合集卡进入的居中元素（首个视频按钮/转圈）直达"新居中位置"且无位移动画；横滑 seek 指示器跟随视频内容区居中
- **演员详情页 tab 切换稳定性**：场景/图库/X 标签切换不再水平抖动（滚动条空间常驻）、不闪空状态文案（加载态前置）、跨 tab 往返不因内容高度差闪跳（内容区最小高度 70dvh 兜底）；保持原有滚动位置不跳
- **Stories 弹窗卡片修复**：≤720px 卡片居中（grid 自动放置错位）与 <560px 等比收缩（改宽度驱动尺寸）；点击卡片外空白区域关闭弹窗
- **设置页收尾**：赞助信息弱化为暗色小号页脚；binge-server 未配置时的可选说明长段补翻；本地库演员详情页属性行接入 `color.*` 翻译体系（hair_color/eye_color 不再显示 Stash 原文，如 "brunette · Brown色眼睛"）
- **代码清理**：修复 passive event listener 控制台报错与移动端进度条 hover 态残留（均为上游遗留）、过期注释清理

#### v0.4.0–v0.6.9（合并摘要）

- **i18n 多语言架构**：react-i18next 中英双语，设置页切换，585 个翻译键
- **随机时段播放**：随机起点 + 循环时长（留空播到结尾）
- **字幕**：自动加载 srt/vtt，描边样式，随视频宽度缩放
- **全屏体验**：UI 自动隐藏、横滑快进快退、长按 2× 倍速、退出稳定性修复
- **转码流播放**：断点自动重连（熔断/假结尾识别）、后台回前台预热、AVI/WMV 快进修复
- **播放层栈 + 静音全局同步**：覆盖层打开下层视频暂停，任一时刻只有一个声音
- **图片查看器 / 图库卡片**：原生滚动 + 吸附重构、桌面拖拽翻页（`useDragPaging`）、交互后停止自动轮播
- **Stories 头像行秒开**：外部源后台并行合并，单源挂掉只降级
- **X 弹窗**：就地播放、保存到 Stash、触屏划动翻页
- **binge-server 集成**：API Key 认证、一键安装、cookies.txt 导入、保存进度条
- **合并上游 v0.5.0–v0.6.4 全部提交**：信息流改进、安全加固（daemon URL 信任规则）、安装 SHA256 校验、死模块清理
- **通用 SortMenu 组件**：深色浮层菜单替换原生 select，桌面/手机一致
- 其余为布局/字号/间距/图标等微调与优化，详见 [汉化及修复.md](./汉化及修复.md)

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

然后从列表中安装 **Binge**。

安装后需手动开启导航按钮（默认关闭）：**Stash → 设置 → 界面 → 基本设置 → 菜单选项**，勾选 **Binge**。之后 Stash 主导航栏会出现一个无穷符号按钮——点击即可。

> ⚠️ 这一步不可省略且容易遗漏：Stash 只在插件 id 出现在菜单选项列表中时才渲染其导航按钮，而全新安装默认不含它——不勾选则任何地方都不会出现按钮，插件看起来像安装失败。

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

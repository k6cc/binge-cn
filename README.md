# Binge（汉化版）

> 基于 [ordureconnoisseur/binge](https://github.com/ordureconnoisseur/binge) v0.4.0 的中文汉化 + 功能修复分支。

为 [Stash](https://github.com/stashapp/stash) 提供的 Instagram 风格社交与发现层：竖屏 Reel、Stories、演员档案、StashDB 驱动的发现功能——全部基于 Stash 既有的 GraphQL API。Web 插件形态。

<p align="center"><img src="screenshots/hero.png" alt="binge — reels, stories, and discovery for your Stash library" width="840" /></p>

---

## 汉化版变更说明

### UI 汉化

- **全部用户可见 UI 字符串翻译为中文**（导航、按钮、状态、设置、演员信息、场景信息、错误提示等）
- **日期格式**：`YYYY年M月D日`（如 `2024年2月28日`）
- **相对时间**：`刚刚` / `X分钟前` / `X小时前` / `X天前` / `X周` / `X个月` / `X年`
- **排序选项**：`最近` / `最多播放` / `最多高潮` / `最高评分` / `最近添加` 等
- **评分维度**：`总体` / `默契度` / `美感` / `制作质量` / `创意` / `外形` / `表现` 等
- 品牌名保持英文：Stash、StashDB、Reddit、X (Twitter)、PornHub、Cookie、forage、binge-server、HLS、MP4、WebM

### 功能修复

| 修复 | 说明 |
|-|-|
| 演员档案图库 tab | 原"照片"tab 显示单张图片 → 改为"图库"tab 显示 Stash 图库（封面网格 + 灯箱浏览） |
| 图库封面悬停自动播放 | 鼠标悬停 0.5s 后获取图库图片，每 1s 循环切换封面 |
| 首页图库卡片自动播放 | IntersectionObserver 50% 可见时启动，每 2s 切换图片 |
| 视频 poster 懒加载 | 仅视口内卡片加载视频源，减少不可见卡片的带宽和内存占用 |
| "观看完整场景"按钮 | 使用 `chained` 模式（基于当前场景的演员/标签推荐）替代 `pinnedQueue`，修复滚动位置被虚拟列表覆盖的问题 |
| Reel 依赖数组修复 | `useEffect` 依赖数组加入 `pinnedQueue` 和 `pinFirstSceneId`，确保种子场景正确加载 |
| refract 主题白底白字 | Feed 卡片和 Discovery 卡片添加 `#0d0d0d` 深色底衬，`--glass-bg` 回退值改为 `#00000080` |
| 头像栈集成 | Feed 卡片头像栈集成 story ring（有故事的演员彩色边框）和 repost badge（转发标记） |

### 技术实现

所有修改在 **TypeScript 源码级别**完成（非压缩 JS 补丁），具体见 [汉化及修复.md](./汉化及修复.md)。

---

## 功能特性

- **竖屏 Reel** — 滑动浏览场景，双击点赞，操作栈（评分、多视图、Scribe、保存、⋯）。
- **首页 Stories + Feed** — IG 风格的演员 Stories 行（库内 + StashDB + 可选 Reddit）位于分页场景流上方。批量导入折叠为单个 Pack 卡片。
- **演员档案** — 简介、统计、场景网格、图库网格、社交链接条（Twitter / Instagram / TikTok / Reddit / OnlyFans / Fansly 品牌图标）。库内 + StashDB-only 变体共享布局。
- **StashDB 发现** — 首页的 DISCOVER + TRENDING 卡片；关注演员 + 添加你尚未拥有的场景。
- **移动优先** — 底部导航、悬停卡片迷你档案、演员 `@mention` 链接。触屏 + 桌面端一致体验。

---

## 安装

### 方式一：下载 Release

1. 前往 [Releases 页面](https://github.com/k6cc/binge-cn/releases)
2. 下载最新版本的 `binge-vX.Y.Z.zip`
3. 解压到 Stash 插件目录：
   - **Windows**: `%USERPROFILE%\.stash\plugins\binge\`
   - **Linux/macOS**: `~/.stash/plugins/binge/`
4. Stash → 设置 → 插件 → 重新加载插件

### 方式二：添加插件源

在 **Stash → 设置 → 插件 → 可用插件 → 添加源** 中添加：

```
https://k6cc.github.io/binge-cn/plugins/main/index.yml
```

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

---

## License

AGPL-3.0. See [LICENSE](./LICENSE).（与 Stash 自身许可证一致。）

---

## 致谢

- 原项目：[ordureconnoisseur/binge](https://github.com/ordureconnoisseur/binge)
- 汉化及修复详见 [汉化及修复.md](./汉化及修复.md)

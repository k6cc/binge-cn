# Binge（汉化版）

> 基于 [ordureconnoisseur/binge](https://github.com/ordureconnoisseur/binge) v0.4.0 的中文汉化 + 功能修复分支。当前版本 **v0.4.15**。

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

#### v0.4.9-RC6 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | Bug 1 点击二层封面跳转演员其他影片 | 日志确认 queue 路径正确执行，但 queue 设计是"顺序播放整包"，滚动一次就到第二个 → 用户以为"错误跳转"。修复：handlePick 从 `setPinnedQueue` 改为 `setPinFirstSceneId`，走 random 路径，只 pin 点击的场景到第一位，后续走演员 filter 随机推荐（与 `SceneFeedCard.handleWatchFullScene` 一致） |
| 2 | 发现页影片封面 3:4 竖版 + 2-4 列自适应 | `.binge-explore-grid` 从固定 3 列改为媒体查询控制：默认 2 列，≥560px→3 列，≥820px→4 列。`.binge-explore-tile` 从 1:1 正方形改为 3:4 竖版，加 `align-self:start` 防止 grid 行高塌缩 |
| 3 | 一层封面 3:4 竖版（一行4个共2行） | `.binge-pack-card-mosaic` 从 1:1 正方形（3×3）改为 3:2 横版（4×2，每 tile 3:4 → 整体 3:2）。`PackFeedCard.tsx` 的 `MOSAIC_TILES` 从 9 改为 8 |
| 4 | 二层封面 4:3 横版（一行2个） | `.binge-pack-sheet-grid` 从 3 列改 2 列。`.binge-pack-sheet-tile` 从 3:4 竖版改 4:3 横版，`background-position` 从 `right center` 改 `center center` 居中铺满 |
| 5 | Bug 1 调试日志 | 增加 5 处调试日志（`[binge-pack]` 1 处 + `[binge-reel]` 4 处），确认 queue 路径执行情况。诊断结果：queue 路径正确，根因是行为与用户期望不符 |

#### v0.4.9-RC5 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 发现页 + 合集卡片封面布局初版 | RC5 初版实现（RC6 已调整：发现页改为媒体查询控制 2-4 列，一层封面改为 4×2） |
| 2 | Bug 1 调试日志 | 初版日志（RC6 保留并用于诊断） |

#### v0.4.9-RC4 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 二层封面垂直重叠（grid 行轨迹塌缩） | CSS 规则正确但渲染仍垂直重叠——`tile[0] y=164 h=499`，`tile[3] y=256`（应在 y=665），重叠 409px。根因：grid 容器有 `overflow-y:auto` + 固定高度时，`align-items:stretch`（默认）与 `aspect-ratio` 产生循环依赖 → 行高塌缩到 min-content（约 92px）。修复：`.binge-pack-sheet-grid` 加 `grid-auto-rows: max-content` + `.binge-pack-sheet-tile` 加 `align-self: start`，打破循环依赖 |

#### v0.4.9-RC3 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | AVI/WMV 转码影片快进从头播放 | Stash 的 MP4 transcode 是渐进式下载，原生 `<video>.currentTime = N` 依赖 HTTP Range，而 live transcode 不稳定支持 Range → 快进重置。修复：`pickStream` 导出 `isWebCompatible()` + `buildTranscodeSeekUrl()`；`SceneSlide` 新增 `seekToTime` 回调，转码流走"硬 seek"（重建 src 带 `?start=N` + `load()` + `canplay` 后播放），兼容容器走原生 seek；`SceneProgress` 新增 `onSeekToTime` prop + `seekOffset` 偏移量 |
| 2 | 进度条 seek 后重置为零（竞态） | `SceneProgress` 的 `seekOffset` 变化时重新绑定 `timeupdate` 监听器，但 `video.load()` 触发的 `timeupdate` 可能在旧监听器（闭包固定 `seekOffset=0`）被移除前抢先触发 → 进度条瞬间归零。修复：用 `useRef` 镜像 `seekOffset`，监听器只绑定一次，每次从 ref 读取最新值 |
| 3 | WMV 转码流 seek 后不自动播放 | `canplay`/`loadeddata` 事件触发时调用一次 `playPreferred`，若 `play()` 以 `AbortError` 失败（WMV 转码流常在数据未真正就绪时触发 `canplay`）不会重试 → 视频永久暂停。修复：`SceneSlide` 新增 300ms 周期重试（`retryPlay`），持续检查 `video.paused` 并调用 `playPreferred`，直到 `playing` 事件确认或 8 秒超时 |
| 4 | StoryViewer 首次打开自动播放失败 | 首次打开时 `<video>` 刚挂载，`play()` 在视频未就绪时调用 → `AbortError`，静音重试也失败。修复：添加 `canplay`/`loadeddata` 监听器，视频就绪时重试 `play()`；`AbortError` 不再误改 mute 状态 |
| 5 | StoryViewer 关闭后重开同一演员自动播放失败 | play-sync `useEffect` 依赖数组缺少 `isOpen`。关闭后重开同一演员时 `stories` 是同一引用（来自 `StoriesContext` 共享状态），`activeIndex`/`sceneIndex`/`currentScene` 引用均不变 → 若 deps 不含 `isOpen`，effect 不会重跑 → 新挂载的 `<video>` 未绑定监听器，`tryPlay` 也不调用 → 自动播放失败。加入 `isOpen` 后，关闭→重开时 effect 重跑 → 正确驱动新 video |
| 6 | StoryViewer 观看完整场景跳转随机 | `handleCta` 在 `setTab` 之前调用 `setPinFirstSceneId`，而 `setTab` 内部会清空 pin → Reel 走 random 路径。修复：调整为 `setTab` 之后再调用 `setPinFirstSceneId`，利用 React 18 批处理"后写胜"语义（与 `SceneFeedCard.handleWatchFullScene`、`PackDetailSheet.handlePick` 一致） |

#### v0.4.9 正式版（相对 RC7 的最终清理）

| # | 修复 | 说明 |
|-|-|-|
| 1 | 清理调试日志 | 删除 RC3-RC6 期间为排查播放/seek/自动播放/跳转问题添加的 13 处 `console.debug` 调用（`[binge-reel]` 9 处 + `[binge-story]` 2 处 + `[binge-pack]` 2 处），同时清理 StoryViewer.tsx 中因删日志而未使用的 `sceneId` 变量 |
| 2 | 关注页收藏夹空白占位过高 | `.binge-following-empty` 继承全局 `.binge-status` 的 `height:100vh`，导致收藏夹为空（或搜索无匹配）时占位满屏，把"所有演员"行挤到第二屏。修复：覆盖为 `height:auto + min-height:180px`（约一个演员资料卡的高度：avatar 110 + gap + name + count），保留文字垂直居中 |

#### v0.4.15 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 默认合集 + 父标签 tagName 中文化 | binge 自建的两个默认合集 tagName 和父标签 tagName 从英文改为中文，与界面显示名一致：`Watch Later 📁` → `稍后观看 📁`、`My Favourite ❤️` → `我的最爱 ❤️`、`binge Collections` → `binge 合集`。`Favourite ★` 保持英文不变（由 ASR 插件拥有并共享，改名会破坏 ASR 互操作）。父标签 rename 不改 tag id，子标签的 `parent_ids` 关系自动保留。新增 `tagRename` mutation（复用 `TAG_UPDATE` 的 `name` 字段）。新增 `migrateLegacyTagNamesIfNeeded` 迁移函数：检测旧英文 tag 是否存在，若存在且新中文 tag 不存在则 rename，保留所有场景关联和 parent 关系。用独立 localStorage flag `binge.legacyTagNamesMigrated.v0.4.15` 保证只跑一次，在 `ensureDefaultCollections` 的 seeded 短路之前执行，确保已 seeded 的老用户也能迁移。幂等可安全重试；边缘情况（旧新 tag 同时存在）不处理，保留旧 tag 残留避免数据丢失 |

#### v0.4.14 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 输入法确认后不保存搜索记录 | `compositionend` 触发时 `e.currentTarget.value` 可能还是合成前的旧值（被 `MIN_LENGTH=2` 过滤）。修复：`compositionend` 里用 `setTimeout(0)` 延迟到下一个事件循环读取 value，确保拿到最终确认的中文文本。三处搜索入口（Explore/Following/AllPerformersModal）统一修复 |

#### v0.4.13 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | favicon 主题自适应 | `binge-header-brand` 的白色图标在 Chrome 浅色标签页"消失"。在 inline SVG data URL 内嵌 `<style>` + `prefers-color-scheme` media query：默认深色背景下白色，`prefers-color-scheme: light` 下深色（`#1a1a1a`）。移除 `<path fill='#ffffff'>` 的 inline fill，改由 `<style>` 控制。保持 inline data URL 架构，不引入外部文件 |

#### v0.4.12 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 输入法预输入误存修复 | 中文/日文等输入法合成阶段（拼音未确认）`onChange` 仍会触发，会把未确认的拼音字母误存为搜索词。三个搜索入口（Explore/Following/AllPerformersModal）加 `compositionstart`/`compositionend` 事件 + `composingRef` 标记：合成中跳过 `scheduleSave`，`compositionend` 触发后保存确认值。这是处理输入法 + React 的标准做法 |

#### v0.4.11 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | X tab 视频就地播放 | 新增 `XDetailModal` 组件（portal 全屏 modal）。点击视频/图片卡片不再跳转 x.com，而是弹出 modal 就地播放/查看，支持音量/进度/全屏（原生 `controls`）、← → 翻页、Esc 关闭。`XCell` 从 `<a target="_blank">` 改为 `<button onClick>`，卡片内显示推文文本/点赞/查看数，提供"在 X 上打开"按钮。视频复用 `useFetchBlobUrl` 的 blob URL，零成本播放 |
| 2 | X 视频保存到 Stash | `XCell` 卡片悬停右上角浮现保存按钮（⬇/⏳/✓/✕），`XDetailModal` 内也有独立保存按钮。`saveToStash` API 新增 `source:"x"` 分支，由 binge-server 守护进程下载保存。按 `tweetId:mediaUrl` 记录 saving/saved/error 状态 |
| 3 | X 图文卡片就地查看 | X tab 点击图文卡片也弹出 `XDetailModal`，与视频一致。图片用 `<img referrerPolicy="no-referrer">`（img 元素 referrerPolicy 可靠，无需 blob 方案），同样支持保存和"在 X 上打开" |
| 4 | X 视频下载进度条 | `useFetchBlobUrl` hook 通过 `ReadableStream` 读取 chunks + `Content-Length` 计算下载百分比。`XVideoThumb` 在视频缩略图加载期间显示底部进度条（`.binge-x-progress`）。无 `Content-Length` 时退化为无进度（仅深色占位）。TS6 的 `Uint8Array<ArrayBufferLike>` 泛型需通过 `new Uint8Array(value)` 创建副本确保 `buffer` 为 `ArrayBuffer` 类型 |
| 5 | X modal 视频窗口高度低时上下边被裁 | `.binge-x-modal-video` 从 `max-height: 100%` 改为 `position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain`。原方案在 flex + `max-height`（非 `height`）容器中百分比高度可能不解析 → 视频按 intrinsic 高度溢出被 `overflow:hidden` 裁切。absolute 定位不依赖百分比高度解析，`object-fit: contain` 保证 letterbox 不裁切 |
| 6 | StoryViewer 的 X 视频修复 | `RedditCardBody` 新增 `needsBlobProxy` 判断，对 X（x.com/twitter.com）视频使用 `useFetchBlobUrl` 下载为 blob URL 绕过 twimg 的 Referer 检查（`<video>` 元素的 `referrerpolicy` 属性浏览器实现滞后，Chromium 对 media element 长期不实现）。原走 `rewriteRedgifsMediaUrl` 原样返回被 403 |
| 7 | StoryViewer 的 Reddit 视频修复 | 同样的 `needsBlobProxy` 判断覆盖 Reddit（v.redd.it/redditmedia.com）视频。v.redd.it 也有 Referer 检查问题，复用 fetch + blob URL 方案。redgifs 等已有 binge-server 代理的保持原 `rewriteRedgifsMediaUrl` + `setAttribute("referrerpolicy")` 路径 |
| 8 | 搜索历史持久化到 localStorage | 新增 `useSearchHistory` hook + `SearchHistoryDropdown` 组件。每个 namespace 独立存储（`"scenes"` / `"performers"`，key: `binge.searchHistory.<namespace>`），去重（大小写不敏感）+ 最多 12 条 + 最短 2 字符。`scheduleSave` debounce 800ms 保存（比 `onBlur` 更可靠，避免路由切换时组件卸载导致 `onBlur` 不触发）。输入法合成处理：`compositionstart`/`compositionend` + `composingRef` 标记，避免中文输入法预输入的拼音字母被误存为搜索词。芯片样式：圆角框横向排列自动换行，关键词最多 12 字符省略，尾部 × 删除。集成到 Explore（场景搜索）、Following（演员搜索）、AllPerformersModal（演员搜索）三个入口 |
| 9 | XDetailModal 视频图片不显示修复 | `.binge-x-modal-content` 只有 `max-height:90vh` 无 `height`，flex 容器高度由内容决定，media 区域的 `flex:1` 无空间可分配，且内部 video/image 是 `position:absolute` 不参与布局 → 高度为 0。改用 `width: min(90vw,675px); height: min(90vh,900px)` 给容器明确高度。StoryViewer 不受此问题影响（已有 `height: min(88vh,880px)` + video 直接子元素） |

#### v0.4.10 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | X tab 视频缩略图黑屏 | 根因：twimg 视频检查 Referer，从 stash 页面加载带 Referer 被 403；且 `<video>` 元素的 `referrerpolicy` 属性浏览器实现滞后（Chromium 对 media element 长期不实现），setAttribute 无效。多轮方案对比：`<img src>` 无法解码 mp4 / `<video referrerpolicy>` 403 / `#t=0.1` Media Fragment 在 `preload=metadata` 下不主动 seek → 黑屏。最终方案：`fetch(referrerPolicy:'no-referrer')` 拿到 blob → `URL.createObjectURL` 生成 blob URL → `<video src>` 加载，blob URL 是同源本地资源不发网络请求，无 referrer 问题 |
| 2 | X 视频悬停播放预览 | 抽出 `XVideoThumb` 组件：默认 `onLoadedMetadata` seek 到 10% 位置显示静态帧；`onMouseEnter` → `play()` 循环播放预览；`onMouseLeave` → `pause()` + 重置回静态帧。移动端无 hover 保持静态帧 + 点击跳转推文。组件卸载时 `revokeObjectURL` 释放内存 |

#### v0.4.9-RC7 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | TS6133 构建错误 | RC6 的 handlePick 从 `setPinnedQueue` 改为 `setPinFirstSceneId` 后，`useTab()` 解构中的 `setPinnedQueue` 不再使用 → TypeScript 报错。移除未使用的解构变量 |
| 2 | Fork 仓库 sync workflow 失败 | `.github/workflows/sync.yml` 尝试 clone 上游 `ordureconnoisseur/plugins` 仓库，fork 仓库无 `PLUGINS_REPO_TOKEN` 认证失败。修复：sync job 加 `if: github.repository == 'ordureconnoisseur/binge'` 条件，fork 仓库自动跳过 |

#### v0.4.8 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 演员详情页点击影片跳转到随机影片 | Reel random 路径在 fetch 完成后调用 `setPinFirstSceneId(null)` 清除 pin，但 `pinFirstSceneId` 在依赖数组中 → 清除触发 effect 重跑 → 第二次跑时 pin 为 null → 重新拉随机场景覆盖掉刚放好的 pin 场景。改为不清除 pin，让 pin 留在 state 里由 `setTab`/filter-takeover 清除 |
| 2 | 转码机制回滚 | 移除 v0.4.7 误加的 hls.js 依赖，恢复 MP4 优先策略（Stash 转码默认输出 MP4，原生支持快进） |

#### v0.4.7 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 二层封面重叠 | PackDetailSheet tile 缺少 `width:100%` + `display:block`，button 在 grid 中宽度退化为 0 → 所有 tile 叠在同一格子。与 `.binge-gallery-cover-btn` 对齐 |
| 2 | 取消筛选后内容不变 | Reel 新增 effect：queue 活跃时用户清除 performer chip → 自动清除 pinnedQueue → Reel 走 random 路径重新加载 |
| 3 | 转码影片快进 | pickStream 对 avi/wmv 等不兼容容器在 auto/direct 模式下自动选 MP4 转码流（Stash 默认转码输出 MP4，支持快进）。无需 hls.js，由 Stash 服务端 + 浏览器原生 video 处理 |

#### v0.4.6 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 演员合集卡片封面右对齐 | 一层 3×3 mosaic 截图 `background-position` 从 `center` 改为 `right center`，保留主体 |
| 2 | 二层封面 3:4 竖屏 + 底部标题 | PackDetailSheet 二层封面比例从 9:16 改为 3:4（与图库封面一致），右对齐，底部叠加渐变标题（最多两行） |
| 3 | 合集卡片进入 reel 显示筛选 chip | 点击二层封面进入 reel 时同步把主演写入 FilterContext，FilterBar（带头像名字×）和 FilterSheet 都能显示当前筛选条件 |
| 4 | 自动转码 wma/avi 等格式 | pickStream 检测文件扩展名，非 web 兼容容器（.avi/.wmv/.wma/.mkv/.flv 等）在 auto / direct 模式下自动选择转码流，激活 Stash 的转码能力 |
| 5 | 自动创建 3 个默认合集 | 应用启动时一次性 ensure 三个默认合集（收藏夹★ / 稍后观看📁 / 我的最爱❤️）的 Stash tag 存在，首次访问"已保存"页即可看到 |
| 6 | "我的最爱 ❤️" 心形图标 | SaveSheet 新增 myFavourite 心形图标，区别于"收藏夹"的书签图标 |
| 7 | 默认合集禁止删除 | SavedPage 删除保护从只拦截 `★` 改为拦截所有 `isDefault` 合集（含 ❤️） |

#### v0.4.5 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 悬浮卡片左对齐 | PerformerHoverCard 弹窗从居中改为左对齐名字，卡片放大后不再距离过远 |
| 2 | 图库卡片头像点击打开 Story | 图库卡片头像点击打开 StoryViewer（与场景卡片一致），点击名字进入演员详情 |
| 3 | 插件 zip 扁平结构 | 打包结构从 `binge/` 子目录改为 4 文件根层级，解压即用 |
| 4 | 仓库清理 | 移除已提交的 `binge-v0.4.2.zip` 和 `release/binge/` 构建产物 |

#### v0.4.4 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 图库卡片 4:3 横屏 | 轮播比例从 1:1 改为 4:3，图片铺满 |
| 2 | 图库卡片头像彩色圆环 | 头像外层加渐变圆环，名字贴头像而非居中 |
| 3 | 卡片断点微调 | 平板 780→680px，桌面保持 840px，加入 0.25s 平滑过渡 |
| 4 | 推荐页翻译 | `Favourite` → 收藏、`Manage follows` → 管理关注、`Favourited` → 已收藏 |

#### v0.4.3 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | 宽屏卡片放大 150% | 桌面 560→840px、平板 520→780px，移动端不变 |
| 2 | 故事查看器声音联动 | 自动播放失败时改用 `setMutedSession`（临时静音），切换故事不再重置用户偏好 |
| 3 | 发现页封面右对齐 | `.binge-explore-tile` 的 `background-position: center` → `right center` |
| 4 | 图库卡片 header 修复 | 头像黑环改 `border:none`、补 VerifiedIcon、白底改 div 容器、加 PerformerHoverCard 悬停弹窗 |

#### v0.4.2 新增修复

| # | 修复 | 说明 |
|-|-|-|
| 1 | release workflow 手动触发 | 新增 `workflow_dispatch` + `version` 输入参数，支持 Actions 页面手动触发发布 |
| 2 | 版本号统一 | 新增"Resolve version"步骤，手动触发用输入值、tag 触发用 `github.ref_name` |

#### v0.4.1 新增修复（11 项）

| # | 修复 | 说明 |
|-|-|-|
| 1 | 静音按钮失效 | 独立 effect 同步 `video.muted` 与 React 状态，IO 闭包不再固定初始值 |
| 2 | 演员详情页影片封面右对齐 | `.binge-profile-scene-poster` 设置 `background-position: right center` |
| 3 | 演员详情页图库封面 3:4 竖排 | 新增 `.binge-gallery-cover-btn` 样式，`aspect-ratio: 3/4` |
| 4 | 发现页影片封面右对齐 | `.binge-discovery-card-cover img` 设置 `object-position: right center` |
| 5 | 首页/发现页影片跳转错误 | `setTab` 后设置 pin + `reelMode=chained`，利用 React 18 批处理"后写胜"语义 |
| 6 | 首页图库卡片白底无头像 | 复用 `AvatarStack` 组件，统一头像样式 |
| 7 | 首页图库卡片图片数量限制 | `MAX_GALLERY_IMAGES` 10 → 500（与演员档案图库上限一致） |
| 8 | 首页图库卡片末张纯色图点击跳转 | 修改点击事件为 `openProfile(primaryPerformer.id, "galleries")` |
| 9 | 合集文件夹名翻译 | `Favourites` → 收藏夹, `Watch Later` → 稍后观看 |
| 10 | 首页更多选项翻译 | `Saved` → 已保存, `Settings` → 设置 |
| 11 | 设置页 X (Twitter) 媒体标签页实装 | 新增 `PerformerXGrid` 组件，演员档案含 twitter.com / x.com 链接时显示 X 标签页 |

#### v0.4.0 已有修复

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
3. 解压到 Stash 插件目录（zip 内 4 个文件直接放在 binge 目录下）：
   - **Windows**: `%USERPROFILE%\.stash\plugins\binge\`
   - **Linux/macOS**: `~/.stash/plugins/binge/`
4. Stash → 设置 → 插件 → 重新加载插件

### 方式二：添加插件源

在 **Stash → 设置 → 插件 → 可用插件 → 添加源** 中添加以下任一 URL：

**推荐（GitHub Pages，需启用 Pages）**：
```
https://k6cc.github.io/binge-cn/plugins/main/index.yml
```

**备用（raw URL，无需启用 Pages，立即可用）**：
```
https://raw.githubusercontent.com/k6cc/binge-cn/main/plugins/main/index.yml
```

> **启用 Pages 步骤**：仓库 → Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / `(root)` → Save。等待 1-2 分钟后 `k6cc.github.io/binge-cn/` 即可访问。

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

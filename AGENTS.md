# AGENTS.md — binge-cn 插件发布与合并检查清单

本文件供 AI（或人）在修改、发布、合并上游时参照。已纳入版本库，为 AI agent 提供发布上下文。

## 当前状态

- 已发布正式版：**v0.8.7**（changelog `8.39` / 修改 96–98）
- 下一次发布：**v0.8.8**（changelog `8.40`，修改从 `99` 起）——以 `汉化及修复.md` 尾部模板区备注为准，发布时同步更新那里的三个值

***

## 一、版本号：每次发布必须同步的位置

| 文件 | 位置 | 说明 |
| --- | --- | --- |
| `package.json` | 第 4 行 | 源码版本号（改动源头） |
| `package-lock.json` | 第 3、9 行 | 运行 `npm install --package-lock-only` 自动更新 |
| `binge.yml` | 第 3 行 | **Stash 插件列表展示的就是它，务必与 package.json 一致** |
| `README.md` | 第 3 行 | 仓库首页版本声明 |
| `汉化及修复.md` | 第 3 行 | 文档头部版本声明 |

## 二、版本说明：每次发布必须补写的位置

1. **`README.md` → 「汉化版变更说明」**：当前系列小节（`#### v0.8.x`）内追加 bullet；跨大版本时新建小节，旧小节归档为合并摘要（`#### v0.4.0–v0.7.9` 区）。
2. **`汉化及修复.md` → 「八、修改记录」**：
   - 正式改动：新建小节 `### 8.N v版本 <标题>（修改 N–M）`，插在「⬇️ 最新增量区」之前、上一个已归档小节之后；格式「修改 N：标题 → **文件** / **问题** / **修复** / **验证**」；
   - 未发版小改动：追加到尾部「未分版本的临时记录」，编号接续；
   - 发布归档时：临时记录移入新版本小节，**同类型修改合并、只记最终实现**（不逐条照抄），模板区备注三个值推进到下一版。

## 三、发布流程

1. 完成代码修改 → 同步第一节 5 处版本号 → 补写第二节版本说明。
2. `npm run build` 验证构建通过（`dist/index.html` 单文件 SPA，不入库）。
3. 提交改动，打 tag 并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`。
4. `release.yml` 自动：构建 → 打包 zip（4 文件根层级）→ 计算 sha256 → 更新 stash-plugins 仓库 → 创建 Release。
5. CI 若因未配置 `STASH_PLUGINS_TOKEN` secret 跳过 index.yml 更新：必须手动更新 `k6cc/stash-plugins` 的 `plugins/main/index.yml`（version/date/path/sha256）。

**易遗漏**：

- `plugins/main/index.yml` 不在本仓库（`k6cc/stash-plugins`），发布后检查是否已同步。
- binge.yml version、zip 文件名、GitHub tag 三者必须同版本号。
- tag 名必须 `v*.*.*` 格式，否则 workflow 不触发；打 tag 前执行第八节 tag 撞名预防流程。
- 纯文档发布的版本 bump 同样同步全部 5 处版本号。

## 四、论坛介绍文章（forum-post-binge.md）

Discourse 论坛帖：https://discourse.stashapp.cc/t/binge-fork/13843。更新时在仓库根目录写 `forum-post-binge.md`（`.gitignore` 已排除），用户手动粘贴到论坛帖。

- **更新时机**：仅大型功能性重构（新功能模块、安装方式/依赖变化、数据源能力变更）才更新；性能优化、UI 微调、bug 修复等增量版本不更新（v0.8.7 即属不更新之列）。
- **写作规则**（极简优先，篇幅以现有 forum-post-binge.md 为基准）：
  - **只写**：fork 定位（汉化 + 修复，vs 上游）、各功能模块一句话职责、安装方式、依赖、配套插件；模块小节正文 ≤ 3 句。
  - **禁写**：机制枚举括号、行为尾注、举例对比、入口总述、hover/徽章/交互逻辑、字段级枚举、操作与提交细节、后果推导、实现注脚（react-i18next / PluginApi 式说明）、UI 细节与底层实现（属 README 内容）。
  - 注意事项归拢一处条目化，每条一句；英文写作，保留原帖框架与语气；版本号写 `binge.yml` 的 `version:`。

## 五、沟通规则

- **用户描述有歧义时暂停修改**：先复述理解与用户确认，一致后再动手；禁止按猜测直接实现（2026-09-08 事故：把"联动未生效的 bug 报告"误解为"要求解除联动"，方向相反）。

## 六、文件修改规则

- **单文件只能串行修改**：同一文件多处编辑必须逐个调用，等上一次返回后再执行下一次；禁止并行编辑同一文件——并行会导致前一修改被回退丢失。

## 七、合并上游源码注意事项

上游某些模块在本仓库已被**彻底重构成完全不同的功能**（文件名相近、逻辑与语义完全分叉）。当作"上游同款模块"做常规三方合并会把定制实现整体破坏。

### 已彻底重构的区域

- **演员图片分页 → 图库功能**：数据源、分页机制、UI 层全部不同。上游对该区域的变更**不能套用**，冲突保留本仓库版本；仅纯文案/样式且不涉及数据链的改动才考虑吸收。
- **合并清单阶段识别法**：逐文件分析前，凡涉及上述区域的条目一律标注"已重构，需人工核对"，不按普通冲突预估工作量。

### 可预知的合并风险（按影响面排序）

1. **i18n 键同步（最高频）**：本仓库全部文案包在 `t()` 里，上游是裸英文字符串，文案改动必然手工。上游新增 UI 元素必须建键同步 zh/en，合并后跑 `node scripts/i18n/scan_missing_keys.cjs` 校验零缺失；漏建键运行时直接显示键名。
2. **stashdb.org 参数化 vs 上游硬编码**：本仓库经 `getSourceBox()` 参数化（查询/关注/AddScene/缓存 key 均含源 host）。上游查询改动需重新走参数化路径，直接套用破坏多源支持。
3. **newScenes 共享缓存**：stories 与 discovery costar 共享缓存 + in-flight 去重 + SWR（修改 94–96），上游是两条独立查询。上游改动必须落到共享路径，照搬会复活重复请求（18 批量请求回归）。
4. **SettingsPage.tsx 结构分叉**：本仓库独有行组件（语言/数据源/图库忽略/库文件夹/预告窗口等），上游有未吸收的 demoMode——该文件每次合并必然整体手工。
5. **global.css 规则顺序敏感（静默损坏风险）**：全屏 UI / 竖屏联动（`--binge-nav-lift`）/ fs-collapsed 等规则的优先级依赖定义顺序。git 合并可能**无冲突标记**地打乱块顺序 → 样式静默失效，合并后必须核对关键块相对顺序。
6. **App.tsx 根结构**：`.binge-app` 挂 React 驱动的 `nav-contracted` 类切换（BingeAppRoot）——上游改动不能破坏该挂载点，不得回退成 CSS `:has()` 方案（用户浏览器实测失效）。
7. **已删除模块**：filter/presets、AllPerformersModal 等。上游改动出现 "deleted by us" 冲突默认保持删除；确有值得吸收的新能力按新功能开发处理。
8. **SceneSlide.tsx 播放页定制**：全屏 UI 显隐、字幕自定义定位（ResizeObserver）、随机时段播放、循环时长全屏中断等本地逻辑密集，上游播放器改动需逐条比对语义。

### 冲突解决原则（v0.7.5 合并实录，详见 汉化及修复.md 8.28）

- **已删除文件保持删除**，上游有改动也不复活。
- **重构区域本仓库优先**：GalleryFeedCard / ImageLightbox / PerformerImageGrid 保留本地两层图库架构，仅吸收安全修复与无限滚动修复。
- **重度冲突逐点融合**：SettingsPage.tsx（17 处）采纳上游布局 + 保留本地 i18n；StoryViewer.tsx（9 处）同理。
- **函数签名变更适配而非套用**：如 `getNewStashDBScenesForPerformers` 返回 null 表示部分失败，不计成功、不覆盖缓存。
- **新并入模块补 i18n**：上游无 i18n，新 UI 模块逐个建键（v0.7.5 曾补 8 键）。
- **收尾全量构建 + 冒烟**：曾发生遗漏上游新文件（packHandoff.ts）与误删导入（useTab）——build 通过只是底线，播放/故事/设置主链路需实际点过。

### 上游 tag 撞名预防（2026-09-04 事故教训）

上游 `ordureconnoisseur/binge` 每次发布打 tag（已到 v0.12.x），`git fetch/pull upstream` 默认顺带拉取，累积后必与本仓库未来版本号撞名；v0.8.0 曾因此把上游旧 commit 推上远程、触发错误发布。

1. **一次性配置（已落地）**：`git config remote.upstream.tagOpt --no-tags`
2. **合并后自查**：本地多出 origin 上不存在的 tag 即遗留。
3. **一键清理（打新 tag 之前执行）**：`git fetch origin --prune --prune-tags`（未 push 的新建 tag 也会被删）。
4. **打 tag 前核对**：`git tag -l v<版本号>` 无同名；创建后 `git rev-parse <tag>` 与 `git rev-parse HEAD` 一致再 push（PowerShell 下用裸 tag 名比对，`^{commit}` 会被转义）。

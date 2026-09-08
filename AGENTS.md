# AGENTS.md — binge-cn 插件发布检查清单

本文件供 AI（或人）在修改并发布 binge 插件时参照，确保**版本号**与**版本说明**不遗漏。
注意：本文件已纳入版本库，专门用于给 AI agent 提供发布上下文。

## 当前状态

- 已发布正式版：**v0.8.4**（合并上游 0.14.1–0.14.2：玻璃胶囊镜头化 + Reel 底部倒影霜带，changelog 小节 `8.36` / 修改 80–81；v0.7.x 系列已归档为 README 合并摘要）

- 下一次发布建议：**v0.8.5**（changelog 小节编号 `8.37`，修改序号从 `修改 82` 起）——以 `汉化及修复.md` 尾部模板区备注为准，发布时同步更新那里的三个值。

***

## 一、版本号：每次发布必须同步的位置

| 文件                  | 位置          | 内容                      | 说明                                                                    |
| ------------------- | ----------- | ----------------------- | --------------------------------------------------------------------- |
| `package.json`      | 第 4 行       | `"version": "0.8.1"`    | 源码版本号（改动源头）                                                           |
| `package-lock.json` | 第 3 行、第 9 行 | `"version": "0.8.1"`    | 随 package.json 同步；改完运行 `npm install --package-lock-only` 自动更新，或手动同步两处 |
| `binge.yml`         | 第 3 行       | `version: 0.8.1`        | **Stash 插件清单版本号，Stash 插件列表展示的就是它，用户最直接可见，务必与 package.json 一致**        |
| `README.md`         | 第 3 行       | `当前版本 **v0.8.1**`       | 仓库首页版本声明                                                              |
| `汉化及修复.md`          | 第 3 行       | `> **插件版本**: v0.8.1（…）` | 文档头部版本声明                                                              |

## 二、版本说明：每次发布必须补写的位置

1. **`README.md`** **→ 「汉化版变更说明」**（约第 21 行起）

   - 在当前版本系列小节（现为 `#### v0.8.x`）内追加本次版本的功能/修复 bullet；

   - 若跨大版本（如进入 v0.9.x），新建 `#### v0.9.x` 小节，并把旧的 `v0.8.x` 小节内容归档为合并摘要（当前合并摘要区为 `#### v0.4.0–v0.7.9`，归档时并入为 `v0.4.0–v0.8.x`）。

2. **`汉化及修复.md`** **→ 「八、修改记录（增量日志）」**（第 551 行起）

   - 正式改动：新建小节 `### 8.34 v0.8.2 <标题>（修改 77–…）`，**插在文档尾部「⬇️ 最新增量区（更新模板）」之前**、紧贴上一个已归档版本小节之后；格式沿用「修改 N：标题 → **文件** / **问题** / **修复** / **验证**」，文首写明版本号；

   - 未分版本的小改动：先追加到「未分版本的临时记录」（文档尾部，编号接续）；

   - 发布归档时：把「未分版本的临时记录」内容移入新版本小节，并\*\*更新模板区备注里的「小节编号 / 版本号 / 修改序号」\*\*为下一个值。

## 三、发布流程

1. 完成代码修改 → 同步第一节的 5 处版本号 → 补写第二节的版本说明。
2. `npm run build`（`tsc -b && vite build`）验证构建通过，产出 `dist/index.html` 单文件 SPA（`dist/` 不入库）。
3. 提交改动，打 tag `v0.7.10` 并推送：`git tag v0.7.10 && git push origin v0.7.10`。
4. `.github/workflows/release.yml` 自动执行：

   - 构建 → 打包 `binge-v0.7.10.zip`（内含 4 个文件，根层级无子目录：`binge.yml`、`binge.entry.js`、`index.html`、`binge-install.py`）；

   - 计算 zip 的 sha256 + 北京时间戳 + 下载 URL；

   - 若配置了 `STASH_PLUGINS_TOKEN` secret：自动 clone `k6cc/stash-plugins` 仓库并更新 `plugins/main/index.yml` 的 `version / date / path / sha256` 后 push；

   - 创建 GitHub Release 并上传 zip。
5. **若 CI 因未配置 secret 跳过了 index.yml 更新**：必须手动 clone `k6cc/stash-plugins`，更新其 `plugins/main/index.yml`（version/date/path/sha256），否则 Stash 插件源仍指向旧版本。

## 四、易遗漏提醒

- `plugins/main/index.yml` **不在本仓库**，位于独立的 `k6cc/stash-plugins` 仓库（commit 4ba6950 迁移），发布后务必检查它是否已同步。

- `binge.yml` 的 version、zip 文件名、GitHub tag 三者必须统一为同一版本号，否则 Stash 内显示的版本与 Release 名不一致。

- tag 名必须是 `v*.*.*` 格式（如 `v0.8.1`），否则 release workflow 不触发。

- **避免撞名上游遗留 tag（根因 + 预防，2026-09-04 事故教训）**：上游 `ordureconnoisseur/binge` 每次发布都打 tag（其版本线已到 v0.12.x），而 `git fetch / pull upstream` 默认会顺带拉取指向所拉历史的 tag，累积后必与本仓库未来版本号撞名（`git tag` 报 "already exists" 即命中；v0.8.0 曾因此把上游旧 commit 推上远程、触发上游版 workflow 发布错误产物，已删 release + tag 后在正确 commit 重建）。

  1. **一次性配置（根治）**：`git config remote.upstream.tagOpt --no-tags` —— 此后对该 remote 的 fetch / pull 不再自动拉 tag（2026-09-07 已配置落地）。
  2. **合并上游后自查**：`git ls-remote --tags upstream` 可看上游全部 tag；本地多出 origin 上不存在的 tag 即遗留。
  3. **一键清理**：`git fetch origin --prune --prune-tags` —— 删除所有 origin 上不存在的本地 tag，使本地 tag 与远程发布 tag 对齐（本地与 origin 已核实一致；注意：未 push 的新建 tag 也会被删，须在打新 tag **之前**执行）。
  4. **打 tag 前最后核对**：`git tag -l v<版本号>` 确认无同名遗留；创建后 `git rev-parse <tag>` 与 `git rev-parse HEAD` 输出一致再 push（PowerShell 下写 `^{commit}` 会被转义，用裸 tag 名比对即可）。

- 本地 `release/`、`screenshots/`、`drafts/` 目录已于 2026-08-31 仓库清理时删除（release 旧 zip 仅历史留档、screenshots 已从 README 移除引用）；发布产物完全由 GitHub tag 触发的 CI 生成并上传 Release，无需在仓库内留档 zip/截图。

- 发布前用 `git status` 确认无未提交改动，避免版本号改了却漏提交。

- 仅改 README/文档、不改源码的发布（纯版本号 bump），同样要同步第一节全部 5 处版本号。

## 五、论坛介绍文章（forum-post-*.md）

Discourse 论坛帖（Binge (fork)，https://discourse.stashapp.cc/t/binge-fork/13843）内容会随插件迭代滞后。更新论坛介绍时，在仓库根目录写 `forum-post-binge.md`（已被 `.gitignore` 排除、不随仓库发布），用户手动粘贴/编辑到论坛帖。

写作规则（极简优先，读者是论坛用户不是开发者；篇幅与详略以现有 `forum-post-binge.md` 为基准，超出即视为写复杂了）：

- **只写**：fork 定位（汉化 + 修复，何时选它 vs 上游）、各功能模块一句话职责、安装方式、依赖、配套插件；每个模块小节正文 ≤ 3 句（表格/条目另计）
- **Summary 表一句定位**：主操作 + 纯 Web 声明（Web plugin, no Python），不加机制枚举括号、不加行为尾注
- **禁举例**：规则直接写规则本身，名字/链接/大小写对比式的示例一律不写
- **禁入口总述与 UI 状态**：不写「菜单 → 面板有哪些标签页」入口总述（模块名由小节标题承载）、hover 提示内容、徽章数据清单、折叠/开关的交互逻辑
- **禁字段级枚举**：修复/写回行为只留方向性一句（如「fills only blanks, never overwrites」），不逐字段列规则
- **禁操作与提交细节**：逐条提交方式、失败跳过、完成后重扫时机均不写
- **禁后果推导与实现注脚**：规则后不追加「会导致什么」（匹配不到/挂起/漏报等推导）；不写 react-i18next / PluginApi / hash router 式实现说明、算法步骤链（超时数值→预算对齐）；模块定位性动机（Hi stashers 开场致谢上游、模块首句问题引入）除外
- **兜底不写**：其余 UI 交互细节（按钮行为/折叠展开/开关位置/颜色尺寸）、底层实现（构建/架构/observer）、功能开发逻辑——这些属于 README 的内容
- **注意事项归拢一处**：条目化，每条一句话，不展开「因为什么/会造成什么」
- 语言英文，保留原帖框架（Summary 表 + Hi stashers 开场 + 章节结构）与语气；截图过时则移除占位，发帖时现截现传；版本号写当前发布版本（`binge.yml` 的 `version:`）

## 六、沟通规则

- **用户描述有歧义时，暂停修改**：先向用户复述自己的理解并与用户确认（用选项或直接提问澄清歧义点），确认一致后再动手。禁止在未确认的情况下按自己的猜测直接实现（2026-09-08 事故：把「联动未生效的 bug 报告」误解为「要求解除联动」，方向完全相反）。


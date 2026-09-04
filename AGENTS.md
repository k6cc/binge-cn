# AGENTS.md — binge-cn 插件发布检查清单

本文件供 AI（或人）在修改并发布 binge 插件时参照，确保**版本号**与**版本说明**不遗漏。
注意：本文件已纳入版本库，专门用于给 AI agent 提供发布上下文。

## 当前状态
- 已发布正式版：**v0.8.0**（发现数据源可配置 + UI 源名动态化 + 构建产物补全，changelog 小节 `8.32` / 修改 74–75；v0.7.x 系列已归档为 README 合并摘要）
- 下一次发布建议：**v0.8.1**（changelog 小节编号 `8.33`，修改序号从 `修改 76` 起）——以 `汉化及修复.md` 尾部模板区备注为准，发布时同步更新那里的三个值。

---

## 一、版本号：每次发布必须同步的位置

| 文件 | 位置 | 内容 | 说明 |
|---|---|---|---|
| `package.json` | 第 4 行 | `"version": "0.8.0"` | 源码版本号（改动源头） |
| `package-lock.json` | 第 3 行、第 9 行 | `"version": "0.8.0"` | 随 package.json 同步；改完运行 `npm install --package-lock-only` 自动更新，或手动同步两处 |
| `binge.yml` | 第 3 行 | `version: 0.8.0` | **Stash 插件清单版本号，Stash 插件列表展示的就是它，用户最直接可见，务必与 package.json 一致** |
| `README.md` | 第 3 行 | `当前版本 **v0.8.0**` | 仓库首页版本声明 |
| `汉化及修复.md` | 第 3 行 | `> **插件版本**: v0.8.0（…）` | 文档头部版本声明 |

## 二、版本说明：每次发布必须补写的位置

1. **`README.md` → 「汉化版变更说明」**（约第 21 行起）
   - 在当前版本系列小节（现为 `#### v0.8.x`）内追加本次版本的功能/修复 bullet；
   - 若跨大版本（如进入 v0.9.x），新建 `#### v0.9.x` 小节，并把旧的 `v0.8.x` 小节内容归档为合并摘要（当前合并摘要区为 `#### v0.4.0–v0.7.9`，归档时并入为 `v0.4.0–v0.8.x`）。

2. **`汉化及修复.md` → 「八、修改记录（增量日志）」**（第 551 行起）
   - 正式改动：新建小节 `### 8.33 v0.8.1 <标题>（修改 76–…）`，**插在文档尾部「⬇️ 最新增量区（更新模板）」之前**、紧贴上一个已归档版本小节之后；格式沿用「修改 N：标题 → **文件** / **问题** / **修复** / **验证**」，文首写明版本号；
   - 未分版本的小改动：先追加到「未分版本的临时记录」（第 4344 行，编号接续）；
   - 发布归档时：把「未分版本的临时记录」内容移入新版本小节，并**更新模板区备注里的「小节编号 / 版本号 / 修改序号」**为下一个值。

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
- 本地 `release/`、`screenshots/`、`drafts/` 目录已于 2026-08-31 仓库清理时删除（release 旧 zip 仅历史留档、screenshots 已从 README 移除引用）；发布产物完全由 GitHub tag 触发的 CI 生成并上传 Release，无需在仓库内留档 zip/截图。
- 发布前用 `git status` 确认无未提交改动，避免版本号改了却漏提交。
- 仅改 README/文档、不改源码的发布（纯版本号 bump），同样要同步第一节全部 5 处版本号。

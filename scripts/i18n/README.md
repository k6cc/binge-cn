# i18n 自动化工具

六个可重复运行的 Node.js 脚本（`.cjs`），用于 i18n 翻译键的维护、校验与 bundle 体积分析。

## 脚本一览

| 脚本 | 用途 | 运行频率 |
|-|-|-|
| `scan_missing_keys.cjs` | 扫描源码中所有 `t()` 调用，找出 zh.ts / en.ts 中缺失的键 | 新增组件后 |
| `find_hardcoded_chinese.cjs` | 扫描源码中未用 `t()` 包裹的硬编码中文字符串 | 新增组件后 |
| `sync_en_from_source.cjs` | 将 en.ts 与英文源码对比，自动同步大小写/空格/标点 | 英文源码升级后 |
| `validate_en.cjs` | 校验 en.ts：空值、中文字符、`{{*}}` 残留 | 翻译修改后 |
| `remove_fallbacks.cjs` | 批量移除 `t()` 调用中的 fallback 字符串 | 一次性 / 清理时 |
| `analyze_bundle.cjs` | 分析 i18n bundle 体积构成（i18next / locale / fallback） | 体积优化时 |

## 使用方法

在项目根目录运行：

```bash
# 1. 检查是否有缺失的翻译键
node scripts/i18n/scan_missing_keys.cjs

# 2. 检查是否有遗漏的硬编码中文
node scripts/i18n/find_hardcoded_chinese.cjs

# 3. 英文源码升级后，同步 en.ts
node scripts/i18n/sync_en_from_source.cjs

# 4. 校验 en.ts 完整性（空值 / 中文残留 / {{*}} 残留）
node scripts/i18n/validate_en.cjs

# 5. 批量移除 t() 调用中的 fallback 字符串（不可逆，建议先 git commit）
node scripts/i18n/remove_fallbacks.cjs

# 6. 分析 i18n bundle 体积构成
node scripts/i18n/analyze_bundle.cjs
```

## 输出位置

所有输出写入 `scripts/i18n/output/`：

```
scripts/i18n/output/
├── missing_keys.json          # 缺失键（JSON，含文件位置和回退值）
├── missing_keys_flat.txt      # 缺失键（人类可读，键<TAB>回退值<TAB>位置）
├── hardcoded_chinese.json     # 硬编码中文（JSON，含文件和行号）
└── en_sync_report.txt         # en.ts 同步报告（匹配/更新/未匹配）
```

## 典型工作流

### 新增功能组件后

```bash
# Step 1: 检查缺失键 → 补到 zh.ts 和 en.ts
node scripts/i18n/scan_missing_keys.cjs

# Step 2: 检查硬编码中文 → 迁移为 t() 调用
node scripts/i18n/find_hardcoded_chinese.cjs
```

### 英文源码升级后

```bash
# Step 1: 同步 en.ts（自动修正大小写/空格/标点差异）
node scripts/i18n/sync_en_from_source.cjs

# Step 2: 检查报告中的 "Unmatched" 部分
#        — 250 个左右是 binge-cn 新增功能，属正常
#        — 新出现的 Unmatched 可能是英文源码新增的 UI 文本，需人工翻译

# Step 3: 检查是否有新的缺失键
node scripts/i18n/scan_missing_keys.cjs
```

## 配置

`sync_en_from_source.cjs` 顶部可调整英文源码路径：

```javascript
const EN_SOURCE_DIR = path.resolve(projectRoot, "..", "binge", "src");
// 默认: E:\Temp\binge-i18n\binge\src
```

如果英文源码在其他位置，修改此变量即可。

## 注意事项

- **`scan_missing_keys.cjs`** 能正确解析嵌套的 `export default { translation: { ... } }` 结构，包括字符串中包含 `//`（如 URL `http://...`）的情况。
- **`find_hardcoded_chinese.cjs`** 会自动排除 `t()` 调用内的回退字符串和代码注释，只报告真正需要迁移的硬编码。部分硬编码中文是有意保留的（如 Stash tag 名称、API 错误消息、代码注释），报告中的条目需人工判断。
- **`sync_en_from_source.cjs`** 只自动修正大小写/空格/标点差异，不改变翻译措辞。插值变量名（`{{name}}`、`{{count}}` 等）始终保持 en.ts 原值不变。250 个左右的 "Unmatched" 是 binge-cn 新增功能（Scribe、Pack、DiscoveryFeed 等），属正常现象。
- **`validate_en.cjs`** 只读不写，快速检查 en.ts 是否有空值、非注释行中的中文字符、以及 `{{*}}` 残留（i18next 已废弃的嵌套语法）。无问题时输出 `✓ No issues found.`
- **`remove_fallbacks.cjs`** 会直接改写 `src/` 下所有 `.ts` / `.tsx` 文件，**不可逆**。仅应在 locale 文件已验证 0 缺失键后运行，运行前建议先 `git commit`。两种模式：`t("key", "fallback")` → `t("key")` 和 `t("key", "fallback", {…})` → `t("key", {…})`。
- **`analyze_bundle.cjs`** 只读不写，统计 i18next 库源码体积、locale 文件体积、以及 `t()` 调用中 fallback 字符串的数量和估算开销，用于判断是否需要运行 `remove_fallbacks.cjs`。

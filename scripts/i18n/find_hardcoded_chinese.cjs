// Find hardcoded Chinese strings that are NOT in t() calls and NOT in comments.
// These are the ones that need to be migrated to use t().
// Run from project root:  node scripts/i18n/find_hardcoded_chinese.cjs
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const outputDir = path.join(__dirname, "output");

function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            if (name === "i18n" || name === "node_modules" || name === "dist") continue;
            walk(p, out);
        } else if (/\.(ts|tsx)$/.test(name)) {
            out.push(p);
        }
    }
    return out;
}

const files = walk(path.join(projectRoot, "src"));
const chineseRe = /[\u4e00-\u9fa5]/;
const results = [];

files.forEach((file) => {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
        if (!chineseRe.test(line)) return;

        const trimmed = line.trim();

        // Skip pure comments
        if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

        // Skip lines that are entirely a comment block close
        if (trimmed === "*/") return;

        // Skip lines inside block comments — heuristic: line has /* earlier
        const codeStart = line.search(/\S/);
        if (codeStart >= 0) {
            const beforeCode = line.slice(0, codeStart);
            // If line starts with * (block comment continuation), skip
            if (beforeCode.trim().endsWith("*") || beforeCode.trim() === "*") return;
        }

        // Check if the Chinese is inside a t(...) call's fallback string.
        // We strip out the t() calls and see if any Chinese remains.
        let withoutT = line;
        // Repeatedly strip t("key", "fallback") patterns
        const tCallRe = /\bt\(\s*["'`](["'`]|[^"'`])*?["'`]\s*,\s*(?:"[^"]*"|'[^']*'|`[^`]*`)/g;
        withoutT = withoutT.replace(tCallRe, "");

        // Also strip tFunc(...) calls (used in SettingsPage)
        withoutT = withoutT.replace(/\btFunc\(\s*["'`]([^"'`]|["'`])*?["'`]\s*,\s*(?:"[^"]*"|'[^']*'|`[^`]*`)/g, "");

        // Strip any remaining comment portion
        const commentIdx = withoutT.indexOf("//");
        if (commentIdx >= 0) withoutT = withoutT.slice(0, commentIdx);

        // If Chinese still remains, it's hardcoded
        if (chineseRe.test(withoutT)) {
            results.push({
                file: path.relative(projectRoot, file),
                line: idx + 1,
                content: line.trim(),
            });
        }
    });
});

console.log(JSON.stringify(results, null, 2));
console.log(`\nTotal: ${results.length} lines with hardcoded Chinese strings`);

// Write JSON output
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, "hardcoded_chinese.json");
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
console.log(`\nWrote ${path.relative(projectRoot, jsonPath)}`);

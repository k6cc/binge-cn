// Remove fallback strings from all t() calls.
// t("key", "fallback")        → t("key")
// t("key", "fallback", {…})   → t("key", {…})
const fs = require("fs");
const { execSync } = require("child_process");

const files = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

let totalRemoved = 0;

for (const file of files) {
    let content = fs.readFileSync(file, "utf8");
    let removed = 0;

    // Pattern 1: t("key", "fallback")  →  t("key")
    content = content.replace(
        /t\(("|')([\w.]+)\1,\s*("|')([^"'\n]*?)\3\)/g,
        (_m, q1, key) => { removed++; return `t(${q1}${key}${q1})`; }
    );

    // Pattern 2: t("key", "fallback", {...})  →  t("key", {...})
    content = content.replace(
        /t\(("|')([\w.]+)\1,\s*("|')([^"'\n]*?)\3,\s*/g,
        (_m, q1, key) => { removed++; return `t(${q1}${key}${q1}, `; }
    );

    if (removed > 0) {
        fs.writeFileSync(file, content, "utf8");
        totalRemoved += removed;
        console.log(`  ${file}: ${removed} removed`);
    }
}

console.log(`\nTotal: ${totalRemoved} fallback strings removed.`);

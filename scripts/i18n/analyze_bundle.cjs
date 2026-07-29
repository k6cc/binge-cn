// Analyze bundle size breakdown for i18n
const fs = require("fs");

function sz(p) {
    try { return Math.round(fs.statSync(p).size / 1024) + "KB"; }
    catch { return "n/a"; }
}

console.log("=== i18next library (source, unminified) ===");
console.log("i18next core:", sz("node_modules/i18next/dist/esm/i18next.js"));
console.log("react-i18next:", sz("node_modules/react-i18next/dist/es/react-i18next.esm.js"));

console.log("\n=== locale files (source) ===");
console.log("zh.ts:", sz("src/i18n/locales/zh.ts"));
console.log("en.ts:", sz("src/i18n/locales/en.ts"));
console.log("config.ts:", sz("src/i18n/config.ts"));

// Count fallback strings across all source files
const { execSync } = require("child_process");
const files = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', { encoding: "utf8" })
    .trim().split("\n").filter(Boolean);

let totalFallback = 0;
let filesWithFallback = 0;
for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    const matches = content.match(/t\(["'][^"']+["']\s*,\s*["'`]/g);
    if (matches) {
        totalFallback += matches.length;
        filesWithFallback++;
    }
}
console.log("\n=== fallback strings (t() with 2nd arg) ===");
console.log("Total t() calls with fallback:", totalFallback);
console.log("Files with fallback:", filesWithFallback);
console.log("Estimated fallback overhead: ~" + Math.round(totalFallback * 15 / 1024) + "KB");

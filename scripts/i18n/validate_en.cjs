// Quick validation: check en.ts for empty values, Chinese chars, and {{*}} residue.
const fs = require("fs");
const en = fs.readFileSync("src/i18n/locales/en.ts", "utf8");
const lines = en.split("\n");
let issues = 0;

lines.forEach((line, i) => {
    const m = line.match(/^\s*(\w+):\s*"([^"]*)"/);
    if (m && !m[2].trim()) {
        console.log(`Line ${i + 1}: empty value for ${m[1]}`);
        issues++;
    }
    if (/[\u4e00-\u9fa5]/.test(line) && !line.trim().startsWith("//")) {
        console.log(`Line ${i + 1}: Chinese in en.ts: ${line.trim()}`);
        issues++;
    }
});

const starCount = (en.match(/\{\{\*\}\}/g) || []).length;
console.log(`{{*}} count: ${starCount}`);
console.log(issues === 0 ? "✓ No issues found." : `Found ${issues} issues.`);

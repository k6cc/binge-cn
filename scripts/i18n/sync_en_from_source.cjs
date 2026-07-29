// Sync en.ts translations with English source code.
//
// Extracts all hardcoded strings from the English source, matches them
// against en.ts values, and auto-updates en.ts for case/spacing/punctuation
// differences (prioritizing the English source). Outputs a report for
// manual review of unmatched or wording-different entries.
//
// Usage:  node scripts/i18n/sync_en_from_source.cjs
//
// Config:  adjust EN_SOURCE_DIR below if the English source moves.

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..");
const enLocalePath = path.join(projectRoot, "src/i18n/locales/en.ts");
// English source's src/ folder (sibling of binge-cn under binge-i18n/)
const EN_SOURCE_DIR = path.resolve(projectRoot, "..", "binge", "src");
const outputDir = path.join(__dirname, "output");

// ─── 1. Walk English source, collect all string literals ───────────────────

function walkSrc(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            if (name === "node_modules" || name === "dist" || name === "i18n") continue;
            walkSrc(p, out);
        } else if (/\.(ts|tsx)$/.test(name)) {
            out.push(p);
        }
    }
    return out;
}

function extractStrings(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const strings = new Map(); // normalized → Set<original>

    // Strip comments first (but preserve strings containing //)
    let src = "";
    let inStr = false, quote = "", inLineComment = false, inBlockComment = false;
    for (let i = 0; i < content.length; i++) {
        const c = content[i], next = content[i + 1];

        if (inLineComment) {
            if (c === "\n") { inLineComment = false; src += c; }
            continue;
        }
        if (inBlockComment) {
            if (c === "*" && next === "/") { inBlockComment = false; i++; }
            continue;
        }
        if (inStr) {
            src += c;
            if (c === "\\") { src += next ?? ""; i++; continue; }
            if (c === quote) inStr = false;
            continue;
        }
        if (c === "/" && next === "/") { inLineComment = true; continue; }
        if (c === "/" && next === "*") { inBlockComment = true; i++; continue; }
        if (c === '"' || c === "'" || c === "`") { inStr = true; quote = c; src += c; continue; }
        src += c;
    }

    // Extract double-quoted and single-quoted strings
    const dqRe = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    const sqRe = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
    // Extract template literals (capture static parts + ${...} as {{*}})
    const tqRe = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;

    function addString(raw) {
        // Unescape
        const value = raw
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, "\\");
        // Skip empty, pure identifiers, CSS classes, URLs, file paths
        if (!value.trim()) return;
        if (/^[a-z][a-zA-Z0-9_-]*$/.test(value) && !value.includes(" ")) return; // camelCase/kebab-case identifier
        if (/^https?:\/\//.test(value)) return;
        if (/\.(ts|tsx|js|jsx|css|png|jpg|svg|yml|yaml|json)$/i.test(value)) return;

        const norm = normalize(value);
        if (!strings.has(norm)) strings.set(norm, new Set());
        strings.get(norm).add(value);
    }

    let m;
    dqRe.lastIndex = 0;
    while ((m = dqRe.exec(src))) addString(m[1]);
    sqRe.lastIndex = 0;
    while ((m = sqRe.exec(src))) {
        // Skip single-char strings used as enum values
        if (m[1].length <= 1) continue;
        addString(m[1]);
    }
    tqRe.lastIndex = 0;
    while ((m = tqRe.exec(src))) {
        // Replace ${...} with {{*}} for matching with i18n interpolation
        const converted = m[1].replace(/\$\{[^}]+\}/g, "{{*}}");
        addString(converted);
    }

    return strings;
}

function normalize(s) {
    return s
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[…]/g, "...")  // Normalize ellipsis
        .replace(/[""'']/g, "'")  // Normalize quotes
        .replace(/\{\{[^}]+\}\}/g, "{{*}}")  // Normalize interpolation
        .trim();
}

// ─── 2. Parse en.ts locale keys ─────────────────────────────────────────────

function parseLocaleKeys(content) {
    const keys = new Map();
    const stack = [];
    let i = 0;
    while (i < content.length) {
        const c = content[i];
        if (/\s/.test(c)) { i++; continue; }

        // Line comment
        if (c === "/" && content[i + 1] === "/") {
            while (i < content.length && content[i] !== "\n") i++;
            continue;
        }
        // Block comment
        if (c === "/" && content[i + 1] === "*") {
            i += 2;
            while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
            i += 2;
            continue;
        }

        const idMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/.exec(content.slice(i));
        if (idMatch) {
            const id = idMatch[1];
            i += idMatch[0].length;
            while (i < content.length && /\s/.test(content[i])) i++;

            if (content[i] === "{") {
                stack.push(id);
                i++;
            } else if (content[i] === '"' || content[i] === "'" || content[i] === "`") {
                const quote = content[i];
                i++;
                let val = "";
                while (i < content.length && content[i] !== quote) {
                    if (content[i] === "\\") {
                        val += content[i] + (content[i + 1] ?? "");
                        i += 2;
                    } else {
                        val += content[i];
                        i++;
                    }
                }
                i++;
                const fullPath = [...stack, id].join(".");
                keys.set(fullPath, val);
            } else {
                while (i < content.length && content[i] !== "," && content[i] !== "}") i++;
            }
            continue;
        }

        if (c === "}") { stack.pop(); i++; continue; }
        if (c === ",") { i++; continue; }
        i++;
    }
    return keys;
}

function parseLocaleKeysStripWrapper(content) {
    const all = parseLocaleKeys(content);
    const stripped = new Map();
    for (const [k, v] of all) {
        const newKey = k.startsWith("translation.") ? k.slice("translation.".length) : k;
        stripped.set(newKey, v);
    }
    return stripped;
}

// ─── 3. Main: match & update ────────────────────────────────────────────────

const sourceFiles = walkSrc(EN_SOURCE_DIR);
console.log(`Scanning ${sourceFiles.length} English source files...`);

// Build source string map: normalized → Set<original>
const sourceStrings = new Map(); // normalized → Set<original>
sourceFiles.forEach((file) => {
    const fileStrings = extractStrings(file);
    for (const [norm, originals] of fileStrings) {
        if (!sourceStrings.has(norm)) sourceStrings.set(norm, new Set());
        for (const o of originals) sourceStrings.get(norm).add(o);
    }
});

console.log(`Extracted ${sourceStrings.size} unique normalized source strings.`);

// Parse en.ts
const enContent = fs.readFileSync(enLocalePath, "utf8");
const enKeys = parseLocaleKeysStripWrapper(enContent);
console.log(`en.ts has ${enKeys.size} keys.\n`);

// Reconstruct source value with original en.ts interpolation variable names.
// sourceValue may have {{*}} placeholders (from ${...} in template literals);
// enValue has real {{name}} / {{count}} etc. We replace {{*}} in the source
// value with the real variables from enValue, preserving their names.
function reconstructValue(sourceValue, enValue) {
    // Extract {{...}} variables from en.ts value, in order
    const enVars = [];
    const varRe = /\{\{(\w+)\}\}/g;
    let m;
    while ((m = varRe.exec(enValue)) !== null) {
        enVars.push(m[0]);
    }
    if (enVars.length === 0) return sourceValue;

    // Replace {{*}} in source value with real variables, in order
    let idx = 0;
    return sourceValue.replace(/\{\{\*\}\}/g, () => {
        if (idx < enVars.length) return enVars[idx++];
        return "{{*}}";
    });
}

// Match
const matched = [];      // exact match — no change needed
const updated = [];      // normalized match — auto-updated
const unmatched = [];    // no match found (binge-cn specific or new)

for (const [key, enValue] of enKeys) {
    const norm = normalize(enValue);

    // Check if normalized version exists in source
    if (sourceStrings.has(norm)) {
        const sourceValues = sourceStrings.get(norm);

        // Check if exact value is in the set
        if (sourceValues.has(enValue)) {
            matched.push({ key, enValue });
        } else {
            // Normalized match — pick the source value closest to en.ts
            // (fewest character differences)
            let bestSource = null;
            let bestDist = Infinity;
            for (const sv of sourceValues) {
                const reconstructed = reconstructValue(sv, enValue);
                const dist = levenshtein(enValue, reconstructed);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestSource = reconstructed;
                }
            }
            // Only update if the reconstructed value actually differs
            if (bestSource !== enValue) {
                updated.push({ key, oldEn: enValue, newEn: bestSource });
            } else {
                matched.push({ key, enValue });
            }
        }
    } else {
        unmatched.push({ key, enValue });
    }
}

// Simple Levenshtein distance for picking closest match
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array(n + 1).fill(0).map((_, i) => i);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            prev = tmp;
        }
    }
    return dp[n];
}

// ─── 4. Auto-update en.ts ────────────────────────────────────────────────────

let updatedContent = enContent;
let updateCount = 0;

for (const { key, oldEn, newEn } of updated) {
    // Find the last segment of the key for context
    const keySeg = key.split(".").pop();
    // Try to replace `keySeg: "oldEn"` → `keySeg: "newEn"`
    // Escape regex special chars in oldEn
    const oldEscaped = oldEn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(${keySeg}\\s*:\\s*)"${oldEscaped}"`, "g");

    if (pattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(pattern, `$1"${newEn}"`);
        updateCount++;
    } else {
        // Fallback: search for the value directly
        const valuePattern = new RegExp(`"${oldEscaped}"`, "g");
        const matches = updatedContent.match(valuePattern);
        if (matches && matches.length === 1) {
            updatedContent = updatedContent.replace(valuePattern, `"${newEn}"`);
            updateCount++;
        } else {
            console.log(`  ⚠ Could not auto-update "${key}" — manual review needed`);
            console.log(`    ${oldEn}  →  ${newEn}`);
        }
    }
}

// Write updated en.ts
if (updateCount > 0) {
    fs.writeFileSync(enLocalePath, updatedContent, "utf8");
}

// ─── 5. Output report ───────────────────────────────────────────────────────

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const report = [];
report.push("=== en.ts Sync Report ===");
report.push(`Source: ${EN_SOURCE_DIR}`);
report.push(`en.ts:  ${enLocalePath}`);
report.push(`Date:   ${new Date().toISOString()}`);
report.push("");
report.push(`Total en.ts keys:    ${enKeys.size}`);
report.push(`Exact matches:        ${matched.length}`);
report.push(`Auto-updated:         ${updateCount}`);
report.push(`Unmatched (skipped):  ${unmatched.length}`);
report.push("");

if (updated.length > 0) {
    report.push("── Auto-updated (case/spacing/punctuation) ──");
    for (const { key, oldEn, newEn } of updated) {
        report.push(`  ${key}`);
        report.push(`    - ${oldEn}`);
        report.push(`    + ${newEn}`);
    }
    report.push("");
}

if (unmatched.length > 0) {
    report.push("── Unmatched (binge-cn specific or new) ──");
    for (const { key, enValue } of unmatched) {
        report.push(`  ${key}\t${enValue}`);
    }
    report.push("");
}

const reportText = report.join("\n");
const reportPath = path.join(outputDir, "en_sync_report.txt");
fs.writeFileSync(reportPath, reportText, "utf8");

console.log(reportText);
console.log(`\nReport written to: ${path.relative(projectRoot, reportPath)}`);
if (updateCount > 0) {
    console.log(`en.ts updated with ${updateCount} changes.`);
}

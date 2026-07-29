// i18n missing-key scanner: parses nested TS object structure of locale files
// and reports which t() keys used in source code are missing from each locale.
// Run from project root:  node scripts/i18n/scan_missing_keys.cjs
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

// Match t("key", "fallback") or t("key", `fallback`) or t("key", 'fallback')
// or t("key") — also matches tFunc(...) variant.
const regex = /\bt(?:Func)?\(\s*["']([a-z0-9_.]+)["'](?:\s*,\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`))?/g;

const usedKeys = new Map(); // key -> { fallback, file, line }

files.forEach((file) => {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

        let m;
        regex.lastIndex = 0;
        while ((m = regex.exec(line)) !== null) {
            const key = m[1];
            const fallback = m[2] ?? m[3] ?? m[4] ?? null;
            if (!usedKeys.has(key)) {
                usedKeys.set(key, { fallback, file, line: idx + 1 });
            }
        }
    });
});

// Parse locale file as nested object by walking the structure.
// Strategy: tokenize the file content, track current namespace path,
// and emit "path.key" -> value whenever we see `key: "value"`.
// Handles comments inline (not pre-stripped) to avoid corrupting URLs
// like "http://..." inside string values.
function parseLocaleKeys(content) {
    const keys = new Map(); // "dotted.path" -> value

    // Stack of namespace names
    const stack = [];

    // Walk through tokens
    let i = 0;
    while (i < content.length) {
        const c = content[i];

        // Skip whitespace
        if (/\s/.test(c)) { i++; continue; }

        // Line comment — skip to end of line
        if (c === "/" && content[i + 1] === "/") {
            while (i < content.length && content[i] !== "\n") i++;
            continue;
        }

        // Block comment — skip to closing */
        if (c === "/" && content[i + 1] === "*") {
            i += 2;
            while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
            i += 2; // skip closing */
            continue;
        }

        // Identifier followed by ':' -> a key
        const idMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/.exec(content.slice(i));
        if (idMatch) {
            const id = idMatch[1];
            i += idMatch[0].length;

            // Skip whitespace
            while (i < content.length && /\s/.test(content[i])) i++;

            // Check what follows
            if (content[i] === "{") {
                // Nested object — push to stack
                stack.push(id);
                i++; // skip {
            } else if (content[i] === '"' || content[i] === "'" || content[i] === "`") {
                // String value
                const quote = content[i];
                i++; // skip opening quote
                let val = "";
                while (i < content.length && content[i] !== quote) {
                    if (content[i] === "\\") {
                        // Preserve escape sequence
                        val += content[i] + (content[i + 1] ?? "");
                        i += 2;
                    } else {
                        val += content[i];
                        i++;
                    }
                }
                i++; // skip closing quote
                const fullPath = [...stack, id].join(".");
                keys.set(fullPath, val);
            } else {
                // Other value type — skip to next , or }
                while (i < content.length && content[i] !== "," && content[i] !== "}") i++;
            }
            continue;
        }

        if (c === "}") {
            stack.pop();
            i++;
            continue;
        }

        if (c === ",") { i++; continue; }

        // Skip other characters
        i++;
    }

    return keys;
}

function parseLocaleKeysStripWrapper(content) {
    const all = parseLocaleKeys(content);
    // The file structure is `export default { translation: { ... } }` so
    // all keys are prefixed with "translation.". Strip that prefix.
    const stripped = new Map();
    for (const [k, v] of all) {
        const newKey = k.startsWith("translation.") ? k.slice("translation.".length) : k;
        stripped.set(newKey, v);
    }
    return stripped;
}

const zhKeys = parseLocaleKeysStripWrapper(fs.readFileSync(path.join(projectRoot, "src/i18n/locales/zh.ts"), "utf8"));
const enKeys = parseLocaleKeysStripWrapper(fs.readFileSync(path.join(projectRoot, "src/i18n/locales/en.ts"), "utf8"));

console.log(`zh.ts has ${zhKeys.size} keys`);
console.log(`en.ts has ${enKeys.size} keys`);
console.log(`Source uses ${usedKeys.size} unique keys\n`);

const zhMissing = [];
const enMissing = [];

for (const [key, info] of usedKeys) {
    if (!zhKeys.has(key)) {
        zhMissing.push({ key, ...info });
    }
    if (!enKeys.has(key)) {
        enMissing.push({ key, ...info });
    }
}

console.log(`Missing from zh.ts: ${zhMissing.length}`);
console.log(`Missing from en.ts: ${enMissing.length}`);

// Write outputs to scripts/i18n/output/
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const jsonPath = path.join(outputDir, "missing_keys.json");
fs.writeFileSync(jsonPath, JSON.stringify({
    zhMissing,
    enMissing,
    usedKeys: Object.fromEntries(usedKeys),
}, null, 2));

// Human-readable flat format
const flatPath = path.join(outputDir, "missing_keys_flat.txt");
const flatLines = [];
[...zhMissing, ...enMissing].forEach((m, idx) => {
    // Deduplicate by key (a key missing from both zh and en appears twice)
    if (idx === 0 || zhMissing[idx - 1]?.key !== m.key) {
        flatLines.push(`${m.key}\t${m.fallback ?? ""}\t${m.file}:${m.line}`);
    }
});
fs.writeFileSync(flatPath, flatLines.join("\n"));

console.log(`\nWrote ${path.relative(projectRoot, jsonPath)}`);
console.log(`Wrote ${path.relative(projectRoot, flatPath)}`);

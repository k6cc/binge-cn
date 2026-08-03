// Strip directory + final extension from a path. Handles both Windows
// (\\) and Unix (/) separators. "C:\\Porn\\X\\foo.bar.mp4" → "foo.bar".
// Returns empty when given empty/undefined.
export function basenameNoExt(path: string | undefined): string {
    if (!path) return "";
    const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const filename = lastSep >= 0 ? path.slice(lastSep + 1) : path;
    const lastDot = filename.lastIndexOf(".");
    // Only treat as extension if dot isn't the first char (".hidden").
    return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

// Instagram hashtags are conventionally one camelCase token, no spaces
// or punctuation. Normalize: strip non-word chars, collapse to a single
// run, leave casing alone so "Big Naturals" → "BigNaturals".
export function toHashtag(name: string): string {
    return name
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}
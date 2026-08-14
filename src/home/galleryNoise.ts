// Which galleries are artwork rather than photo sets.
//
// A Stash library is usually full of galleries nobody wants in a feed:
// screenshot sheets, cover art, "proof" packs. They are identified by
// the folder they live in, and which folder names those are is entirely
// a property of one person's disk. So this is a list the user owns, with
// a default that covers the conventions seen most often.
//
// Names match a WHOLE path segment, case-insensitively, so a gallery
// called "Undercover Set" is not caught by "cover". A trailing "*"
// makes it a prefix match, which is how one entry covers Screen,
// Screens, Screenshot, Screenshots, Screenlist and "Screen Previews".

export const DEFAULT_GALLERY_IGNORE_FOLDERS: ReadonlyArray<string> = [
    "screen*",
    "scr",
    "cover",
    "covers",
    "proof",
];

export interface GalleryNoiseMatcher {
    // True when any of the gallery's paths sits in an ignored folder.
    isNoise(paths: readonly string[]): boolean;
}

function segmentsOf(path: string): string[] {
    return path
        .split("\\")
        .join("/")
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
}

export function buildGalleryNoiseMatcher(
    folderNames: readonly string[] = DEFAULT_GALLERY_IGNORE_FOLDERS,
): GalleryNoiseMatcher {
    const exact = new Set<string>();
    const prefixes: string[] = [];
    for (const raw of folderNames) {
        const name = raw.trim().toLowerCase();
        if (!name) continue;
        if (name.endsWith("*")) {
            const stem = name.slice(0, -1);
            // A bare "*" would hide every gallery there is. Treat it as
            // a mistake rather than obeying it.
            if (stem) prefixes.push(stem);
        } else {
            exact.add(name);
        }
    }

    // Nothing configured means nothing is hidden, which has to stay
    // distinguishable from the default list.
    const empty = exact.size === 0 && prefixes.length === 0;

    return {
        isNoise(paths) {
            if (empty) return false;
            for (const path of paths) {
                // The last segment of a gallery path can be the folder
                // itself (folder-based galleries) or a zip file
                // (archive galleries), and both are worth matching: a
                // "Screens.zip" is the same noise as a Screens folder.
                for (const segment of segmentsOf(path)) {
                    const lower = segment.toLowerCase();
                    // Exact names match the segment as it stands, with
                    // no extension stripped: "cover.jpg" is an image
                    // that happens to be called cover, not a folder
                    // called Cover, and hiding its gallery would be
                    // wrong. A prefix entry still catches "Screens.zip",
                    // which is an archive gallery of screenshots.
                    if (exact.has(lower)) return true;
                    if (prefixes.some((p) => lower.startsWith(p))) return true;
                }
            }
            return false;
        },
    };
}

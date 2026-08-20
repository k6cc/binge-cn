// Working out what an unattributed scene belongs to.
//
// Most of what a library like this one imports arrives with no performer
// linked and no studio: 84% of the scenes added in a recent 30-day
// window. Those scenes are not junk, they are unidentified, and the thing
// that identifies them is the folder they sit in, which is normally named
// after whoever or whatever the import came from ("Explicit Kait",
// "Xohanna Joy Video Pack", "TS Webcam Collection 7").
//
// The hard part is knowing where the library ends and the meaningful part
// of the path begins. A fixed list of folder names cannot know that: it
// works for whoever wrote the list and turns "/home/bob/media/Vixen/a.mp4"
// into "bob" for everybody else, which would then collapse that person's
// entire library into one batch named after them.
//
// So the root is measured, not guessed. Every path in the batch is
// compared and their common leading folders are dropped, because whatever
// every scene shares is the library, not a source. Only after that does
// the small vocabulary below get a say, to step over an intermediate
// bucket like "Unfiled" that sits under the shared root.
//
// This is a heuristic and it is only used to GROUP and LABEL cards, never
// to write anything back to Stash. The worst case is a card labelled after
// a folder rather than a person, or one import splitting across two cards.

// Default folder names that describe a library rather than a source,
// used only AFTER the shared root has been removed. Being short and
// generic is the point: the common-prefix step does the real work, and
// this only catches a bucket that some scenes sit in and others do not.
//
// A DEFAULT, not a rule. Anyone whose layout uses a word that is not
// here, or who has a folder legitimately called "New", overrides the
// whole list in Settings; see DEFAULT_LIBRARY_FOLDER_NAMES' use in
// pluginSettings.
export const DEFAULT_LIBRARY_FOLDER_NAMES: ReadonlyArray<string> = [
    "media",
    "video",
    "videos",
    "movies",
    "scenes",
    "clips",
    "porn",
    "adult",
    "unfiled",
    "unsorted",
    "sorted",
    "misc",
    "other",
    "new",
    "downloads",
    "download",
    "complete",
    "completed",
    "incoming",
    "library",
];

// A segment that is only a drive letter or a root marker.
const ROOT_SEGMENT = /^[a-z]:$|^\$|^\.+$/i;

export function normalisePath(path: string): string {
    // Windows and Unix layouts both reach here, and a Windows path
    // survives a round-trip through Stash with its backslashes intact.
    return path.split("\\").join("/");
}

// The folders of a path, filename dropped.
function foldersOf(path: string): string[] {
    const segments = normalisePath(path)
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
    return segments.slice(0, -1);
}

export interface SourceResolver {
    // Studio when Stash knows one, since that is a curated field rather
    // than a guess. Otherwise the first meaningful folder below the
    // library root. Null when the path says nothing useful.
    resolve(studioName: string | null, filePath: string | null): string | null;
}

// How many leading folders every path under a given root shares. Capped
// so at least one folder always survives, or a library whose scenes all
// sit in one directory would resolve to nothing.
function sharedDepth(paths: string[][]): number {
    if (paths.length === 0) return 0;
    const cap = Math.min(...paths.map((p) => p.length)) - 1;
    let depth = 0;
    while (depth < cap) {
        const segment = paths[0][depth];
        if (!paths.every((p) => p[depth] === segment)) break;
        depth++;
    }
    return Math.max(0, depth);
}

// `paths` is every file path in the batch being rendered. Paths are
// grouped by their first segment first, so a library spread over two
// drives keeps a sensible root for each rather than falling back to no
// shared root at all.
export function buildSourceResolver(
    paths: readonly (string | null)[],
    libraryFolderNames: readonly string[] = DEFAULT_LIBRARY_FOLDER_NAMES,
): SourceResolver {
    const containers = new Set(
        libraryFolderNames.map((n) => n.trim().toLowerCase()).filter(Boolean),
    );
    const byRoot = new Map<string, string[][]>();
    for (const path of paths) {
        if (!path) continue;
        const folders = foldersOf(path);
        if (folders.length === 0) continue;
        const root = folders[0];
        const list = byRoot.get(root);
        if (list) list.push(folders);
        else byRoot.set(root, [folders]);
    }

    const depthByRoot = new Map<string, number>();
    for (const [root, list] of byRoot) {
        depthByRoot.set(root, sharedDepth(list));
    }

    return {
        resolve(studioName, filePath) {
            const studio = studioName?.trim();
            if (studio) return studio;
            if (!filePath) return null;
            const folders = foldersOf(filePath);
            if (folders.length === 0) return null;
            const depth = depthByRoot.get(folders[0]) ?? 0;
            for (const segment of folders.slice(depth)) {
                if (ROOT_SEGMENT.test(segment)) continue;
                if (containers.has(segment.toLowerCase())) continue;
                return segment;
            }
            // Everything below the shared root was a container, so the
            // file sits in the library root and nothing names it.
            return null;
        },
    };
}

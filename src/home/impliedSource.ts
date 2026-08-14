// Working out what an unattributed scene belongs to.
//
// Most of what this library imports arrives with no performer linked and
// no studio: 84% of the scenes added in a recent 30-day window. Those
// scenes are not junk, they are unidentified, and the thing that
// identifies them is the folder they sit in, which is normally named
// after whoever or whatever the import came from ("Explicit Kait",
// "Xohanna Joy Video Pack", "TS Webcam Collection 7").
//
// This is a heuristic and it is only used to GROUP and LABEL cards, never
// to write anything back to Stash. The worst case is a card labelled
// after a folder rather than a person, or one import splitting across two
// cards. Nothing is inferred into the library.

// Folder names that describe a library rather than a source. They are
// stepped over when looking for the first meaningful segment, so
// "Z:/Media/Unfiled/Explicit Kait/OnlyFans/clip.mp4" resolves to
// "Explicit Kait" and not to "Media".
const CONTAINER_SEGMENTS: ReadonlySet<string> = new Set([
    "media",
    "unfiled",
    "porn",
    "adult",
    "video",
    "videos",
    "movies",
    "scenes",
    "clips",
    "downloads",
    "download",
    "complete",
    "completed",
    "incoming",
    "new",
    "misc",
    "other",
    "sorted",
    "unsorted",
    "library",
    "files",
    "data",
    "volume1",
    "mnt",
    "home",
    "users",
]);

// A segment that is only a drive letter, a UNC host, or a root marker.
const ROOT_SEGMENT = /^[a-z]:$|^\$|^\.+$/i;

export function normalisePath(path: string): string {
    // Windows and Unix layouts both reach here, and a Windows path
    // survives a round-trip through Stash with its backslashes intact.
    return path.split("\\").join("/");
}

// The name an unattributed scene appears to belong to, or null when the
// path says nothing useful. Studio wins when Stash knows one, because
// that is a real curated field rather than a guess at a folder.
export function impliedSourceName(
    studioName: string | null,
    filePath: string | null,
): string | null {
    const studio = studioName?.trim();
    if (studio) return studio;
    if (!filePath) return null;

    const segments = normalisePath(filePath)
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
    // The last segment is the file itself, never a source name.
    const folders = segments.slice(0, -1);

    for (const segment of folders) {
        if (ROOT_SEGMENT.test(segment)) continue;
        if (CONTAINER_SEGMENTS.has(segment.toLowerCase())) continue;
        return segment;
    }
    // Everything was a container: the file sits directly in the library
    // root, so there is no folder that names anything.
    return null;
}

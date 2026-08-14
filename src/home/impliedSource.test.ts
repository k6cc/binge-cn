import { describe, expect, it } from "vitest";
import { buildSourceResolver, normalisePath } from "./impliedSource";

// What an unattributed scene gets labelled and grouped by. This is a
// guess at a file layout, so the bar is "never confidently wrong": it
// should return null rather than something meaningless, because a null
// leaves the scene as its own card while a bad value silently merges
// unrelated scenes into one batch.
//
// The library root is measured from the paths themselves rather than
// matched against a list of folder names. A list only works for the
// layout whoever wrote it happened to have.

const resolve = (paths: (string | null)[], path: string, studio = null) =>
    buildSourceResolver(paths).resolve(studio, path);

describe("normalisePath", () => {
    it("turns a Windows path into forward slashes", () => {
        expect(normalisePath("Z:\\Media\\Unfiled\\Ada\\clip.mp4")).toBe(
            "Z:/Media/Unfiled/Ada/clip.mp4",
        );
    });

    it("leaves a Unix path alone", () => {
        expect(normalisePath("/data/porn/Ada/clip.mp4")).toBe(
            "/data/porn/Ada/clip.mp4",
        );
    });
});

describe("finding the library root by what the paths share", () => {
    it("does not mistake a home directory for a source", () => {
        // The bug this design exists to prevent. A folder-name list has
        // no way to know "bob" is a person's account and not a studio,
        // so it would label the whole library "bob" and collapse every
        // unidentified scene into one batch.
        const paths = [
            "/home/bob/media/Vixen/a.mp4",
            "/home/bob/media/Tushy/b.mp4",
            "/home/bob/media/Vixen/c.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Vixen");
        expect(resolve(paths, paths[1])).toBe("Tushy");
    });

    it("handles a Windows user profile the same way", () => {
        const paths = [
            "C:/Users/alice/Videos/Stash/Vixen/a.mp4",
            "C:/Users/alice/Videos/Stash/Tushy/b.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Vixen");
    });

    it("handles a NAS share", () => {
        const paths = [
            "/volume1/video/adult/Vixen/a.mp4",
            "/volume1/video/adult/Tushy/b.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Vixen");
    });

    it("handles a server path made of words no list would contain", () => {
        const paths = [
            "/srv/stash/library/Vixen/a.mp4",
            "/srv/stash/library/Tushy/b.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Vixen");
    });

    it("keeps roots separate when a library spans two drives", () => {
        // Sharing nothing across drives must not mean sharing nothing at
        // all: each drive gets its own root measurement.
        const paths = [
            "Z:/Media/Ada/a.mp4",
            "Z:/Media/Bea/b.mp4",
            "D:/Porn/Cleo/c.mp4",
            "D:/Porn/Dee/d.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Ada");
        expect(resolve(paths, paths[2])).toBe("Cleo");
    });

    it("still steps over a bucket that sits under the shared root", () => {
        // Only some scenes are under "Unfiled", so it is not part of the
        // common prefix, and the vocabulary has to catch it.
        const paths = [
            "Z:/Media/Unfiled/Explicit Kait/a.mp4",
            "Z:/Media/Xohanna Joy Video Pack/b.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Explicit Kait");
        expect(resolve(paths, paths[1])).toBe("Xohanna Joy Video Pack");
    });

    it("does not descend past the source into its subfolders", () => {
        // "OnlyFans" is where the files sit, not who they are of, and
        // grouping by it would merge every creator into one batch.
        const paths = [
            "Z:/Media/Unfiled/Explicit Kait/OnlyFans/a.mp4",
            "Z:/Media/Other/b.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe("Explicit Kait");
    });

    it("leaves one folder standing when every scene shares a directory", () => {
        // The cap on the shared depth. Without it, a library whose whole
        // window sits in one folder would resolve to nothing at all.
        const paths = ["Z:/Media/Pack/a.mp4", "Z:/Media/Pack/b.mp4"];
        expect(resolve(paths, paths[0])).toBe("Pack");
    });

    it("copes with a single path, which shares everything with itself", () => {
        const paths = ["Z:/Media/Ada/a.mp4"];
        expect(resolve(paths, paths[0])).toBe("Ada");
    });
});

describe("what it refuses to answer", () => {
    it("returns null with no path and no studio", () => {
        expect(resolve([], null as unknown as string)).toBeNull();
    });

    it("returns null for a bare filename", () => {
        expect(resolve(["a.mp4"], "a.mp4")).toBeNull();
    });

    it("returns null when everything below the root is a container", () => {
        const paths = ["Z:/Media/a.mp4", "Z:/Videos/b.mp4"];
        expect(resolve(paths, paths[0])).toBeNull();
    });
});

describe("studio", () => {
    it("wins, being curated rather than guessed", () => {
        expect(
            buildSourceResolver(["Z:/Media/Whoever/a.mp4"]).resolve(
                "Evil Angel",
                "Z:/Media/Whoever/a.mp4",
            ),
        ).toBe("Evil Angel");
    });

    it("is ignored when it is only whitespace", () => {
        expect(
            buildSourceResolver(["Z:/Media/Ada/a.mp4"]).resolve(
                "   ",
                "Z:/Media/Ada/a.mp4",
            ),
        ).toBe("Ada");
    });
});

describe("names are kept verbatim", () => {
    it("does not try to parse a pack folder into a person", () => {
        // "[Onlyfans.com] Somon (@somonnn)" is not a name, but it IS a
        // stable grouping key and the user recognises it. Cleaning it up
        // would risk collapsing two different packs into one.
        const paths = [
            "Z:/Media/[Onlyfans.com] Somon (@somonnn)/1.mp4",
            "Z:/Media/Other/2.mp4",
        ];
        expect(resolve(paths, paths[0])).toBe(
            "[Onlyfans.com] Somon (@somonnn)",
        );
    });

    it("ignores empty segments from a doubled separator", () => {
        const paths = ["Z://Media//Ada//a.mp4", "Z:/Media/Bea/b.mp4"];
        expect(resolve(paths, paths[0])).toBe("Ada");
    });

    it("matches container names regardless of case", () => {
        const paths = ["Z:/MEDIA/UnFiled/Ada/a.mp4", "Z:/MEDIA/Bea/b.mp4"];
        expect(resolve(paths, paths[0])).toBe("Ada");
    });

    it("does not treat a container word inside a longer name as a container", () => {
        const paths = ["Z:/Media/Media Queen/a.mp4", "Z:/Media/Other/b.mp4"];
        expect(resolve(paths, paths[0])).toBe("Media Queen");
    });
});

// The word list is the user's, not the code's: which intermediate
// folders exist is a property of one person's disk. The default is a
// starting point, and passing a different list has to actually change
// the answer or the setting is decorative.
describe("the folder-name list is configurable", () => {
    const paths = ["Z:/Media/Vault/Ada/a.mp4", "Z:/Media/Bea/b.mp4"];

    it("treats a word nobody could have predicted as a container", () => {
        expect(
            buildSourceResolver(paths, ["vault"]).resolve(null, paths[0]),
        ).toBe("Ada");
    });

    it("stops skipping a default word once the list is replaced", () => {
        // "Unfiled" is in the default list; a user whose own folder is
        // genuinely called that must be able to get it back.
        const p = ["Z:/Media/Unfiled/a.mp4", "Z:/Media/Other/b.mp4"];
        expect(buildSourceResolver(p, []).resolve(null, p[0])).toBe("Unfiled");
    });

    it("ignores blank and mis-cased entries in the list", () => {
        expect(
            buildSourceResolver(paths, [" VAULT ", "", "  "]).resolve(
                null,
                paths[0],
            ),
        ).toBe("Ada");
    });

    it("falls back to the defaults when no list is given", () => {
        const p = ["Z:/Media/Unfiled/Ada/a.mp4", "Z:/Media/Other/b.mp4"];
        expect(buildSourceResolver(p).resolve(null, p[0])).toBe("Ada");
    });
});

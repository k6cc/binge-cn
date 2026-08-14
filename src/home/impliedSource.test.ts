import { describe, expect, it } from "vitest";
import { impliedSourceName, normalisePath } from "./impliedSource";

// What an unattributed scene gets labelled and grouped by. This is a
// guess at a file layout, so the bar is "never confidently wrong": it
// should return null rather than something meaningless, because a null
// leaves the scene as its own card while a bad value silently merges
// unrelated scenes into one batch.

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

describe("impliedSourceName", () => {
    it("prefers the studio, which is curated rather than guessed", () => {
        expect(impliedSourceName("Evil Angel", "Z:/Media/Whoever/a.mp4")).toBe(
            "Evil Angel",
        );
    });

    it("ignores a studio that is only whitespace", () => {
        expect(impliedSourceName("   ", "Z:/Media/Ada/a.mp4")).toBe("Ada");
    });

    it("takes the first folder that is not a library container", () => {
        expect(
            impliedSourceName(null, "Z:\\Media\\Unfiled\\Explicit Kait\\a.mp4"),
        ).toBe("Explicit Kait");
    });

    it("does not descend past the source into its subfolders", () => {
        // "OnlyFans" is where the files sit, not who they are of, and
        // grouping by it would merge every creator into one batch.
        expect(
            impliedSourceName(
                null,
                "Z:\\Media\\Unfiled\\Explicit Kait\\OnlyFans\\a.mp4",
            ),
        ).toBe("Explicit Kait");
    });

    it("steps over a drive letter", () => {
        expect(impliedSourceName(null, "D:\\Porn\\Ada Wong\\a.mp4")).toBe(
            "Ada Wong",
        );
    });

    it("steps over a Unix mount prefix", () => {
        expect(impliedSourceName(null, "/mnt/media/Ada Wong/a.mp4")).toBe(
            "Ada Wong",
        );
    });

    it("keeps a pack folder verbatim rather than trying to parse it", () => {
        // "[Onlyfans.com] Somon (@somonnn)" is not a name, but it IS a
        // stable grouping key and the user recognises it. Cleaning it up
        // would risk collapsing two different packs into one.
        expect(
            impliedSourceName(
                null,
                "Z:/Media/[Onlyfans.com] Somon (@somonnn)/1.mp4",
            ),
        ).toBe("[Onlyfans.com] Somon (@somonnn)");
    });

    it("returns null when the file sits directly in a container", () => {
        // Nothing here names a source, and inventing one would batch
        // together scenes that have nothing to do with each other.
        expect(impliedSourceName(null, "Z:/Media/a.mp4")).toBeNull();
    });

    it("returns null with no path and no studio", () => {
        expect(impliedSourceName(null, null)).toBeNull();
    });

    it("returns null for a bare filename", () => {
        expect(impliedSourceName(null, "a.mp4")).toBeNull();
    });

    it("ignores empty segments from a doubled separator", () => {
        expect(impliedSourceName(null, "Z://Media//Ada//a.mp4")).toBe("Ada");
    });

    it("matches container names regardless of case", () => {
        expect(impliedSourceName(null, "Z:/MEDIA/UnFiled/Ada/a.mp4")).toBe(
            "Ada",
        );
    });

    it("does not treat a container word inside a longer name as a container", () => {
        expect(impliedSourceName(null, "Z:/Media/Media Queen/a.mp4")).toBe(
            "Media Queen",
        );
    });
});

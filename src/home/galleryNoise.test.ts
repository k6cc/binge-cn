import { describe, expect, it } from "vitest";
import {
    buildGalleryNoiseMatcher,
    DEFAULT_GALLERY_IGNORE_FOLDERS,
} from "./galleryNoise";

// Deciding a gallery is artwork hides it with no explanation anywhere in
// the UI, so a false positive is invisible: the user simply never sees
// their photo set. That asymmetry is why the matching is on whole path
// segments and why the list is the user's rather than a constant.

const def = buildGalleryNoiseMatcher();
const isNoise = (path: string) => def.isNoise([path]);

describe("the default list", () => {
    it("catches a screenshots folder", () => {
        expect(isNoise("/media/Set/Screenshots")).toBe(true);
    });

    it("catches every screen-prefixed convention", () => {
        for (const name of [
            "Screen",
            "Screens",
            "Screenshot",
            "Screenshots",
            "Screenlist",
            "Screen Previews",
        ]) {
            expect(isNoise(`/media/Set/${name}`)).toBe(true);
        }
    });

    it("catches the short scr folder", () => {
        expect(isNoise("/media/Set/scr")).toBe(true);
    });

    it("catches cover and proof art", () => {
        expect(isNoise("/media/Set/Covers")).toBe(true);
        expect(isNoise("/media/Set/Cover")).toBe(true);
        expect(isNoise("/media/Set/proof")).toBe(true);
    });

    it("matches a Windows path the same way", () => {
        expect(isNoise("Z:\\Media\\Set\\Screens")).toBe(true);
    });

    it("ignores case", () => {
        expect(isNoise("/media/Set/SCREENSHOTS")).toBe(true);
    });

    it("catches an archive gallery named after the convention", () => {
        // Archive galleries are a zip rather than a folder, and a
        // Screens.zip is the same noise as a Screens directory.
        expect(isNoise("/media/Set/Screens.zip")).toBe(true);
    });
});

describe("what it must NOT hide", () => {
    it("keeps a folder that merely contains a listed word", () => {
        // "Undercover Set" is a photo set. Substring matching would eat
        // it, and the user would never know why it vanished.
        expect(isNoise("/media/Undercover Set")).toBe(false);
    });

    it("keeps an image file that happens to be called cover", () => {
        // A file named cover.jpg is not a folder of cover art.
        expect(isNoise("/media/Set/cover.jpg")).toBe(false);
    });

    it("keeps a folder whose name starts with a listed word", () => {
        expect(isNoise("/media/Proofreading")).toBe(false);
        expect(isNoise("/media/Coverage")).toBe(false);
    });

    it("keeps an ordinary set", () => {
        expect(isNoise("/media/Sets/Beach Day")).toBe(false);
    });
});

describe("the list is the user's", () => {
    it("hides a folder name only that user could know about", () => {
        const m = buildGalleryNoiseMatcher(["contactsheets"]);
        expect(m.isNoise(["/media/Set/ContactSheets"])).toBe(true);
    });

    it("stops hiding a default name once the list is replaced", () => {
        // Someone whose photo sets genuinely live in "Covers" has to be
        // able to get them back.
        const m = buildGalleryNoiseMatcher(["contactsheets"]);
        expect(m.isNoise(["/media/Set/Covers"])).toBe(false);
    });

    it("hides nothing when the list is empty", () => {
        const m = buildGalleryNoiseMatcher([]);
        expect(m.isNoise(["/media/Set/Screenshots"])).toBe(false);
    });

    it("ignores blank entries", () => {
        const m = buildGalleryNoiseMatcher(["", "  ", "proof"]);
        expect(m.isNoise(["/media/Set/proof"])).toBe(true);
        expect(m.isNoise(["/media/Set/Screenshots"])).toBe(false);
    });

    it("refuses a bare star rather than hiding the whole library", () => {
        const m = buildGalleryNoiseMatcher(["*"]);
        expect(m.isNoise(["/media/Sets/Beach Day"])).toBe(false);
    });

    it("supports a prefix entry the user writes themselves", () => {
        const m = buildGalleryNoiseMatcher(["thumb*"]);
        expect(m.isNoise(["/media/Set/Thumbnails"])).toBe(true);
        expect(m.isNoise(["/media/Set/Thumb"])).toBe(true);
        expect(m.isNoise(["/media/Set/Beach"])).toBe(false);
    });
});

describe("across a gallery's several paths", () => {
    it("hides when any path is in an ignored folder", () => {
        // A gallery carries its folder path plus each archive file, and
        // one hit is enough.
        expect(def.isNoise(["/media/Set", "/media/Set/Screens.zip"])).toBe(
            true,
        );
    });

    it("keeps a gallery when none of its paths match", () => {
        expect(def.isNoise(["/media/Set", "/media/Set/a.zip"])).toBe(false);
    });

    it("copes with no paths at all", () => {
        expect(def.isNoise([])).toBe(false);
    });
});

describe("the default list itself", () => {
    it("is generic rather than one person's folder names", () => {
        // A regression guard for the rule this file exists to follow:
        // if a future default is added that only makes sense on one
        // disk, it belongs in the setting, not here.
        expect([...DEFAULT_GALLERY_IGNORE_FOLDERS]).toEqual([
            "screen*",
            "scr",
            "cover",
            "covers",
            "proof",
        ]);
    });
});

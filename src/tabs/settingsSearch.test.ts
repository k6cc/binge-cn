import { describe, expect, it } from "vitest";
import {
    LONG_DESCRIPTION_CHARS,
    isLongDescription,
    matchesSettingQuery,
} from "./settingsSearch";

describe("filtering the settings list", () => {
    const privacy =
        "Privacy blur Blurs every image, video, and avatar while leaving " +
        "the interface sharp";

    it("shows everything when nothing has been typed", () => {
        expect(matchesSettingQuery(privacy, "")).toBe(true);
        expect(matchesSettingQuery(privacy, "   ")).toBe(true);
    });

    it("matches on any word, in any order", () => {
        expect(matchesSettingQuery(privacy, "blur")).toBe(true);
        expect(matchesSettingQuery(privacy, "avatar blur")).toBe(true);
        expect(matchesSettingQuery(privacy, "blur avatar")).toBe(true);
    });

    it("requires every term, not just one", () => {
        // Otherwise typing a second word widens the results instead of
        // narrowing them, which is the opposite of what typing more
        // means everywhere else.
        expect(matchesSettingQuery(privacy, "blur transcode")).toBe(false);
    });

    it("ignores case", () => {
        expect(matchesSettingQuery(privacy, "PRIVACY")).toBe(true);
    });

    it("matches part of a word, so a half-typed query still finds it", () => {
        expect(matchesSettingQuery(privacy, "priv")).toBe(true);
    });
});

describe("deciding which descriptions to fold away", () => {
    it("leaves a short description alone", () => {
        expect(isLongDescription("Mix gallery posts into the Home feed.")).toBe(
            false,
        );
    });

    it("folds one that runs past the threshold", () => {
        expect(isLongDescription("x".repeat(LONG_DESCRIPTION_CHARS + 1))).toBe(
            true,
        );
    });

    it("does not fold one sitting exactly on it", () => {
        expect(isLongDescription("x".repeat(LONG_DESCRIPTION_CHARS))).toBe(
            false,
        );
    });
});

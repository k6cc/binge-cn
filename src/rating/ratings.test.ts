import { describe, expect, it } from "vitest";
import {
    buildUpdatedTagIds,
    computeRating100,
    countCriteriaPerGroup,
    parseRatingsFromTags,
    ratingProgress,
} from "./ratings";
import type { Criterion, Group, RatingConfig } from "./types";

// These functions are a replica of the Advanced Rating plugin's Python
// model (lib/rating_core.py). The plugin's hook writes the authoritative
// rating100; binge only previews it. Anywhere the two disagree the user
// sees the preview jump after saving, so the expectations below are taken
// from the Python, not from what the TypeScript happens to do.

const crit = (
    id: string,
    name: string,
    groupId: string,
    weight = 1,
): Criterion => ({
    id,
    name,
    groupId,
    weight,
    enabled: true,
    description: "",
});

const group = (id: string, name: string, weight = 1): Group => ({
    id,
    name,
    weight,
});

const config = (groups: Group[], criteria: Criterion[]): RatingConfig => ({
    domain: "scene",
    groups,
    criteria,
});

describe("parseRatingsFromTags", () => {
    const criteria = [
        crit("c1", "Production Quality", "g1"),
        crit("c2", "Chemistry", "g1"),
    ];

    it("reads a score per criterion", () => {
        const got = parseRatingsFromTags(
            [
                { id: "t1", name: "Production Quality ★: 4" },
                { id: "t2", name: "Chemistry ★: 2" },
            ],
            criteria,
        );
        expect(got).toEqual({ c1: 4, c2: 2 });
    });

    it("keeps a zero score, which is distinct from unrated", () => {
        const got = parseRatingsFromTags(
            [{ id: "t1", name: "Production Quality ★: 0" }],
            criteria,
        );
        expect(got).toEqual({ c1: 0 });
        expect(Object.hasOwn(got, "c1")).toBe(true);
    });

    it("ignores ordinary tags and unrelated colons", () => {
        const got = parseRatingsFromTags(
            [
                { id: "t1", name: "Blonde" },
                { id: "t2", name: "Studio: Vixen" },
                { id: "t3", name: "Chemistry ★: 5" },
            ],
            criteria,
        );
        expect(got).toEqual({ c2: 5 });
    });

    it("ignores a score tag for a criterion the config no longer has", () => {
        // Disabling a criterion in the plugin leaves its tags on the scene.
        const got = parseRatingsFromTags(
            [{ id: "t1", name: "Retired Criterion ★: 3" }],
            criteria,
        );
        expect(got).toEqual({});
    });

    it("rejects scores outside 0-5", () => {
        const got = parseRatingsFromTags(
            [
                { id: "t1", name: "Production Quality ★: 6" },
                { id: "t2", name: "Chemistry ★: -1" },
            ],
            criteria,
        );
        expect(got).toEqual({});
    });

    it("tolerates stray whitespace around the separator", () => {
        const got = parseRatingsFromTags(
            [{ id: "t1", name: "Production Quality ★ :   3" }],
            criteria,
        );
        expect(got).toEqual({ c1: 3 });
    });

    it("takes the last tag when a scene carries two scores for one criterion", () => {
        // Shouldn't happen, but a hand-edited scene can produce it and the
        // modal must still land on a single value rather than throwing.
        const got = parseRatingsFromTags(
            [
                { id: "t1", name: "Chemistry ★: 1" },
                { id: "t2", name: "Chemistry ★: 5" },
            ],
            criteria,
        );
        expect(got).toEqual({ c2: 5 });
    });
});

describe("buildUpdatedTagIds", () => {
    const c = crit("c1", "Chemistry", "g1");

    it("swaps this criterion's old score tag for the new one", () => {
        const got = buildUpdatedTagIds(
            [
                { id: "keep", name: "Blonde" },
                { id: "old", name: "Chemistry ★: 2" },
            ],
            c,
            4,
            "new",
        );
        expect(got).toEqual(["keep", "new"]);
    });

    it("leaves other criteria's score tags alone", () => {
        const got = buildUpdatedTagIds(
            [
                { id: "other", name: "Production Quality ★: 5" },
                { id: "old", name: "Chemistry ★: 2" },
            ],
            c,
            1,
            "new",
        );
        expect(got).toEqual(["other", "new"]);
    });

    it("clears the score when passed null, without adding a tag", () => {
        const got = buildUpdatedTagIds(
            [
                { id: "keep", name: "Blonde" },
                { id: "old", name: "Chemistry ★: 2" },
            ],
            c,
            null,
            null,
        );
        expect(got).toEqual(["keep"]);
    });

    it("refuses when the score tag does not exist yet", () => {
        // The plugin's settings panel owns tag creation, so binge must not
        // invent one. null tells the modal to warn instead of writing.
        expect(
            buildUpdatedTagIds([{ id: "keep", name: "Blonde" }], c, 3, null),
        ).toBeNull();
    });

    it("does not duplicate a tag the scene already carries", () => {
        const got = buildUpdatedTagIds(
            [{ id: "same", name: "Unrelated" }],
            c,
            3,
            "same",
        );
        expect(got).toEqual(["same"]);
    });
});

describe("computeRating100", () => {
    const cfg = config(
        [group("g1", "Technical"), group("g2", "Performance")],
        [
            crit("c1", "Production Quality", "g1"),
            crit("c2", "Camera", "g1"),
            crit("c3", "Chemistry", "g2"),
        ],
    );

    it("returns null when nothing is rated", () => {
        expect(computeRating100({}, cfg)).toBeNull();
    });

    it("averages within a group, then across groups", () => {
        // g1 avg 4, g2 avg 2, equal group weights -> 3/5 -> 60.
        expect(computeRating100({ c1: 5, c2: 3, c3: 2 }, cfg)).toBe(60);
    });

    it("ignores groups with nothing rated in them", () => {
        // Only g2 contributes: avg 4 -> 80.
        expect(computeRating100({ c3: 4 }, cfg)).toBe(80);
    });

    it("honours criterion weights inside a group", () => {
        const weighted = config(
            [group("g1", "Technical")],
            [crit("c1", "Heavy", "g1", 3), crit("c2", "Light", "g1", 1)],
        );
        // (5*3 + 1*1) / 4 = 4 -> 80.
        expect(computeRating100({ c1: 5, c2: 1 }, weighted)).toBe(80);
    });

    it("honours group weights", () => {
        const weighted = config(
            [group("g1", "Heavy", 3), group("g2", "Light", 1)],
            [crit("c1", "A", "g1"), crit("c2", "B", "g2")],
        );
        // (4*3 + 0*1) / 4 = 3 -> 60.
        expect(computeRating100({ c1: 4, c2: 0 }, weighted)).toBe(60);
    });

    it("clamps a straight-zero rating up to one step, as the plugin does", () => {
        // rating_core.py: max(precision, min(100, final)). Zero across the
        // board still reports one star rather than none.
        expect(computeRating100({ c1: 0, c2: 0, c3: 0 }, cfg)).toBe(20);
    });

    it("caps at 100", () => {
        expect(computeRating100({ c1: 5, c2: 5, c3: 5 }, cfg)).toBe(100);
    });

    it("snaps to the configured precision", () => {
        // avg 3.5: at half-star precision that is representable (70), at
        // full-star precision it must land on a multiple of 20.
        const half = config(
            [group("g1", "Only")],
            [crit("c1", "A", "g1"), crit("c2", "B", "g1")],
        );
        expect(computeRating100({ c1: 4, c2: 3 }, half, 10)).toBe(70);
        expect(computeRating100({ c1: 4, c2: 3 }, half, 20)).toBe(80);
    });

    it("rounds halves the way Python does, not the way JS does", () => {
        // The hook uses Python's round(), which is round-half-to-even.
        // JS Math.round rounds halves up, so an average of exactly 2.5 at
        // full-star precision would preview as 60 and then be rewritten to
        // 40 by the hook the moment it runs.
        const two = config(
            [group("g1", "Only")],
            [crit("c1", "A", "g1"), crit("c2", "B", "g1")],
        );
        expect(computeRating100({ c1: 2, c2: 3 }, two, 20)).toBe(40);
        // 1.5 -> round-half-to-even gives 2 -> 40. Same as JS here; the
        // divergence only shows on odd halves.
        expect(computeRating100({ c1: 1, c2: 2 }, two, 20)).toBe(40);
        // 4.5 -> 4 -> 80, where JS would have said 100.
        expect(computeRating100({ c1: 4, c2: 5 }, two, 20)).toBe(80);
    });

    it("falls back the way the plugin does when precision is nonsense", () => {
        // rating_core.py: precision = max(1, precision), so a bad value
        // means "don't snap", not "snap to full stars". An average of 3.5
        // is the case that tells the two apart: clamping to 1 keeps 70,
        // defaulting to 20 would round it to 80.
        const two = config(
            [group("g1", "Only")],
            [crit("c1", "A", "g1"), crit("c2", "B", "g1")],
        );
        expect(computeRating100({ c1: 4, c2: 3 }, two, 0)).toBe(70);
        expect(computeRating100({ c1: 4, c2: 3 }, two, -5)).toBe(70);
    });
});

describe("countCriteriaPerGroup", () => {
    it("buckets criteria by group", () => {
        const cfg = config(
            [group("g1", "A"), group("g2", "B")],
            [
                crit("c1", "One", "g1"),
                crit("c2", "Two", "g1"),
                crit("c3", "Three", "g2"),
            ],
        );
        const got = countCriteriaPerGroup(cfg);
        expect(got.get("g1")?.map((c) => c.id)).toEqual(["c1", "c2"]);
        expect(got.get("g2")?.map((c) => c.id)).toEqual(["c3"]);
    });
});

describe("ratingProgress", () => {
    const criteria = [
        crit("c1", "One", "g1"),
        crit("c2", "Two", "g1"),
        crit("c3", "Three", "g1"),
    ];

    it("counts rated against total", () => {
        expect(ratingProgress({ c1: 3, c3: 0 }, criteria)).toEqual({
            rated: 2,
            total: 3,
        });
    });

    it("counts a zero as rated", () => {
        expect(ratingProgress({ c1: 0 }, criteria).rated).toBe(1);
    });

    it("handles an empty config", () => {
        expect(ratingProgress({}, [])).toEqual({ rated: 0, total: 0 });
    });
});

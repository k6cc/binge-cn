import { describe, expect, it } from "vitest";
import { transformObjectFilter } from "./savedFilterTransform";

// Stash stores a saved filter's criteria in the shape its own UI uses,
// which is not the shape findScenes accepts. Getting this wrong does not
// throw anywhere in binge: the query is rejected server-side and the
// preset silently returns nothing, or worse, returns the wrong scenes.
//
// The fixtures below are the real stored shapes, read back out of a live
// Stash rather than imagined.

describe("numeric criteria", () => {
    it("unwraps the extra level Int criteria are stored with", () => {
        // "Hidden Gems": play_count < 2 and rating100 > 80.
        expect(
            transformObjectFilter({
                play_count: { modifier: "LESS_THAN", value: { value: 2 } },
                rating100: { modifier: "GREATER_THAN", value: { value: 80 } },
            }),
        ).toEqual({
            play_count: { modifier: "LESS_THAN", value: 2 },
            rating100: { modifier: "GREATER_THAN", value: 80 },
        });
    });

    it("keeps both ends of a range", () => {
        expect(
            transformObjectFilter({
                duration: {
                    modifier: "BETWEEN",
                    value: { value: 60, value2: 300 },
                },
            }),
        ).toEqual({
            duration: { modifier: "BETWEEN", value: 60, value2: 300 },
        });
    });

    it("drops an absent upper bound rather than sending null", () => {
        expect(
            transformObjectFilter({
                duration: {
                    modifier: "GREATER_THAN",
                    value: { value: 60, value2: null },
                },
            }),
        ).toEqual({ duration: { modifier: "GREATER_THAN", value: 60 } });
    });

    it("unwraps a date, which is stored nested like the numerics", () => {
        // "Recent Arrivals": date > 2025-09-15.
        expect(
            transformObjectFilter({
                date: {
                    modifier: "GREATER_THAN",
                    value: { value: "2025-09-15" },
                },
            }),
        ).toEqual({
            date: { modifier: "GREATER_THAN", value: "2025-09-15" },
        });
    });
});

describe("criteria that are scalars at the input layer", () => {
    it("unwraps is_missing to its bare value", () => {
        // "Reels": is_missing = stash_id.
        expect(
            transformObjectFilter({
                is_missing: { modifier: "EQUALS", value: "stash_id" },
            }),
        ).toEqual({ is_missing: "stash_id" });
    });

    it("unwraps the boolean scalars too", () => {
        expect(
            transformObjectFilter({
                organized: { modifier: "EQUALS", value: true },
                performer_favorite: { modifier: "EQUALS", value: false },
            }),
        ).toEqual({ organized: true, performer_favorite: false });
    });

    it("passes a scalar that is already flat straight through", () => {
        expect(transformObjectFilter({ organized: true })).toEqual({
            organized: true,
        });
    });
});

describe("null-test modifiers", () => {
    it("supplies the empty string a string criterion requires", () => {
        expect(
            transformObjectFilter({ title: { modifier: "IS_NULL" } }),
        ).toEqual({ title: { modifier: "IS_NULL", value: "" } });
    });

    it("treats an explicit null value the same way", () => {
        expect(
            transformObjectFilter({
                title: { modifier: "NOT_NULL", value: null },
            }),
        ).toEqual({ title: { modifier: "NOT_NULL", value: "" } });
    });

    it("sends no value for criteria whose input type has none", () => {
        // StashIDCriterionInput is {endpoint, stash_id, modifier}: there
        // is no value field to fill in, and inventing one is an
        // unknown-field error that fails the whole query. This is what
        // broke the "Recent Arrivals" filter, which is a date range plus
        // "has no stash id" and returned nothing at all.
        expect(
            transformObjectFilter({
                stash_id_endpoint: { modifier: "NOT_NULL" },
            }),
        ).toEqual({ stash_id_endpoint: { modifier: "NOT_NULL" } });
    });

    it("covers every valueless criterion on SceneFilterType", () => {
        // duplicated, stash_id_endpoint and stash_ids_endpoint, per the
        // live schema. If Stash adds another, this is where it goes.
        expect(
            transformObjectFilter({
                duplicated: { modifier: "IS_NULL" },
                stash_ids_endpoint: { modifier: "NOT_NULL" },
            }),
        ).toEqual({
            duplicated: { modifier: "IS_NULL" },
            stash_ids_endpoint: { modifier: "NOT_NULL" },
        });
    });
});

describe("criteria that are already in the right shape", () => {
    it("leaves a flat string criterion alone", () => {
        // "Exclude instagram + pornclips".
        const stored = {
            path: {
                modifier: "NOT_MATCHES_REGEX",
                value: "(?i)\\\\(instagram|pornclips)\\\\",
            },
        };
        expect(transformObjectFilter(stored)).toEqual(stored);
    });

    it("preserves depth and excludes on a hierarchical criterion", () => {
        // "Showcase". depth sits BESIDE value here, not inside it, so the
        // numeric unwrap must not touch this: losing depth would silently
        // change which tags the filter excludes.
        const stored = {
            tags: {
                depth: 0,
                excludes: [],
                modifier: "EXCLUDES",
                value: ["1985", "646"],
            },
        };
        expect(transformObjectFilter(stored)).toEqual(stored);
    });

    it("does not mistake a two-key payload for a numeric wrap", () => {
        // A nested object with a value key AND something else is a real
        // shape, not the Int double-wrap; flattening it would drop the
        // sibling.
        const stored = {
            folder: {
                modifier: "INCLUDES",
                value: { depth: -1, excluded: [], items: [{ id: "1" }] },
            },
        };
        expect(transformObjectFilter(stored)).toEqual(stored);
    });

    it("passes an unrecognised criterion through untouched", () => {
        // Better to let Stash reject something we do not understand than
        // to quietly drop it and widen the filter.
        const stored = { some_future_field: { whatever: true } };
        expect(transformObjectFilter(stored)).toEqual(stored);
    });
});

describe("degenerate input", () => {
    it("treats nothing as an empty filter", () => {
        expect(transformObjectFilter(null)).toEqual({});
        expect(transformObjectFilter(undefined)).toEqual({});
        expect(transformObjectFilter({})).toEqual({});
    });

    it("drops keys with no criterion at all", () => {
        expect(
            transformObjectFilter({
                title: null,
                rating100: undefined,
                organized: true,
            }),
        ).toEqual({ organized: true });
    });

    it("does not mutate what it was given", () => {
        const stored = {
            play_count: { modifier: "LESS_THAN", value: { value: 2 } },
        };
        const snapshot = JSON.parse(JSON.stringify(stored));
        transformObjectFilter(stored);
        expect(stored).toEqual(snapshot);
    });
});

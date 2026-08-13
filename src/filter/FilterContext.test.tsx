// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { FilterProvider, useFilter } from "./FilterContext";
import type { StashSavedFilter } from "../api/queries";
import { buildSceneFilter } from "../api/queries";

// The reel can be constrained two ways that must never combine: chips
// (performer/tag/studio) which build a scene_filter, and a Stash saved
// filter which is passed through whole. If both were ever live at once
// the reel would quietly show the wrong scenes, with the UI implying
// something else. Every mutation here therefore has to clear the other
// mode, and that is what these pin.

const wrapper = ({ children }: { children: ReactNode }) => (
    <FilterProvider>{children}</FilterProvider>
);

const render = () => renderHook(() => useFilter(), { wrapper });

const savedFilter = (name = "Hidden Gems") =>
    ({
        id: "1",
        name,
        object_filter: {},
        find_filter: {},
    }) as unknown as StashSavedFilter;

afterEach(cleanup);

describe("chips", () => {
    it("starts empty", () => {
        const { result } = render();
        expect(result.current.filter).toEqual({
            performers: [],
            tags: [],
            studios: [],
        });
        expect(result.current.isEmpty).toBe(true);
    });

    it("adds to the category asked for and leaves the others alone", () => {
        const { result } = render();
        act(() => result.current.add("tags", { id: "t1", name: "Blonde" }));
        expect(result.current.filter.tags).toEqual([
            { id: "t1", name: "Blonde" },
        ]);
        expect(result.current.filter.performers).toEqual([]);
        expect(result.current.isEmpty).toBe(false);
    });

    it("ignores the same entry added twice", () => {
        // Tapping a performer's name repeatedly must not grow the row.
        const { result } = render();
        act(() => result.current.add("performers", { id: "p1", name: "Ada" }));
        act(() =>
            result.current.add("performers", { id: "p1", name: "Ada again" }),
        );
        expect(result.current.filter.performers).toHaveLength(1);
        expect(result.current.filter.performers[0].name).toBe("Ada");
    });

    it("removes only the entry named, from the category named", () => {
        const { result } = render();
        act(() => {
            result.current.add("tags", { id: "t1", name: "Blonde" });
            result.current.add("tags", { id: "t2", name: "Brunette" });
            result.current.add("performers", { id: "t1", name: "Same id" });
        });
        act(() => result.current.remove("tags", "t1"));
        expect(result.current.filter.tags.map((t) => t.id)).toEqual(["t2"]);
        // An id colliding across categories must not be collateral.
        expect(result.current.filter.performers).toHaveLength(1);
    });

    it("shrugs at removing something that is not there", () => {
        const { result } = render();
        act(() => result.current.add("tags", { id: "t1", name: "Blonde" }));
        act(() => result.current.remove("tags", "nope"));
        expect(result.current.filter.tags).toHaveLength(1);
    });

    it("replaces the whole set at once", () => {
        const { result } = render();
        act(() => result.current.add("tags", { id: "t1", name: "Blonde" }));
        act(() =>
            result.current.replace({
                performers: [{ id: "p9", name: "Zoe" }],
                tags: [],
                studios: [],
            }),
        );
        expect(result.current.filter.tags).toEqual([]);
        expect(result.current.filter.performers).toHaveLength(1);
    });
});

describe("the two modes are mutually exclusive", () => {
    it("drops the saved filter when a chip is added", () => {
        const { result } = render();
        act(() => result.current.applySavedFilter(savedFilter()));
        act(() => result.current.add("tags", { id: "t1", name: "Blonde" }));
        expect(result.current.activeSavedFilter).toBeNull();
        expect(result.current.filter.tags).toHaveLength(1);
    });

    it("drops the chips when a saved filter is applied", () => {
        const { result } = render();
        act(() => {
            result.current.add("tags", { id: "t1", name: "Blonde" });
            result.current.add("performers", { id: "p1", name: "Ada" });
        });
        act(() => result.current.applySavedFilter(savedFilter()));
        expect(result.current.filter).toEqual({
            performers: [],
            tags: [],
            studios: [],
        });
        expect(result.current.activeSavedFilter?.name).toBe("Hidden Gems");
    });

    it("drops the saved filter when the whole set is replaced", () => {
        // Replace is how tapping into a collection re-points the reel.
        const { result } = render();
        act(() => result.current.applySavedFilter(savedFilter()));
        act(() =>
            result.current.replace({
                performers: [],
                tags: [{ id: "t1", name: "Collection" }],
                studios: [],
            }),
        );
        expect(result.current.activeSavedFilter).toBeNull();
    });

    it("swaps one saved filter for another cleanly", () => {
        const { result } = render();
        act(() => result.current.applySavedFilter(savedFilter("First")));
        act(() => result.current.applySavedFilter(savedFilter("Second")));
        expect(result.current.activeSavedFilter?.name).toBe("Second");
    });

    it("clears both modes together", () => {
        const { result } = render();
        act(() => {
            result.current.add("tags", { id: "t1", name: "Blonde" });
            result.current.applySavedFilter(savedFilter());
        });
        act(() => result.current.clear());
        expect(result.current.activeSavedFilter).toBeNull();
        expect(result.current.isEmpty).toBe(true);
    });

    it("clears the saved filter on its own", () => {
        const { result } = render();
        act(() => result.current.applySavedFilter(savedFilter()));
        act(() => result.current.clearSavedFilter());
        expect(result.current.activeSavedFilter).toBeNull();
        expect(result.current.isEmpty).toBe(true);
    });
});

describe("isEmpty", () => {
    it("counts an active saved filter as not empty", () => {
        // The reel uses this to decide whether it is showing everything.
        // A saved filter constrains the reel just as chips do.
        const { result } = render();
        act(() => result.current.applySavedFilter(savedFilter()));
        expect(result.current.isEmpty).toBe(false);
    });

    it("goes back to empty once the last chip is removed", () => {
        const { result } = render();
        act(() => result.current.add("studios", { id: "s1", name: "Vixen" }));
        act(() => result.current.remove("studios", "s1"));
        expect(result.current.isEmpty).toBe(true);
    });
});

describe("useFilter outside a provider", () => {
    it("says so rather than returning undefined", () => {
        expect(() => renderHook(() => useFilter())).toThrow(/FilterProvider/);
    });
});

// The other half of the same journey: chip state becomes a scene_filter.
describe("buildSceneFilter", () => {
    it("is undefined when nothing is selected, meaning no constraint", () => {
        // Not an empty object: findScenes treats {} as a filter and it
        // must stay absent so the reel draws from everything.
        expect(buildSceneFilter([], [], [])).toBeUndefined();
    });

    it("includes only the categories that have chips", () => {
        expect(buildSceneFilter(["p1"], [], [])).toEqual({
            performers: { value: ["p1"], modifier: "INCLUDES" },
        });
    });

    it("combines categories", () => {
        expect(buildSceneFilter(["p1"], ["t1", "t2"], ["s1"])).toEqual({
            performers: { value: ["p1"], modifier: "INCLUDES" },
            tags: { value: ["t1", "t2"], modifier: "INCLUDES" },
            studios: { value: ["s1"], modifier: "INCLUDES" },
        });
    });

    it("uses INCLUDES, so multiple chips widen rather than narrow", () => {
        // INCLUDES_ALL would mean two tag chips ask for scenes carrying
        // both, which is the opposite of what the chip row implies.
        expect(buildSceneFilter([], ["t1", "t2"], [])).toEqual({
            tags: { value: ["t1", "t2"], modifier: "INCLUDES" },
        });
    });
});

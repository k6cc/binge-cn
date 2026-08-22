// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StashDBScene } from "../api/stashdb";

// Discovery is the one surface that shows the user content from outside
// their own library, so its filters are the ones with consequences: the
// gender setting is the only gate on who appears, the recent window has to
// hold even for globally-trending scenes of any age, and a scene the user
// already owns must never come back as a suggestion.

const getStashDBBox = vi.fn();
const getLinkedPerformers = vi.fn();
const getOwnedStashDBSceneIds = vi.fn();
const getNewStashDBScenesForPerformers = vi.fn();
const getTrendingStashDBScenes = vi.fn();

vi.mock("../api/stashdb", () => ({
    getStashDBBox: (...a: unknown[]) => getStashDBBox(...a),
    getLinkedPerformers: (...a: unknown[]) => getLinkedPerformers(...a),
    getOwnedStashDBSceneIds: (...a: unknown[]) => getOwnedStashDBSceneIds(...a),
    getNewStashDBScenesForPerformers: (...a: unknown[]) =>
        getNewStashDBScenesForPerformers(...a),
    getTrendingStashDBScenes: (...a: unknown[]) =>
        getTrendingStashDBScenes(...a),
}));

const { fetchDiscoveryFeedItems } = await import("./discoveryFeed");

const SINCE = "2026-06-01";

type PerfOver = {
    id?: string;
    name?: string;
    gender?: string | null;
    sceneCount?: number;
};
const perf = (over: PerfOver = {}) => ({
    id: over.id ?? "sdb-p1",
    name: over.name ?? "Ada",
    image: null,
    gender: over.gender === undefined ? "FEMALE" : over.gender,
    birthDate: null,
    sceneCount: over.sceneCount ?? 10,
});

const scene = (
    over: Partial<StashDBScene> & {
        performers?: ReturnType<typeof perf>[];
    } = {},
): StashDBScene =>
    ({
        id: "sc1",
        title: "A scene",
        coverUrl: null,
        releaseDate: "2026-06-10",
        performers: [perf()],
        ...over,
    }) as unknown as StashDBScene;

beforeEach(() => {
    localStorage.clear();
    for (const m of [
        getStashDBBox,
        getLinkedPerformers,
        getOwnedStashDBSceneIds,
        getNewStashDBScenesForPerformers,
        getTrendingStashDBScenes,
    ]) {
        m.mockReset();
    }
    getStashDBBox.mockResolvedValue({ api_key: "k", index: 0 });
    getLinkedPerformers.mockResolvedValue([]);
    getOwnedStashDBSceneIds.mockResolvedValue(new Set<string>());
    getTrendingStashDBScenes.mockResolvedValue([]);
    getNewStashDBScenesForPerformers.mockResolvedValue([]);
});

describe("preconditions", () => {
    it("does nothing without a StashDB endpoint configured", async () => {
        getStashDBBox.mockResolvedValue(null);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
        expect(getTrendingStashDBScenes).not.toHaveBeenCalled();
    });

    it("never suggests a scene the user already owns", async () => {
        getTrendingStashDBScenes.mockResolvedValue([scene({ id: "owned" })]);
        getOwnedStashDBSceneIds.mockResolvedValue(new Set(["owned"]));
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
    });

    it("does not ask for co-star scenes when nothing is linked", async () => {
        await fetchDiscoveryFeedItems(SINCE);
        expect(getNewStashDBScenesForPerformers).not.toHaveBeenCalled();
    });
});

describe("the recent window", () => {
    it("drops a trending scene older than the window", async () => {
        // Trending is sorted by global heat, not date, so it will happily
        // return something from years ago. That must not leak past the
        // user's configured lookback.
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ id: "ancient", releaseDate: "2019-01-01" }),
        ]);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
    });

    it("drops an undated scene", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ id: "undated", releaseDate: null }),
        ]);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
    });

    it("keeps a scene released inside the window", async () => {
        getTrendingStashDBScenes.mockResolvedValue([scene()]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(1);
        expect(items[0].source).toBe("trending");
    });
});

describe("the gender gate", () => {
    it("skips a scene with nobody of an allowed gender", async () => {
        localStorage.setItem("binge.allowedGenders", "FEMALE");
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ performers: [perf({ gender: "MALE" })] }),
        ]);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
    });

    it("keeps a performer once their gender is allowed", async () => {
        localStorage.setItem("binge.allowedGenders", "FEMALE,MALE");
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ performers: [perf({ gender: "MALE" })] }),
        ]);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toHaveLength(1);
    });

    it("skips a performer with no gender recorded", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ performers: [perf({ gender: null })] }),
        ]);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
    });

    it("filters the co-performer list too, not just the headline", async () => {
        localStorage.setItem("binge.allowedGenders", "FEMALE");
        getTrendingStashDBScenes.mockResolvedValue([
            scene({
                performers: [
                    perf({ id: "a", name: "Ada" }),
                    perf({ id: "b", name: "Bob", gender: "MALE" }),
                    perf({ id: "c", name: "Cleo" }),
                ],
            }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items[0].coPerformers.map((p) => p.name)).toEqual(["Cleo"]);
    });

    it("reads the setting fresh on each call", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ performers: [perf({ gender: "MALE" })] }),
        ]);
        localStorage.setItem("binge.allowedGenders", "FEMALE");
        expect(await fetchDiscoveryFeedItems(SINCE)).toEqual([]);
        localStorage.setItem("binge.allowedGenders", "FEMALE,MALE");
        expect(await fetchDiscoveryFeedItems(SINCE)).toHaveLength(1);
    });
});

describe("choosing who fronts the card", () => {
    it("gives the headline to a performer already in the library", async () => {
        getLinkedPerformers.mockResolvedValue([
            { stashId: "lib", localId: "42", name: "Ada", favorite: true },
        ]);
        getTrendingStashDBScenes.mockResolvedValue([
            scene({
                performers: [
                    perf({ id: "unknown", name: "Zoe" }),
                    perf({ id: "lib", name: "Ada" }),
                ],
            }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items[0].primaryPerformer.name).toBe("Ada");
        expect(items[0].primaryPerformer.localId).toBe("42");
        expect(items[0].primaryInLibrary).toBe(true);
    });

    it("otherwise leads with the most prolific unfollowed performer", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            scene({
                performers: [
                    perf({ id: "small", name: "Ada", sceneCount: 3 }),
                    perf({ id: "big", name: "Zoe", sceneCount: 300 }),
                ],
            }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items[0].primaryPerformer.name).toBe("Zoe");
        expect(items[0].primaryInLibrary).toBe(false);
    });

    it("breaks a tie by name so the feed is stable between loads", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            scene({
                performers: [
                    perf({ id: "z", name: "Zoe", sceneCount: 10 }),
                    perf({ id: "a", name: "Ada", sceneCount: 10 }),
                ],
            }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items[0].primaryPerformer.name).toBe("Ada");
    });

    it("leaves the headliner out of their own co-performer list", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            scene({
                performers: [
                    perf({ id: "a", name: "Ada" }),
                    perf({ id: "b", name: "Bea" }),
                ],
            }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        const primary = items[0].primaryPerformer.stashId;
        expect(items[0].coPerformers.some((p) => p.stashId === primary)).toBe(
            false,
        );
    });

    it("shows the same person at most twice", async () => {
        // One prolific performer should not take over the whole feed.
        getTrendingStashDBScenes.mockResolvedValue(
            ["s1", "s2", "s3", "s4"].map((id) => scene({ id })),
        );
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(2);
    });
});

describe("what counts as actionable", () => {
    it("drops a co-star scene where there is nobody new to follow", async () => {
        getLinkedPerformers.mockResolvedValue([
            { stashId: "lib", localId: "1", name: "Ada", favorite: false },
        ]);
        getNewStashDBScenesForPerformers.mockResolvedValue([
            scene({ id: "all-known", performers: [perf({ id: "lib" })] }),
        ]);
        await expect(fetchDiscoveryFeedItems(SINCE)).resolves.toEqual([]);
    });

    it("keeps an all-library trending scene, which is informative anyway", async () => {
        getLinkedPerformers.mockResolvedValue([
            { stashId: "lib", localId: "1", name: "Ada", favorite: false },
        ]);
        getTrendingStashDBScenes.mockResolvedValue([
            scene({ id: "hot", performers: [perf({ id: "lib" })] }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(1);
        expect(items[0].source).toBe("trending");
    });
});

describe("merging the two seeds", () => {
    it("labels a scene in both seeds as trending", async () => {
        // Nearly every trending scene also matches the co-star query, so
        // without this ordering the TRENDING pill would never be seen.
        getLinkedPerformers.mockResolvedValue([
            { stashId: "lib", localId: "1", name: "Ada", favorite: false },
        ]);
        const both = scene({ id: "shared" });
        getTrendingStashDBScenes.mockResolvedValue([both]);
        getNewStashDBScenesForPerformers.mockResolvedValue([both]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(1);
        expect(items[0].source).toBe("trending");
    });

    it("caps how much trending can flood in", async () => {
        getTrendingStashDBScenes.mockResolvedValue(
            Array.from({ length: 30 }, (_, i) =>
                scene({
                    id: "t" + i,
                    performers: [perf({ id: "p" + i, name: "P" + i })],
                }),
            ),
        );
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(12);
    });

    // The test above cannot see the ordering, because all thirty of its
    // scenes pass every filter - so it asserts 12 whether the cap runs
    // before or after them. Trending is sorted by heat and returns
    // scenes of any age, so a run of old ones at the top of the chart is
    // ordinary, and capping first emptied the section entirely.
    it("counts the cap against scenes that survive the filters", async () => {
        getTrendingStashDBScenes.mockResolvedValue([
            // The twelve hottest are all older than the window.
            ...Array.from({ length: 12 }, (_, i) =>
                scene({
                    id: "old" + i,
                    releaseDate: "2019-01-01",
                    performers: [perf({ id: "op" + i, name: "Old" + i })],
                }),
            ),
            // Eighteen behind them are inside it.
            ...Array.from({ length: 18 }, (_, i) =>
                scene({
                    id: "new" + i,
                    performers: [perf({ id: "np" + i, name: "New" + i })],
                }),
            ),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(12);
        expect(items.every((i) => i.sceneStashId.startsWith("new"))).toBe(true);
    });
});

describe("partial outages", () => {
    it("still returns co-star finds when trending fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        getTrendingStashDBScenes.mockRejectedValue(new Error("stashdb 500"));
        getLinkedPerformers.mockResolvedValue([
            { stashId: "lib", localId: "1", name: "Ada", favorite: false },
        ]);
        getNewStashDBScenesForPerformers.mockResolvedValue([
            scene({
                id: "costar",
                performers: [perf({ id: "lib" }), perf({ id: "new" })],
            }),
        ]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(1);
        expect(items[0].source).toBe("costar");
        warn.mockRestore();
    });

    it("still returns trending when the co-star query fails", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        getLinkedPerformers.mockResolvedValue([
            { stashId: "lib", localId: "1", name: "Ada", favorite: false },
        ]);
        getNewStashDBScenesForPerformers.mockRejectedValue(
            new Error("timeout"),
        );
        getTrendingStashDBScenes.mockResolvedValue([scene()]);
        const items = await fetchDiscoveryFeedItems(SINCE);
        expect(items).toHaveLength(1);
        warn.mockRestore();
    });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Two boundaries meet in this module: StashDB's GraphQL responses, which
// binge does not control and which return partial records in practice,
// and a versioned localStorage cache, which outlives upgrades. Both fail
// quietly. A shape change means a performer silently vanishes from a
// discovery card; a bad cache entry means the stories row dies with a
// TypeError and stays dead for up to twelve hours.

const CACHE_KEY = "binge.stashdb.newScenes.v4";

const load = () => import("./stashdb");

const rawScene = (over: Record<string, unknown> = {}) => ({
    id: "sc1",
    title: "A scene",
    release_date: "2026-06-01",
    images: [{ url: "https://cdn/cover.jpg" }],
    performers: [
        {
            performer: {
                id: "p1",
                name: "Ada",
                gender: "FEMALE",
                birth_date: "1990-01-01",
                scene_count: 42,
                images: [{ url: "https://cdn/ada.jpg" }],
            },
        },
    ],
    ...over,
});

function stashdbReturns(scenes: unknown[]) {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { queryScenes: { scenes } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.useRealTimers();
});

describe("shaping a StashDB response", () => {
    it("maps a complete scene into binge's shape", async () => {
        stashdbReturns([rawScene()]);
        const { getTrendingStashDBScenes } = await load();
        const [scene] = await getTrendingStashDBScenes("key");
        expect(scene).toEqual({
            id: "sc1",
            title: "A scene",
            releaseDate: "2026-06-01",
            coverUrl: "https://cdn/cover.jpg",
            performers: [
                {
                    id: "p1",
                    name: "Ada",
                    image: "https://cdn/ada.jpg",
                    gender: "FEMALE",
                    birthDate: "1990-01-01",
                    sceneCount: 42,
                },
            ],
        });
    });

    it("survives a scene with no performers array at all", async () => {
        // StashDB returns these for orphaned or edited records, and it
        // used to crash the discovery merge on iteration.
        stashdbReturns([rawScene({ performers: null })]);
        const { getTrendingStashDBScenes } = await load();
        const [scene] = await getTrendingStashDBScenes("key");
        expect(scene.performers).toEqual([]);
    });

    it("skips a performer entry with nothing behind it", async () => {
        stashdbReturns([
            rawScene({
                performers: [
                    null,
                    { performer: null },
                    {
                        performer: {
                            id: "p2",
                            name: "Bea",
                            gender: null,
                            birth_date: null,
                            scene_count: null,
                            images: [],
                        },
                    },
                ],
            }),
        ]);
        const { getTrendingStashDBScenes } = await load();
        const [scene] = await getTrendingStashDBScenes("key");
        expect(scene.performers.map((p) => p.name)).toEqual(["Bea"]);
    });

    it("defaults a missing scene count to zero rather than undefined", async () => {
        // Discovery sorts on this to pick who fronts a card; undefined
        // would make that comparison meaningless.
        stashdbReturns([
            rawScene({
                performers: [
                    {
                        performer: {
                            id: "p2",
                            name: "Bea",
                            gender: null,
                            birth_date: null,
                            scene_count: null,
                            images: [],
                        },
                    },
                ],
            }),
        ]);
        const { getTrendingStashDBScenes } = await load();
        const [scene] = await getTrendingStashDBScenes("key");
        expect(scene.performers[0].sceneCount).toBe(0);
    });

    it("copes with a scene that has no images", async () => {
        stashdbReturns([rawScene({ images: [] })]);
        const { getTrendingStashDBScenes } = await load();
        const [scene] = await getTrendingStashDBScenes("key");
        expect(scene.coverUrl).toBeNull();
    });

    it("returns nothing rather than throwing when StashDB errors", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                ok: false,
                status: 502,
                json: async () => ({}),
            })),
        );
        const { getTrendingStashDBScenes } = await load();
        await expect(getTrendingStashDBScenes("key")).resolves.toEqual([]);
    });
});

describe("the twelve-hour cache", () => {
    it("returns what was written for the same window", async () => {
        const { readStashDBCache, writeStashDBCache } = await load();
        const scenes = [{ id: "a" }] as never;
        writeStashDBCache("2026-06-01", scenes);
        expect(readStashDBCache("2026-06-01")).toEqual(scenes);
    });

    it("serves an entry whose scenes carry performers", async () => {
        // The shape a REAL entry has. Every other test here writes
        // `[{ id: "a" }]`, which has no performers - and the element
        // validator short-circuits on that, so the whole suite passed
        // while the validator required a field the performer type does
        // not have. The cache therefore never hit once in production:
        // a full batched StashDB fetch on every mount.
        const { readStashDBCache, writeStashDBCache } = await load();
        const scenes = [
            {
                id: "sc1",
                title: "A scene",
                performers: [{ id: "p1", name: "Someone" }],
            },
        ] as never;
        writeStashDBCache("2026-06-01", scenes);
        expect(readStashDBCache("2026-06-01")).toEqual(scenes);
    });

    it("still rejects a performer with no id", async () => {
        // The guard the validator was written for stays. A null or
        // id-less performer throws in the story builder the moment it
        // reads sp.id, and it stayed broken for the whole TTL.
        const { readStashDBCache, writeStashDBCache } = await load();
        writeStashDBCache("2026-06-01", [
            { id: "sc1", performers: [{ name: "no id" }] },
        ] as never);
        expect(readStashDBCache("2026-06-01")).toBeNull();
    });

    it("misses when the lookback window changed", async () => {
        // A different window is a different question; answering it from
        // this entry would silently show the wrong range.
        const { readStashDBCache, writeStashDBCache } = await load();
        writeStashDBCache("2026-06-01", [{ id: "a" }] as never);
        expect(readStashDBCache("2026-05-01")).toBeNull();
    });

    it("expires after twelve hours", async () => {
        const { readStashDBCache, writeStashDBCache } = await load();
        writeStashDBCache("2026-06-01", [{ id: "a" }] as never);
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
        expect(readStashDBCache("2026-06-01")).toBeNull();
    });

    it("still serves an entry just inside the window", async () => {
        const { readStashDBCache, writeStashDBCache } = await load();
        writeStashDBCache("2026-06-01", [{ id: "a" }] as never);
        vi.useFakeTimers();
        vi.setSystemTime(Date.now() + 11 * 60 * 60 * 1000);
        expect(readStashDBCache("2026-06-01")).not.toBeNull();
    });

    it("rejects an entry stamped in the future", async () => {
        // Clock moved backwards. A naive age check makes this entry
        // valid until real time catches up, which can be hours.
        const { readStashDBCache } = await load();
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                sinceIsoDate: "2026-06-01",
                fetchedAt: Date.now() + 60 * 60 * 1000,
                scenes: [{ id: "a" }],
            }),
        );
        expect(readStashDBCache("2026-06-01")).toBeNull();
    });

    it("ignores an unreadable entry", async () => {
        const { readStashDBCache } = await load();
        localStorage.setItem(CACHE_KEY, "{not json");
        expect(readStashDBCache("2026-06-01")).toBeNull();
    });

    it("ignores an entry whose scenes are not a list", async () => {
        // This parses cleanly and then explodes at the call site, which
        // is worse than a cache miss.
        const { readStashDBCache } = await load();
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                sinceIsoDate: "2026-06-01",
                fetchedAt: Date.now(),
                scenes: { nope: true },
            }),
        );
        expect(readStashDBCache("2026-06-01")).toBeNull();
    });

    it("clears on invalidate", async () => {
        const { readStashDBCache, writeStashDBCache, invalidateStashDBCache } =
            await load();
        writeStashDBCache("2026-06-01", [{ id: "a" }] as never);
        invalidateStashDBCache();
        expect(readStashDBCache("2026-06-01")).toBeNull();
    });

    it("does not throw when storage refuses a write", async () => {
        const { writeStashDBCache } = await load();
        const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("QuotaExceededError");
            });
        expect(() =>
            writeStashDBCache("2026-06-01", [{ id: "a" }] as never),
        ).not.toThrow();
        setItem.mockRestore();
    });

    it("clears out entries left by older cache versions", async () => {
        // The version is part of the key, so bumping it orphans the old
        // payload rather than replacing it. Several hundred KB each,
        // never read again, and they count against the quota that this
        // very cache needs.
        const { writeStashDBCache } = await load();
        localStorage.setItem("binge.stashdb.newScenes.v2", "old");
        localStorage.setItem("binge.stashdb.newScenes.v3", "older");
        localStorage.setItem("binge.unrelated", "keep me");

        writeStashDBCache("2026-06-01", [{ id: "a" }] as never);

        expect(localStorage.getItem("binge.stashdb.newScenes.v2")).toBeNull();
        expect(localStorage.getItem("binge.stashdb.newScenes.v3")).toBeNull();
        expect(localStorage.getItem("binge.unrelated")).toBe("keep me");
        expect(localStorage.getItem(CACHE_KEY)).not.toBeNull();
    });
});

describe("the memoised linked-performer list", () => {
    // getLinkedPerformers is a per_page:-1 sweep of every performer in
    // the library, and it is now on the path of a tap: pressing a
    // matched name asks it whether that person is already in the
    // library before deciding which profile to open. Re-running the
    // sweep per tap would be seconds of delay before anything opened.
    const linkedRow = (id: string, stashId: string) => ({
        id,
        name: "Ada",
        favorite: false,
        image_path: null,
        stash_ids: [
            { endpoint: "https://stashdb.org/graphql", stash_id: stashId },
        ],
    });

    function linkedReturns(performers: unknown[]) {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: { findPerformers: { performers } } }),
        }));
        vi.stubGlobal("fetch", fetchMock);
        return fetchMock;
    }

    it("answers a second tap without a second sweep", async () => {
        const fetchMock = linkedReturns([linkedRow("42", "sdb-1")]);
        const { getLinkedPerformersMemo } = await load();

        const first = await getLinkedPerformersMemo();
        const second = await getLinkedPerformersMemo();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(first).toEqual(second);
        expect(first[0]).toMatchObject({ localId: "42", stashId: "sdb-1" });
    });

    it("sweeps again once the memo has aged out", async () => {
        // Short enough that following someone and then tapping their
        // name lands on the local profile that now exists.
        vi.useFakeTimers();
        const fetchMock = linkedReturns([linkedRow("42", "sdb-1")]);
        const { getLinkedPerformersMemo } = await load();

        await getLinkedPerformersMemo();
        vi.advanceTimersByTime(61_000);
        await getLinkedPerformersMemo();

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not hand the next tap a cached failure", async () => {
        // Caching the rejected promise would mean one blip while Stash
        // restarted sent every tap for the next minute to the read-only
        // StashDB profile, complete with a Follow button for someone
        // already in the library.
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("stash is down"))
            .mockResolvedValue({
                ok: true,
                json: async () => ({
                    data: {
                        findPerformers: {
                            performers: [linkedRow("42", "sdb-1")],
                        },
                    },
                }),
            });
        vi.stubGlobal("fetch", fetchMock);
        const { getLinkedPerformersMemo } = await load();

        await expect(getLinkedPerformersMemo()).rejects.toThrow(
            "stash is down",
        );
        const retried = await getLinkedPerformersMemo();

        expect(retried[0]).toMatchObject({ localId: "42" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

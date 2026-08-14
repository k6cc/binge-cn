// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { RecentGalleryRow, RecentSceneRow } from "../api/queries";

// useFeed is what everyone sees first, and almost everything it does is a
// judgement call that fails quietly: which scenes count as a batch import,
// which count as back-catalog, which galleries are junk, and what order
// the result lands in. None of that throws when it goes wrong, the feed
// just looks subtly off, so it is exactly the kind of thing worth pinning.

const getRecentScenes = vi.fn();
const getScenesByDate = vi.fn();
const getRecentGalleries = vi.fn();
const getGalleriesByDate = vi.fn();
const findImagesByGallery = vi.fn();
const fetchDiscoveryFeedItems = vi.fn();

vi.mock("./recentScenesCache", () => ({
    getRecentScenes: (...a: unknown[]) => getRecentScenes(...a),
    getScenesByDate: (...a: unknown[]) => getScenesByDate(...a),
    getRecentGalleries: (...a: unknown[]) => getRecentGalleries(...a),
    getGalleriesByDate: (...a: unknown[]) => getGalleriesByDate(...a),
}));
vi.mock("../api/queries", () => ({
    findImagesByGallery: (...a: unknown[]) => findImagesByGallery(...a),
}));
vi.mock("./discoveryFeed", () => ({
    fetchDiscoveryFeedItems: (...a: unknown[]) => fetchDiscoveryFeedItems(...a),
}));

const { useFeed } = await import("./useFeed");

// Dates stay relative to "now" so the hook's own lookback maths (default
// 30 days) still applies, but the clock is frozen per test: with a live
// clock, two calls to daysAgo(3) milliseconds apart return different
// timestamps, and a run crossing midnight UTC would shift a day stamp
// between building a row and asserting on it.
const NOW = new Date("2026-06-15T12:00:00.000Z");
const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();
const dayStamp = (n: number) => daysAgo(n).slice(0, 10);

// Rows carry at most one performer, as a nested object. The helper keeps
// taking the flat fields because that reads better at the call sites;
// `performerId: null` is how a test says "nobody is linked to this
// scene", which is the state 84% of this library's recent imports are in.
type SceneRowOverrides = Omit<Partial<RecentSceneRow>, "performer"> & {
    performerId?: string | null;
    performerName?: string;
    performerImagePath?: string | null;
    performerFavorite?: boolean;
};

function sceneRow(over: SceneRowOverrides = {}): RecentSceneRow {
    const {
        performerId = "p1",
        performerName = "Ada",
        performerImagePath = "/ada.jpg",
        performerFavorite = false,
        ...rest
    } = over;
    return {
        sceneId: "s1",
        sceneTitle: "A scene",
        sceneDetails: "",
        scenePreview: "/preview.mp4",
        sceneScreenshot: "/shot.jpg",
        sceneCreatedAt: daysAgo(1),
        sceneDate: dayStamp(1),
        sceneWidth: 1920,
        sceneHeight: 1080,
        sceneTags: [],
        studioName: null,
        filePath: null,
        performer:
            performerId === null
                ? null
                : {
                      id: performerId,
                      name: performerName,
                      imagePath: performerImagePath,
                      favorite: performerFavorite,
                      gender: null,
                  },
        ...rest,
    } as unknown as RecentSceneRow;
}

function galleryRow(over: Partial<RecentGalleryRow> = {}): RecentGalleryRow {
    return {
        galleryId: "g1",
        title: "A gallery",
        coverPath: "/cover.jpg",
        imageCount: 3,
        createdAt: daysAgo(1),
        date: dayStamp(1),
        performers: [],
        paths: ["/media/sets/a-gallery"],
        ...over,
    } as unknown as RecentGalleryRow;
}

// A batch import: n scenes for one performer, all created within a day.
const packOf = (n: number, over: SceneRowOverrides = {}) =>
    Array.from({ length: n }, (_, i) =>
        sceneRow({
            sceneId: "pack-" + i,
            sceneCreatedAt: daysAgo(2),
            ...over,
        }),
    );

const ready = async () => {
    const hook = renderHook(() => useFeed());
    await waitFor(() => expect(hook.result.current.state.kind).toBe("ready"));
    const state = hook.result.current.state;
    if (state.kind !== "ready") throw new Error("not ready");
    return { hook, items: state.items };
};

beforeEach(() => {
    // shouldAdvanceTime keeps Testing Library's waitFor polling working
    // while Date.now() stays pinned to NOW.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    localStorage.clear();
    for (const m of [
        getRecentScenes,
        getScenesByDate,
        getRecentGalleries,
        getGalleriesByDate,
        findImagesByGallery,
        fetchDiscoveryFeedItems,
    ]) {
        m.mockReset();
    }
    getRecentScenes.mockResolvedValue([]);
    getScenesByDate.mockResolvedValue([]);
    getRecentGalleries.mockResolvedValue([]);
    getGalleriesByDate.mockResolvedValue([]);
    findImagesByGallery.mockResolvedValue([]);
    fetchDiscoveryFeedItems.mockResolvedValue([]);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("assembling scenes", () => {
    it("collapses one scene's performer rows into a single card", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({ performerId: "p1", performerName: "Ada" }),
            sceneRow({ performerId: "p2", performerName: "Grace" }),
        ]);
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("scene");
        expect(
            (items[0] as { performers: { name: string }[] }).performers.map(
                (p) => p.name,
            ),
        ).toEqual(["Ada", "Grace"]);
    });

    it("does not double up a scene returned by both queries", async () => {
        // A scene whose created_at AND date both fall in the window comes
        // back from each query; the performer must not appear twice.
        const row = sceneRow();
        getRecentScenes.mockResolvedValue([row]);
        getScenesByDate.mockResolvedValue([row]);
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect((items[0] as { performers: unknown[] }).performers).toHaveLength(
            1,
        );
    });

    it("keeps distinct performers on a scene returned by both queries", async () => {
        getRecentScenes.mockResolvedValue([sceneRow({ performerId: "p1" })]);
        getScenesByDate.mockResolvedValue([
            sceneRow({ performerId: "p1" }),
            sceneRow({ performerId: "p2", performerName: "Grace" }),
        ]);
        const { items } = await ready();
        expect((items[0] as { performers: unknown[] }).performers).toHaveLength(
            2,
        );
    });
});

describe("back-catalog classification", () => {
    it("marks a scene older than the window as a repost", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({ sceneDate: "2019-01-01", sceneCreatedAt: daysAgo(1) }),
        ]);
        const { items } = await ready();
        const item = items[0] as { isRepost: boolean; effectiveAt: string };
        expect(item.isRepost).toBe(true);
        // Sorted by when it was added, not its years-old release date,
        // otherwise a re-add would sink out of sight.
        expect(item.effectiveAt).toBe(
            (items[0] as { createdAt: string }).createdAt,
        );
    });

    it("sorts a fresh scene by its release date", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({ sceneDate: dayStamp(2), sceneCreatedAt: daysAgo(1) }),
        ]);
        const { items } = await ready();
        const item = items[0] as { isRepost: boolean; effectiveAt: string };
        expect(item.isRepost).toBe(false);
        expect(item.effectiveAt).toBe(dayStamp(2));
    });

    it("falls back to the add time when a scene has no date at all", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({ sceneDate: null, sceneCreatedAt: daysAgo(3) }),
        ]);
        const { items } = await ready();
        const item = items[0] as { isRepost: boolean; effectiveAt: string };
        expect(item.isRepost).toBe(false);
        expect(item.effectiveAt).toBe(daysAgo(3));
    });
});

describe("packs", () => {
    it("collapses a batch import into one card", async () => {
        getRecentScenes.mockResolvedValue(packOf(10));
        const { items } = await ready();
        expect(items).toHaveLength(1);
        const pack = items[0] as { kind: string; sceneCount: number };
        expect(pack.kind).toBe("pack");
        expect(pack.sceneCount).toBe(10);
    });

    it("leaves a handful of scenes as individual cards", async () => {
        getRecentScenes.mockResolvedValue(packOf(7));
        const { items } = await ready();
        expect(items).toHaveLength(7);
        expect(items.every((i) => i.kind === "scene")).toBe(true);
    });

    it("treats exactly the threshold as a pack", async () => {
        getRecentScenes.mockResolvedValue(packOf(8));
        const { items } = await ready();
        expect(items[0].kind).toBe("pack");
    });

    it("hides the packed performer's loose scenes", async () => {
        // Otherwise a bulk-import performer floods the feed with a pack
        // card AND every scene inside it.
        getRecentScenes.mockResolvedValue([
            ...packOf(9),
            sceneRow({ sceneId: "loose", sceneCreatedAt: daysAgo(2) }),
        ]);
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("pack");
    });

    it("does not pack across a spread wider than the window", async () => {
        // Nine scenes, but spread over months: that is a library, not an
        // import, so they stay individual.
        getRecentScenes.mockResolvedValue(
            Array.from({ length: 9 }, (_, i) =>
                sceneRow({
                    sceneId: "old-" + i,
                    sceneCreatedAt: daysAgo(i * 10),
                    sceneDate: null,
                }),
            ),
        );
        const { items } = await ready();
        expect(items.every((i) => i.kind === "scene")).toBe(true);
    });

    it("groups by primary performer only", async () => {
        // Ten scenes each with a different lead but sharing a co-star:
        // the co-star must not gather them into a pack.
        getRecentScenes.mockResolvedValue(
            Array.from({ length: 10 }, (_, i) => [
                sceneRow({
                    sceneId: "m-" + i,
                    performerId: "lead-" + i,
                    sceneCreatedAt: daysAgo(2),
                }),
                sceneRow({
                    sceneId: "m-" + i,
                    performerId: "costar",
                    sceneCreatedAt: daysAgo(2),
                }),
            ]).flat(),
        );
        const { items } = await ready();
        expect(items.every((i) => i.kind === "scene")).toBe(true);
        expect(items).toHaveLength(10);
    });

    it("dates a pack by when it was imported, not when it was released", async () => {
        getRecentScenes.mockResolvedValue(
            packOf(9, { sceneDate: "2015-06-01" }),
        );
        const { items } = await ready();
        const pack = items[0] as {
            effectiveAt: string;
            createdAt: string;
            isRepost: boolean;
        };
        expect(pack.effectiveAt).toBe(pack.createdAt);
        expect(pack.isRepost).toBe(true);
    });

    it("does not call an undated batch back-catalog", async () => {
        getRecentScenes.mockResolvedValue(packOf(9, { sceneDate: null }));
        const { items } = await ready();
        expect((items[0] as { isRepost: boolean }).isRepost).toBe(false);
    });
});

describe("galleries", () => {
    it("shows a normal gallery with its images", async () => {
        getRecentGalleries.mockResolvedValue([galleryRow()]);
        findImagesByGallery.mockResolvedValue([{ id: "i1" }]);
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("gallery");
        expect((items[0] as { images: unknown[] }).images).toHaveLength(1);
    });

    it("drops generated screenshot and cover folders", async () => {
        getRecentGalleries.mockResolvedValue([
            galleryRow({ galleryId: "a", paths: ["/media/Screenshots"] }),
            galleryRow({ galleryId: "b", paths: ["/media/scr"] }),
            galleryRow({ galleryId: "c", paths: ["/media/Covers"] }),
            galleryRow({ galleryId: "d", paths: ["/media/proof"] }),
            galleryRow({ galleryId: "e", paths: ["C:\\media\\Screens"] }),
        ]);
        const { items } = await ready();
        expect(items).toEqual([]);
    });

    it("keeps a gallery whose name merely contains a noise word", async () => {
        getRecentGalleries.mockResolvedValue([
            galleryRow({ galleryId: "keep", paths: ["/media/undercover set"] }),
            galleryRow({ galleryId: "keep2", paths: ["/media/set/cover.jpg"] }),
        ]);
        const { items } = await ready();
        expect(items).toHaveLength(2);
    });

    it("still shows a gallery whose images fail to load", async () => {
        getRecentGalleries.mockResolvedValue([galleryRow()]);
        findImagesByGallery.mockRejectedValue(new Error("nope"));
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect((items[0] as { images: unknown[] }).images).toEqual([]);
    });

    it("does not query galleries at all when the setting is off", async () => {
        localStorage.setItem("binge.showGalleries", "0");
        await ready();
        expect(getRecentGalleries).not.toHaveBeenCalled();
        expect(getGalleriesByDate).not.toHaveBeenCalled();
    });
});

describe("discovery", () => {
    it("mixes StashDB items into the feed", async () => {
        fetchDiscoveryFeedItems.mockResolvedValue([
            { key: "d1", effectiveAt: daysAgo(1), source: "trending" },
        ]);
        const { items } = await ready();
        expect(items.map((i) => i.kind)).toContain("discovery");
    });

    it("is skipped when the StashDB setting is off", async () => {
        localStorage.setItem("binge.includeStashDB", "0");
        await ready();
        expect(fetchDiscoveryFeedItems).not.toHaveBeenCalled();
    });
});

describe("ordering", () => {
    it("puts the most recent first across every card type", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({ sceneId: "old", sceneDate: dayStamp(9) }),
            sceneRow({ sceneId: "new", sceneDate: dayStamp(1) }),
        ]);
        getRecentGalleries.mockResolvedValue([
            galleryRow({ galleryId: "mid", date: dayStamp(5) }),
        ]);
        fetchDiscoveryFeedItems.mockResolvedValue([
            { key: "disc", effectiveAt: dayStamp(3), source: "trending" },
        ]);
        const { items } = await ready();
        const order = items.map((i) => i.key);
        expect(order).toEqual([
            "scene:new",
            "disc",
            "gallery:mid",
            "scene:old",
        ]);
    });
});

describe("failure handling", () => {
    it("surfaces the error instead of spinning forever", async () => {
        getRecentScenes.mockRejectedValue(new Error("stash is down"));
        const hook = renderHook(() => useFeed());
        await waitFor(() =>
            expect(hook.result.current.state.kind).toBe("error"),
        );
        const state = hook.result.current.state;
        expect(state.kind === "error" && state.message).toBe("stash is down");
    });

    it("recovers when retry succeeds", async () => {
        getRecentScenes.mockRejectedValueOnce(new Error("transient"));
        getRecentScenes.mockResolvedValue([sceneRow()]);
        const hook = renderHook(() => useFeed());
        await waitFor(() =>
            expect(hook.result.current.state.kind).toBe("error"),
        );

        hook.result.current.retry();

        await waitFor(() =>
            expect(hook.result.current.state.kind).toBe("ready"),
        );
    });
});

// Scenes with nobody linked in Stash. These used to be invisible: the
// flattener emitted one row per scene/performer pair, so zero performers
// meant zero rows and the scene could never reach Home. That is most of
// what this library imports, so surfacing them is the point — but doing
// it naively would bury everything else, since a single unidentified
// pack folder can hold hundreds of scenes.
describe("scenes with no performer", () => {
    it("reaches the feed at all", async () => {
        getRecentScenes.mockResolvedValue([sceneRow({ performerId: null })]);
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("scene");
        expect((items[0] as { performers: unknown[] }).performers).toEqual([]);
    });

    it("is labelled by the folder it was imported into", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({
                performerId: null,
                filePath: "Z:\\Media\\Unfiled\\Explicit Kait\\a.mp4",
            }),
        ]);
        const { items } = await ready();
        expect(
            (items[0] as { impliedSource: string | null }).impliedSource,
        ).toBe("Explicit Kait");
    });

    it("prefers the studio over the folder", async () => {
        getRecentScenes.mockResolvedValue([
            sceneRow({
                performerId: null,
                studioName: "Evil Angel",
                filePath: "Z:/Media/Whatever/a.mp4",
            }),
        ]);
        const { items } = await ready();
        expect(
            (items[0] as { impliedSource: string | null }).impliedSource,
        ).toBe("Evil Angel");
    });

    it("collapses a bulk import into one card instead of hundreds", async () => {
        // The whole reason this needs grouping: 500 loose scenes from one
        // pack folder would otherwise be 500 cards.
        getRecentScenes.mockResolvedValue(
            packOf(40, {
                performerId: null,
                filePath: "Z:/Media/Xohanna Joy Video Pack/a.mp4",
            }),
        );
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect(items[0].kind).toBe("pack");
        const pack = items[0] as { label: string; primaryPerformer: unknown };
        expect(pack.label).toBe("Xohanna Joy Video Pack");
        expect(pack.primaryPerformer).toBeNull();
    });

    it("keeps two different folders as two batches", async () => {
        getRecentScenes.mockResolvedValue([
            ...packOf(10, {
                performerId: null,
                filePath: "Z:/Media/Pack A/a.mp4",
            }).map((r, i) => ({ ...r, sceneId: "a-" + i })),
            ...packOf(10, {
                performerId: null,
                filePath: "Z:/Media/Pack B/a.mp4",
            }).map((r, i) => ({ ...r, sceneId: "b-" + i })),
        ]);
        const { items } = await ready();
        expect(items).toHaveLength(2);
        expect(items.map((i) => (i as { label: string }).label).sort()).toEqual(
            ["Pack A", "Pack B"],
        );
    });

    it("never groups scenes whose source could not be worked out", async () => {
        // No studio, and a file sitting straight in the library root.
        // Batching those together would invent a relationship between
        // scenes that have nothing in common but being unidentified.
        getRecentScenes.mockResolvedValue(
            packOf(20, { performerId: null, filePath: "Z:/Media/a.mp4" }).map(
                (r, i) => ({ ...r, sceneId: "x-" + i }),
            ),
        );
        const { items } = await ready();
        expect(items).toHaveLength(20);
        expect(items.every((i) => i.kind === "scene")).toBe(true);
    });

    it("does not mix an unattributed batch with a performer's", async () => {
        // A performer id and a folder name are different namespaces, and
        // a performer whose id is "Ada" must not absorb folder "Ada".
        getRecentScenes.mockResolvedValue([
            ...packOf(10).map((r, i) => ({ ...r, sceneId: "p-" + i })),
            ...packOf(10, {
                performerId: null,
                filePath: "Z:/Media/p1/a.mp4",
            }).map((r, i) => ({ ...r, sceneId: "u-" + i })),
        ]);
        const { items } = await ready();
        expect(items).toHaveLength(2);
        const labels = items.map((i) => (i as { label: string }).label).sort();
        expect(labels).toEqual(["Ada", "p1"]);
    });

    it("still packs by performer when one is linked", async () => {
        // The folder is present but irrelevant: a linked performer wins,
        // so this must not split into folder batches.
        getRecentScenes.mockResolvedValue(
            packOf(10, { filePath: "Z:/Media/Some Folder/a.mp4" }),
        );
        const { items } = await ready();
        expect(items).toHaveLength(1);
        expect((items[0] as { label: string }).label).toBe("Ada");
    });

    it("gives a performer's pack their name as the label", async () => {
        getRecentScenes.mockResolvedValue(packOf(10));
        const { items } = await ready();
        expect((items[0] as { label: string }).label).toBe("Ada");
    });
});

// The label comes from a folder, and which folder is the library root
// can only be worked out by comparing the paths against each other.
// Getting that wrong is not cosmetic: it collapses everything into one
// batch named after a directory that means nothing.
describe("working out the library root from the batch", () => {
    const rowsUnder = (paths: string[]) =>
        paths.map((filePath, i) =>
            sceneRow({
                sceneId: "s-" + i,
                performerId: null,
                filePath,
            }),
        );

    it("does not label a whole library after a home directory", () => {
        getRecentScenes.mockResolvedValue(
            rowsUnder([
                "/home/bob/media/Vixen/a.mp4",
                "/home/bob/media/Tushy/b.mp4",
            ]),
        );
        return ready().then(({ items }) => {
            const labels = items
                .map(
                    (i) =>
                        (i as { impliedSource: string | null }).impliedSource,
                )
                .sort();
            expect(labels).toEqual(["Tushy", "Vixen"]);
        });
    });

    it("keeps them apart rather than merging into one batch", async () => {
        // The failure this guards: with everything resolving to "bob",
        // eight scenes from unrelated sources become a single pack.
        getRecentScenes.mockResolvedValue(
            rowsUnder(
                Array.from({ length: 10 }, (_, i) =>
                    i % 2 === 0
                        ? `/home/bob/media/Vixen/${i}.mp4`
                        : `/home/bob/media/Tushy/${i}.mp4`,
                ),
            ).map((r, i) => ({
                ...r,
                sceneCreatedAt: daysAgo(2),
                sceneId: "x" + i,
            })),
        );
        const { items } = await ready();
        expect(items.every((i) => i.kind === "scene")).toBe(true);
        expect(items).toHaveLength(10);
    });

    it("measures each drive separately when a library spans two", async () => {
        getRecentScenes.mockResolvedValue(
            rowsUnder([
                "Z:\\Media\\Ada\\a.mp4",
                "Z:\\Media\\Bea\\b.mp4",
                "D:\\Porn\\Cleo\\c.mp4",
                "D:\\Porn\\Dee\\d.mp4",
            ]),
        );
        const { items } = await ready();
        const labels = items
            .map((i) => (i as { impliedSource: string | null }).impliedSource)
            .sort();
        expect(labels).toEqual(["Ada", "Bea", "Cleo", "Dee"]);
    });
});

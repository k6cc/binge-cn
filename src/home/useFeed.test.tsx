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

function sceneRow(over: Partial<RecentSceneRow> = {}): RecentSceneRow {
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
        performerId: "p1",
        performerName: "Ada",
        performerImagePath: "/ada.jpg",
        performerFavorite: false,
        ...over,
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
const packOf = (n: number, over: Partial<RecentSceneRow> = {}) =>
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

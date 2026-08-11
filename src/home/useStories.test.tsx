// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { RecentSceneRow } from "../api/queries";

// The stories row merges four independent sources into one strip per
// performer: library scenes, StashDB releases, Reddit posts and PornHub
// uploads. Three of those come from a daemon that is routinely absent, so
// the interesting behaviour is what survives when a source is missing,
// and whether ordering still means anything once they are interleaved.

const getRecentScenes = vi.fn();
const getScenesByDate = vi.fn();
const invalidateRecentScenes = vi.fn();
const invalidateRecentGalleries = vi.fn();
const getStashDBBox = vi.fn();
const getLinkedPerformers = vi.fn();
const getOwnedStashDBSceneIds = vi.fn();
const getNewStashDBScenesForPerformers = vi.fn();
const readStashDBCache = vi.fn();
const writeStashDBCache = vi.fn();
const invalidateStashDBCache = vi.fn();
const getCachedRedditStories = vi.fn();
const invalidateRedditCaches = vi.fn();
const getPornhubStories = vi.fn();

vi.mock("./recentScenesCache", () => ({
    getRecentScenes: (...a: unknown[]) => getRecentScenes(...a),
    getScenesByDate: (...a: unknown[]) => getScenesByDate(...a),
    invalidateRecentScenes: (...a: unknown[]) => invalidateRecentScenes(...a),
    invalidateRecentGalleries: (...a: unknown[]) =>
        invalidateRecentGalleries(...a),
}));
vi.mock("../api/stashdb", () => ({
    getStashDBBox: (...a: unknown[]) => getStashDBBox(...a),
    getLinkedPerformers: (...a: unknown[]) => getLinkedPerformers(...a),
    getOwnedStashDBSceneIds: (...a: unknown[]) => getOwnedStashDBSceneIds(...a),
    getNewStashDBScenesForPerformers: (...a: unknown[]) =>
        getNewStashDBScenesForPerformers(...a),
    readStashDBCache: (...a: unknown[]) => readStashDBCache(...a),
    writeStashDBCache: (...a: unknown[]) => writeStashDBCache(...a),
    invalidateStashDBCache: (...a: unknown[]) => invalidateStashDBCache(...a),
}));
vi.mock("./redditCache", () => ({
    getCachedRedditStories: (...a: unknown[]) => getCachedRedditStories(...a),
    invalidateRedditCaches: (...a: unknown[]) => invalidateRedditCaches(...a),
}));
vi.mock("../api/bingeServer", () => ({
    rewriteStashAssetUrl: (u: string | null) => u,
    getPornhubStories: (...a: unknown[]) => getPornhubStories(...a),
    pornhubPreviewUrl: (id: string) => `/ph/preview/${id}`,
    pornhubThumbUrl: (u: string) => `/ph/thumb?url=${u}`,
}));

const { useStories } = await import("./useStories");

const NOW = new Date("2026-06-15T12:00:00.000Z");
const daysAgo = (n: number) =>
    new Date(NOW.getTime() - n * 24 * 3600 * 1000).toISOString();
const dayStamp = (n: number) => daysAgo(n).slice(0, 10);
const utcDaysAgo = (n: number) =>
    Math.floor((NOW.getTime() - n * 24 * 3600 * 1000) / 1000);

function row(over: Partial<RecentSceneRow> = {}): RecentSceneRow {
    return {
        sceneId: "s1",
        sceneTitle: "A scene",
        scenePreview: "/preview.mp4",
        sceneScreenshot: "/shot.jpg",
        sceneCreatedAt: daysAgo(1),
        sceneDate: dayStamp(1),
        sceneWidth: 1920,
        sceneHeight: 1080,
        performerId: "p1",
        performerName: "Ada",
        performerImagePath: "/ada.jpg",
        performerFavorite: false,
        ...over,
    } as unknown as RecentSceneRow;
}

const redditPost = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    kind: "image",
    title: "post",
    body: null,
    mediaUrl: "https://i.redd.it/a.jpg",
    linkUrl: null,
    thumbUrl: "/t.jpg",
    permalink: "https://reddit.com/r/x/1",
    domain: "i.redd.it",
    createdUtc: utcDaysAgo(1),
    ...over,
});

const ready = async () => {
    const hook = renderHook(() => useStories());
    await waitFor(() => expect(hook.result.current.state.kind).toBe("ready"));
    const state = hook.result.current.state;
    if (state.kind !== "ready") throw new Error("not ready");
    return { hook, stories: state.stories };
};

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    localStorage.clear();
    for (const m of [
        getRecentScenes,
        getScenesByDate,
        invalidateRecentScenes,
        invalidateRecentGalleries,
        getStashDBBox,
        getLinkedPerformers,
        getOwnedStashDBSceneIds,
        getNewStashDBScenesForPerformers,
        readStashDBCache,
        writeStashDBCache,
        invalidateStashDBCache,
        getCachedRedditStories,
        invalidateRedditCaches,
        getPornhubStories,
    ]) {
        m.mockReset();
    }
    getRecentScenes.mockResolvedValue([]);
    getScenesByDate.mockResolvedValue([]);
    getStashDBBox.mockResolvedValue(null);
    getLinkedPerformers.mockResolvedValue([]);
    getOwnedStashDBSceneIds.mockResolvedValue(new Set<string>());
    getNewStashDBScenesForPerformers.mockResolvedValue([]);
    readStashDBCache.mockReturnValue(null);
    getCachedRedditStories.mockResolvedValue(null);
    getPornhubStories.mockResolvedValue(null);
});

afterEach(() => {
    vi.useRealTimers();
});

describe("building a performer's strip", () => {
    it("puts each performer's scenes under them", async () => {
        getRecentScenes.mockResolvedValue([
            row({ sceneId: "a", performerId: "p1", performerName: "Ada" }),
            row({ sceneId: "b", performerId: "p2", performerName: "Bea" }),
        ]);
        const { stories } = await ready();
        expect(stories.map((s) => s.performerName).sort()).toEqual([
            "Ada",
            "Bea",
        ]);
    });

    it("lets one scene appear in both its performers' strips", async () => {
        // Deduping is per performer, not global: a two-hander belongs in
        // each of their strips.
        getRecentScenes.mockResolvedValue([
            row({ sceneId: "shared", performerId: "p1" }),
            row({ sceneId: "shared", performerId: "p2", performerName: "Bea" }),
        ]);
        const { stories } = await ready();
        expect(stories).toHaveLength(2);
        expect(stories.every((s) => s.scenes.length === 1)).toBe(true);
    });

    it("does not repeat a scene inside one strip", async () => {
        const r = row({ sceneId: "dupe" });
        getRecentScenes.mockResolvedValue([r]);
        getScenesByDate.mockResolvedValue([r]);
        const { stories } = await ready();
        expect(stories[0].scenes).toHaveLength(1);
    });

    it("dates a scene by release, falling back to when it was added", async () => {
        getRecentScenes.mockResolvedValue([
            row({ sceneId: "dated", sceneDate: dayStamp(3) }),
            row({
                sceneId: "undated",
                performerId: "p2",
                sceneDate: null,
                sceneCreatedAt: daysAgo(4),
            }),
        ]);
        const { stories } = await ready();
        const byId = Object.fromEntries(
            stories.map((s) => [s.performerId, s.scenes[0].effectiveAt]),
        );
        expect(byId.p1).toBe(dayStamp(3));
        expect(byId.p2).toBe(daysAgo(4));
    });

    it("orders a strip newest first", async () => {
        getRecentScenes.mockResolvedValue([
            row({ sceneId: "old", sceneDate: dayStamp(9) }),
            row({ sceneId: "new", sceneDate: dayStamp(1) }),
        ]);
        const { stories } = await ready();
        expect(stories[0].scenes.map((s) => s.id)).toEqual(["new", "old"]);
    });
});

describe("ordering the row", () => {
    it("puts the performer with the freshest content first", async () => {
        getRecentScenes.mockResolvedValue([
            row({ performerId: "stale", sceneDate: dayStamp(20) }),
            row({
                sceneId: "s2",
                performerId: "fresh",
                sceneDate: dayStamp(1),
            }),
        ]);
        const { stories } = await ready();
        expect(stories.map((s) => s.performerId)).toEqual(["fresh", "stale"]);
    });

    it("lifts a performer whose only fresh thing is a StashDB release", async () => {
        // Their library scenes are months old, but they have a release
        // out today, so the ring should light up ahead of everyone else.
        getRecentScenes.mockResolvedValue([
            row({ performerId: "p1", sceneDate: dayStamp(25) }),
            row({ sceneId: "s2", performerId: "p2", sceneDate: dayStamp(5) }),
        ]);
        getStashDBBox.mockResolvedValue({ api_key: "k", index: 0 });
        getLinkedPerformers.mockResolvedValue([
            {
                stashId: "sdb1",
                localId: "p1",
                name: "Ada",
                imagePath: null,
                favorite: false,
            },
        ]);
        getNewStashDBScenesForPerformers.mockResolvedValue([
            {
                id: "new-release",
                title: "Out today",
                coverUrl: null,
                releaseDate: dayStamp(0),
                performers: [{ id: "sdb1" }],
            },
        ]);
        const { stories } = await ready();
        expect(stories[0].performerId).toBe("p1");
    });
});

describe("mixing the sources", () => {
    const withStashDBAndReddit = () => {
        getRecentScenes.mockResolvedValue([
            row({ sceneId: "lib", sceneDate: dayStamp(10) }),
        ]);
        getStashDBBox.mockResolvedValue({ api_key: "k", index: 0 });
        getLinkedPerformers.mockResolvedValue([
            {
                stashId: "sdb1",
                localId: "p1",
                name: "Ada",
                imagePath: null,
                favorite: false,
            },
        ]);
        getNewStashDBScenesForPerformers.mockResolvedValue([
            {
                id: "sdbscene",
                title: "Release",
                coverUrl: null,
                releaseDate: dayStamp(1),
                performers: [{ id: "sdb1" }],
            },
        ]);
        getCachedRedditStories.mockResolvedValue([
            {
                performerStashId: "p1",
                performerName: "Ada",
                performerImagePath: null,
                performerFavorite: false,
                posts: [redditPost()],
            },
        ]);
    };

    it("keeps playable library scenes at the head of the strip", async () => {
        // Even though the StashDB release and the Reddit post are newer,
        // the library scene leads: it is the one that actually plays.
        withStashDBAndReddit();
        const { stories } = await ready();
        expect(stories[0].scenes.map((s) => s.source)).toEqual([
            "library",
            "stashdb",
            "reddit",
        ]);
    });

    it("skips a StashDB scene the user already owns", async () => {
        withStashDBAndReddit();
        getOwnedStashDBSceneIds.mockResolvedValue(new Set(["sdbscene"]));
        const { stories } = await ready();
        expect(stories[0].scenes.some((s) => s.source === "stashdb")).toBe(
            false,
        );
    });

    it("reuses the StashDB cache instead of refetching", async () => {
        withStashDBAndReddit();
        readStashDBCache.mockReturnValue([]);
        await ready();
        expect(getNewStashDBScenesForPerformers).not.toHaveBeenCalled();
    });

    it("gives a Reddit-only performer their own story", async () => {
        getCachedRedditStories.mockResolvedValue([
            {
                performerStashId: "p9",
                performerName: "Reddit Only",
                performerImagePath: "/r.jpg",
                performerFavorite: true,
                posts: [redditPost()],
            },
        ]);
        const { stories } = await ready();
        expect(stories).toHaveLength(1);
        expect(stories[0].performerName).toBe("Reddit Only");
        expect(stories[0].scenes[0].source).toBe("reddit");
    });

    it("drops a bare crosspost link card", async () => {
        getCachedRedditStories.mockResolvedValue([
            {
                performerStashId: "p1",
                performerName: "Ada",
                performerImagePath: null,
                performerFavorite: false,
                posts: [
                    redditPost({
                        id: "crosspost",
                        kind: "link",
                        thumbUrl: null,
                        domain: "reddit.com",
                        mediaUrl: null,
                    }),
                ],
            },
        ]);
        const { hook } = { hook: renderHook(() => useStories()) };
        await waitFor(() =>
            expect(hook.result.current.state.kind).toBe("ready"),
        );
        const state = hook.result.current.state;
        expect(state.kind === "ready" && state.stories).toEqual([]);
    });

    it("shows one card when the same media is crossposted", async () => {
        getCachedRedditStories.mockResolvedValue([
            {
                performerStashId: "p1",
                performerName: "Ada",
                performerImagePath: null,
                performerFavorite: false,
                posts: [
                    redditPost({ id: "a" }),
                    redditPost({ id: "b" }), // same mediaUrl
                ],
            },
        ]);
        const { stories } = await ready();
        expect(stories[0].scenes).toHaveLength(1);
    });
});

describe("when a source is unavailable", () => {
    it("still renders the library with the daemon down", async () => {
        getRecentScenes.mockResolvedValue([row()]);
        getCachedRedditStories.mockResolvedValue(null);
        getPornhubStories.mockResolvedValue(null);
        const { stories } = await ready();
        expect(stories).toHaveLength(1);
        expect(stories[0].scenes[0].source).toBe("library");
    });

    it("still renders the library with no StashDB key", async () => {
        getRecentScenes.mockResolvedValue([row()]);
        getStashDBBox.mockResolvedValue(null);
        const { stories } = await ready();
        expect(stories).toHaveLength(1);
    });

    it("does not touch a source the user turned off", async () => {
        localStorage.setItem("binge.includeStashDB", "0");
        localStorage.setItem("binge.includeReddit", "0");
        localStorage.setItem("binge.includePornhub", "0");
        getRecentScenes.mockResolvedValue([row()]);
        await ready();
        expect(getStashDBBox).not.toHaveBeenCalled();
        expect(getCachedRedditStories).not.toHaveBeenCalled();
        expect(getPornhubStories).not.toHaveBeenCalled();
    });

    it("surfaces a library failure rather than spinning", async () => {
        getRecentScenes.mockRejectedValue(new Error("stash down"));
        const hook = renderHook(() => useStories());
        await waitFor(() =>
            expect(hook.result.current.state.kind).toBe("error"),
        );
        const state = hook.result.current.state;
        expect(state.kind === "error" && state.message).toBe("stash down");
    });
});

describe("refresh", () => {
    it("clears every cache before refetching", async () => {
        getRecentScenes.mockResolvedValue([row()]);
        const { hook } = await ready();

        hook.result.current.refresh();

        expect(invalidateRecentScenes).toHaveBeenCalled();
        expect(invalidateRecentGalleries).toHaveBeenCalled();
        expect(invalidateStashDBCache).toHaveBeenCalled();
        expect(invalidateRedditCaches).toHaveBeenCalled();
        await waitFor(() => expect(getRecentScenes).toHaveBeenCalledTimes(2));
    });

    it("reports that it is refreshing for as long as the refetch runs", async () => {
        // The flag exists because the row does not drop back to a loading
        // state on refresh, so identical data would otherwise give the
        // button no feedback at all. Hold the refetch open rather than
        // racing it: with instantly-resolving mocks the true state is
        // over before an assertion can see it.
        getRecentScenes.mockResolvedValue([row()]);
        const { hook } = await ready();
        expect(hook.result.current.refreshing).toBe(false);

        let release!: (rows: unknown[]) => void;
        getRecentScenes.mockReturnValueOnce(
            new Promise((resolve) => {
                release = resolve;
            }),
        );

        hook.result.current.refresh();
        await waitFor(() => expect(hook.result.current.refreshing).toBe(true));

        release([row()]);
        await waitFor(() => expect(hook.result.current.refreshing).toBe(false));
    });
});

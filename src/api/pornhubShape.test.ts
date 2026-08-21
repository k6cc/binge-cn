// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The daemon's answers are cast, not parsed, and this one reaches a
// synchronous render path in the performer grid. A body that is not the
// shape the type claims threw during render, and with the only error
// boundary at the app root that replaced the whole of binge with the
// error screen - which did not recover on reload, because the profile
// hash survives and the reload fetched the same body again.
//
// Every shape below is one a Go daemon can produce: a marshalled nil
// element, an error object where a list was expected, and a field of
// the wrong type.

function serving(body: unknown) {
    vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
            ok: true,
            json: async () => body,
        })) as unknown as typeof fetch,
    );
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    localStorage.clear();
    localStorage.setItem("binge.bingeServerUrl", "http://localhost:7878");
});

describe("the pornhub feed", () => {
    it("drops a null element rather than handing it to the grid", async () => {
        serving([null]);
        const { getPornhubFeed } = await import("./bingeServer");
        await expect(getPornhubFeed(1)).resolves.toEqual([]);
    });

    it("returns a list when the daemon answers with an error object", async () => {
        serving({ error: "rate limited" });
        const { getPornhubFeed } = await import("./bingeServer");
        const out = await getPornhubFeed(1);
        expect(Array.isArray(out)).toBe(true);
    });

    it("coerces a field of the wrong type instead of passing it on", async () => {
        serving([
            {
                id: "v1",
                sourceUrl: "https://pornhub.com/view_video.php?viewkey=v1",
                title: 2026,
                createdUtc: "yesterday",
                duration: null,
            },
        ]);
        const { getPornhubFeed } = await import("./bingeServer");
        const out = await getPornhubFeed(1);
        expect(out).toHaveLength(1);
        // A number title reached .trim() on the render path.
        expect(out?.[0].title).toBeNull();
        // A non-numeric timestamp reached new Date(x).toISOString().
        expect(out?.[0].createdUtc).toBe(0);
        expect(out?.[0].duration).toBe(0);
    });

    it("drops an entry with no source url, which nothing could use", async () => {
        serving([{ id: "v1" }]);
        const { getPornhubFeed } = await import("./bingeServer");
        await expect(getPornhubFeed(1)).resolves.toEqual([]);
    });

    it("keeps a well-formed entry untouched", async () => {
        const good = {
            id: "v1",
            sourceUrl: "https://pornhub.com/view_video.php?viewkey=v1",
            title: "A title",
            thumbUrl: "https://cdn/x.jpg",
            uploadDate: "2026-01-01",
            duration: 120,
            viewCount: 5,
            createdUtc: 1_700_000_000,
        };
        serving([good]);
        const { getPornhubFeed } = await import("./bingeServer");
        await expect(getPornhubFeed(1)).resolves.toEqual([good]);
    });
});

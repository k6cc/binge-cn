import { beforeEach, describe, expect, it, vi } from "vitest";

// The flatteners turn Stash's nested response into the row shape every
// Home hook consumes. This is the same boundary that has produced every
// bug found so far: not the logic on either side of it, but an
// assumption about the shape passing through. Stash returns partial
// records during writes, and one unguarded dereference here takes the
// whole feed down, since a single throw fails the entire flatten.

const gql = vi.fn();
vi.mock("./graphql", () => ({ gql: (...a: unknown[]) => gql(...a) }));

const { findRecentScenes, findRecentGalleries } = await import("./queries");

const sceneNode = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    title: "A scene",
    details: "",
    created_at: "2026-06-01T00:00:00Z",
    date: "2026-06-01",
    files: [{ width: 1920, height: 1080 }],
    paths: { screenshot: "/shot.jpg", preview: "/preview.mp4" },
    performers: [
        {
            id: "p1",
            name: "Ada",
            image_path: "/ada.jpg",
            favorite: false,
            gender: "FEMALE",
        },
    ],
    tags: [{ id: "t1", name: "Blonde" }],
    ...over,
});

const galleryNode = (over: Record<string, unknown> = {}) => ({
    id: "g1",
    title: "A gallery",
    created_at: "2026-06-01T00:00:00Z",
    date: "2026-06-01",
    image_count: 12,
    folder: { path: "/media/sets/one" },
    files: [],
    cover: { paths: { thumbnail: "/thumb.jpg" } },
    performers: [],
    ...over,
});

const scenesReturn = (scenes: unknown[]) =>
    gql.mockResolvedValue({ findScenes: { scenes } });
const galleriesReturn = (galleries: unknown[]) =>
    gql.mockResolvedValue({ findGalleries: { galleries } });

beforeEach(() => {
    gql.mockReset();
});

describe("flattening scenes", () => {
    it("emits one row per scene and performer pair", async () => {
        scenesReturn([
            sceneNode({
                performers: [
                    {
                        id: "p1",
                        name: "Ada",
                        image_path: null,
                        favorite: true,
                        gender: "FEMALE",
                    },
                    {
                        id: "p2",
                        name: "Bea",
                        image_path: null,
                        favorite: false,
                        gender: "FEMALE",
                    },
                ],
            }),
        ]);
        const rows = await findRecentScenes("2026-06-01");
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.performerName)).toEqual(["Ada", "Bea"]);
        // The scene half of each row is identical; only the performer differs.
        expect(rows[0].sceneId).toBe(rows[1].sceneId);
    });

    it("carries the scene's own fields onto every row", async () => {
        scenesReturn([sceneNode()]);
        const [row] = await findRecentScenes("2026-06-01");
        expect(row).toMatchObject({
            sceneId: "s1",
            sceneTitle: "A scene",
            sceneScreenshot: "/shot.jpg",
            scenePreview: "/preview.mp4",
            sceneWidth: 1920,
            sceneHeight: 1080,
            performerId: "p1",
            performerFavorite: false,
            performerGender: "FEMALE",
        });
        expect(row.sceneTags).toEqual([{ id: "t1", name: "Blonde" }]);
    });

    it("takes dimensions from the first file, and copes with none", async () => {
        scenesReturn([
            sceneNode({ files: [] }),
            sceneNode({ id: "s2", files: null }),
        ]);
        const rows = await findRecentScenes("2026-06-01");
        expect(rows.every((r) => r.sceneWidth === null)).toBe(true);
        expect(rows.every((r) => r.sceneHeight === null)).toBe(true);
    });

    it("survives a scene with null performers or tags", async () => {
        scenesReturn([
            sceneNode({ performers: null, tags: null }),
            sceneNode({ id: "ok" }),
        ]);
        const rows = await findRecentScenes("2026-06-01");
        expect(rows).toHaveLength(1);
        expect(rows[0].sceneId).toBe("ok");
    });

    it("survives a scene with null paths", async () => {
        // Deliberately keeps a performer on the scene: the paths
        // dereference happens inside the performer loop, so a scene with
        // no performers never reaches it and would prove nothing.
        scenesReturn([sceneNode({ paths: null }), sceneNode({ id: "ok" })]);
        const rows = await findRecentScenes("2026-06-01");
        expect(rows).toHaveLength(2);
        expect(rows[0].sceneScreenshot).toBeNull();
        expect(rows[0].scenePreview).toBeNull();
        expect(rows[1].sceneScreenshot).toBe("/shot.jpg");
    });

    it("keeps a scene whose paths object is present but empty", async () => {
        scenesReturn([sceneNode({ paths: {} })]);
        const [row] = await findRecentScenes("2026-06-01");
        expect(row.sceneScreenshot).toBeUndefined();
        expect(row.scenePreview).toBeUndefined();
    });

    it("defaults a missing gender to null rather than dropping the row", async () => {
        scenesReturn([
            sceneNode({
                performers: [
                    {
                        id: "p1",
                        name: "Ada",
                        image_path: null,
                        favorite: false,
                        gender: null,
                    },
                ],
            }),
        ]);
        const [row] = await findRecentScenes("2026-06-01");
        expect(row.performerGender).toBeNull();
    });

    it("drops a scene that has no performers at all", async () => {
        // DOCUMENTING, not endorsing. One row per scene/performer pair
        // means a scene with nobody attached produces no rows, so it can
        // never reach Home. On the maintainer's library that is 41% of
        // all scenes. assemblePacks in useFeed still carries a branch for
        // scenes with no primary performer, which nothing can now reach.
        scenesReturn([sceneNode({ performers: [] })]);
        await expect(findRecentScenes("2026-06-01")).resolves.toEqual([]);
    });

    it("returns nothing for an empty result", async () => {
        scenesReturn([]);
        await expect(findRecentScenes("2026-06-01")).resolves.toEqual([]);
    });
});

describe("mapping galleries", () => {
    it("maps a complete gallery", async () => {
        galleriesReturn([galleryNode()]);
        const [row] = await findRecentGalleries("2026-06-01");
        expect(row).toMatchObject({
            galleryId: "g1",
            title: "A gallery",
            coverPath: "/thumb.jpg",
            imageCount: 12,
        });
        expect(row.paths).toEqual(["/media/sets/one"]);
    });

    it("collects paths from the folder and every file", async () => {
        // The noise-gallery filter matches on these, so a missed path is
        // a screenshots folder leaking into the feed.
        galleriesReturn([
            galleryNode({
                folder: { path: "/media/set" },
                files: [{ path: "/media/set/a.zip" }, { path: null }],
            }),
        ]);
        const [row] = await findRecentGalleries("2026-06-01");
        expect(row.paths).toEqual(["/media/set", "/media/set/a.zip"]);
    });

    it("copes with no folder and no files", async () => {
        galleriesReturn([galleryNode({ folder: null, files: null })]);
        const [row] = await findRecentGalleries("2026-06-01");
        expect(row.paths).toEqual([]);
    });

    it("copes with a cover that has no paths", async () => {
        galleriesReturn([
            galleryNode({ cover: null }),
            galleryNode({ id: "g2", cover: {} }),
        ]);
        const rows = await findRecentGalleries("2026-06-01");
        expect(rows.map((r) => r.coverPath)).toEqual([null, null]);
    });

    it("gives a gallery with null performers an empty list", async () => {
        // The feed maps over this without checking.
        galleriesReturn([galleryNode({ performers: null })]);
        const [row] = await findRecentGalleries("2026-06-01");
        expect(row.performers).toEqual([]);
    });
});

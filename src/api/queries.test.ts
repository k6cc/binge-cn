import { beforeEach, describe, expect, it, vi } from "vitest";

// The flatteners turn Stash's nested response into the row shape every
// Home hook consumes. This is the same boundary that has produced every
// bug found so far: not the logic on either side of it, but an
// assumption about the shape passing through. Stash returns partial
// records during writes, and one unguarded dereference here takes the
// whole feed down, since a single throw fails the entire flatten.

const gql = vi.fn();
vi.mock("./graphql", () => ({ gql: (...a: unknown[]) => gql(...a) }));

const { findRecentScenes, findRecentGalleries, findTagByName } =
    await import("./queries");

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
        expect(rows.map((r) => r.performer?.name)).toEqual(["Ada", "Bea"]);
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
            performer: {
                id: "p1",
                favorite: false,
                gender: "FEMALE",
            },
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
        // A partial write can null the whole list. That is treated the
        // same as an empty one: the scene still gets its row, with
        // nobody on it, rather than throwing and taking the feed down.
        scenesReturn([
            sceneNode({ performers: null, tags: null }),
            sceneNode({ id: "ok" }),
        ]);
        const rows = await findRecentScenes("2026-06-01");
        expect(rows).toHaveLength(2);
        expect(rows[0].performer).toBeNull();
        expect(rows[0].sceneTags).toEqual([]);
        expect(rows[1].sceneId).toBe("ok");
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
        expect(row.performer?.gender).toBeNull();
    });

    it("still emits one row for a scene with no performers at all", async () => {
        // This used to emit NONE, which is why such scenes could never
        // reach Home: one row per scene/performer pair means zero pairs
        // is zero rows. 84% of what this library imported in a recent
        // 30-day window has nobody linked, so that silently hid most of
        // the feed's input.
        scenesReturn([sceneNode({ performers: [] })]);
        const rows = await findRecentScenes("2026-06-01");
        expect(rows).toHaveLength(1);
        expect(rows[0].performer).toBeNull();
        // The scene half still has to be filled in, or the card has
        // nothing to render.
        expect(rows[0].sceneId).toBe("s1");
        expect(rows[0].sceneScreenshot).toBe("/shot.jpg");
    });

    it("carries the studio and file path used to identify such a scene", async () => {
        scenesReturn([
            sceneNode({
                performers: [],
                studio: { name: "Evil Angel" },
                files: [{ width: 1920, height: 1080, path: "Z:/a/b.mp4" }],
            }),
        ]);
        const [row] = await findRecentScenes("2026-06-01");
        expect(row.studioName).toBe("Evil Angel");
        expect(row.filePath).toBe("Z:/a/b.mp4");
    });

    it("leaves both null when Stash knows neither", async () => {
        scenesReturn([sceneNode({ performers: [], studio: null, files: [] })]);
        const [row] = await findRecentScenes("2026-06-01");
        expect(row.studioName).toBeNull();
        expect(row.filePath).toBeNull();
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

// Stash compiles `name: { modifier: EQUALS }` to a SQL LIKE, so the rows
// that come back are not necessarily the row that was asked for. These
// pin the client-side check that turns the result back into an equality.
//
// It matters because the answer is used to pick which tag to DESTROY.
describe("findTagByName", () => {
    const rows = (...names: string[]) =>
        gql.mockResolvedValue({
            findTags: {
                tags: names.map((name, i) => ({
                    id: "t" + i,
                    name,
                    parents: [],
                })),
            },
        });

    it("returns the exactly-named row, not the first one Stash paged", async () => {
        // "_" is a single-character wildcard, so asking for
        // "Golden_Hours 📁" also matches "Golden Hours 📁", which sorts
        // first. Taking tags[0] handed back the wrong tag's id.
        rows("Golden Hours \u{1F4C1}", "Golden_Hours \u{1F4C1}");
        const hit = await findTagByName("Golden_Hours \u{1F4C1}");
        expect(hit?.name).toBe("Golden_Hours \u{1F4C1}");
        expect(hit?.id).toBe("t1");
    });

    it("returns null when only near-misses came back", async () => {
        // "%" matches any run, so "100% \u{1F4C1}" matched a tag that
        // merely starts with "100". There is no such tag; say so.
        rows("100 Percent Real \u{1F4C1}", "1000 Ways \u{1F4C1}");
        expect(await findTagByName("100% \u{1F4C1}")).toBeNull();
    });

    it("does not accept a case-insensitive match", async () => {
        // The LIKE is case-insensitive; tag names are not the same tag.
        rows("Advanced Scene Rating");
        expect(await findTagByName("advanced scene rating")).toBeNull();
    });

    it("still finds an ordinary name", async () => {
        rows("Watch Later \u{1F4C1}");
        expect((await findTagByName("Watch Later \u{1F4C1}"))?.id).toBe("t0");
    });
});

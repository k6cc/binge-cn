import { beforeEach, describe, expect, it, vi } from "vitest";

// collections.ts keeps module-level caches, so every test re-imports it
// through vi.resetModules() to get a clean slate.
const findTagByName = vi.fn();
const findTagsContaining = vi.fn();
const tagCreate = vi.fn();
const tagDestroy = vi.fn();
const tagSetParents = vi.fn();
const sceneUpdate = vi.fn();

// setSceneInCollection reads the scene's live tags before writing, so
// the tests have to say what Stash currently holds.
const gql = vi.fn();
let sceneTagIds: string[] | null = [];
vi.mock("./graphql", () => ({
    gql: (...args: unknown[]) => {
        gql(...args);
        return Promise.resolve({
            findScene:
                sceneTagIds === null
                    ? null
                    : { id: "s1", tags: sceneTagIds.map((id) => ({ id })) },
        });
    },
}));

vi.mock("./queries", () => ({
    findTagByName: (...a: unknown[]) => findTagByName(...a),
    findTagsContaining: (...a: unknown[]) => findTagsContaining(...a),
}));
vi.mock("./mutations", () => ({
    tagCreate: (...a: unknown[]) => tagCreate(...a),
    tagDestroy: (...a: unknown[]) => tagDestroy(...a),
    tagSetParents: (...a: unknown[]) => tagSetParents(...a),
    sceneUpdate: (...a: unknown[]) => sceneUpdate(...a),
}));

const FAVOURITES = "Favourite ★";
const PARENT = "binge Collections";
const SUFFIX = " 📁";

type Tag = { id: string; name: string; parents: { id: string }[] };
const tag = (id: string, name: string, parents: string[] = []): Tag => ({
    id,
    name,
    parents: parents.map((p) => ({ id: p })),
});

const load = () => import("./collections");

// A tag table findTagByName resolves against, so tests describe Stash's
// state rather than scripting call-by-call return values.
//
// This used to be a plain Map.get, i.e. an exact match - which is not
// what the real function does, and is exactly the assumption that made
// the wrong-tag deletion invisible to all 32 tests here. Stash compiles
// `modifier: EQUALS` to a SQL LIKE, so the mock does too: `_` matches
// any character, `%` any run, and the compare is case-insensitive.
// findTagByName's own exact-name check is what turns that back into a
// real equality, and it can only be tested if the mock underneath it
// behaves like the database.
function likeMatches(pattern: string, name: string): boolean {
    let rx = "";
    for (const ch of pattern) {
        if (ch === "%") rx += "[\\s\\S]*";
        else if (ch === "_") rx += "[\\s\\S]";
        else rx += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp("^" + rx + "$", "i").test(name);
}

function stashHas(tags: Tag[]) {
    const byName = new Map(tags.map((t) => [t.name, t]));
    findTagByName.mockImplementation((name: string) => {
        // Every LIKE hit, name-ASC, as Stash would page them...
        const hits = tags
            .filter((t) => likeMatches(name, t.name))
            .sort((a, b) => a.name.localeCompare(b.name));
        // ...and then the exact-name check the real one applies.
        return Promise.resolve(hits.find((t) => t.name === name) ?? null);
    });
    return byName;
}

beforeEach(() => {
    vi.resetModules();
    for (const m of [
        findTagByName,
        findTagsContaining,
        tagCreate,
        tagDestroy,
        tagSetParents,
        sceneUpdate,
    ]) {
        m.mockReset();
    }
    findTagsContaining.mockResolvedValue([]);
    findTagByName.mockResolvedValue(null);
    tagCreate.mockImplementation((name: string) =>
        Promise.resolve({ id: "new-" + name, name }),
    );
    tagSetParents.mockResolvedValue(undefined);
    tagDestroy.mockResolvedValue(true);
    sceneUpdate.mockResolvedValue({});
});

describe("getCollections", () => {
    it("always offers the two defaults", async () => {
        const { getCollections } = await load();
        const got = await getCollections();
        expect(got.map((c) => c.name)).toEqual(["Favourites", "Watch Later"]);
        expect(got.every((c) => c.isDefault)).toBe(true);
    });

    it("appends user collections and strips the suffix for display", async () => {
        findTagsContaining.mockResolvedValue([
            { id: "1", name: `Road Trip${SUFFIX}` },
        ]);
        const { getCollections } = await load();
        const got = await getCollections();
        expect(got.map((c) => c.name)).toEqual([
            "Favourites",
            "Watch Later",
            "Road Trip",
        ]);
        const user = got[2];
        expect(user.tagName).toBe(`Road Trip${SUFFIX}`);
        expect(user.isDefault).toBe(false);
        expect(user.icon).toBe("generic");
    });

    it("does not list Watch Later twice once it exists in Stash", async () => {
        findTagsContaining.mockResolvedValue([
            { id: "1", name: `Watch Later${SUFFIX}` },
        ]);
        const { getCollections } = await load();
        const got = await getCollections();
        expect(got.filter((c) => c.name === "Watch Later")).toHaveLength(1);
    });

    it("queries once and serves the rest from cache", async () => {
        const { getCollections } = await load();
        await getCollections();
        await getCollections();
        expect(findTagsContaining).toHaveBeenCalledTimes(1);
    });

    it("does not cache a failure, so a retry can succeed", async () => {
        findTagsContaining.mockRejectedValueOnce(new Error("network"));
        const { getCollections } = await load();
        await expect(getCollections()).rejects.toThrow("network");
        findTagsContaining.mockResolvedValue([]);
        await expect(getCollections()).resolves.toHaveLength(2);
        expect(findTagsContaining).toHaveBeenCalledTimes(2);
    });
});

describe("getCollectionTagIds", () => {
    it("resolves ids for tags that already exist", async () => {
        stashHas([
            tag("p", PARENT),
            tag("fav", FAVOURITES),
            tag("wl", `Watch Later${SUFFIX}`, ["p"]),
        ]);
        const { getCollectionTagIds } = await load();
        const map = await getCollectionTagIds();
        expect(map.get(FAVOURITES)).toBe("fav");
        expect(map.get(`Watch Later${SUFFIX}`)).toBe("wl");
        expect(tagCreate).not.toHaveBeenCalled();
    });

    it("creates a missing default under the collections parent", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES)]);
        const { getCollectionTagIds } = await load();
        const map = await getCollectionTagIds();
        expect(tagCreate).toHaveBeenCalledWith(`Watch Later${SUFFIX}`, true, [
            "p",
        ]);
        expect(map.get(`Watch Later${SUFFIX}`)).toBe(
            "new-Watch Later" + SUFFIX,
        );
    });

    it("creates the parent tag when it is missing", async () => {
        stashHas([tag("fav", FAVOURITES)]);
        const { getCollectionTagIds } = await load();
        await getCollectionTagIds();
        expect(tagCreate).toHaveBeenCalledWith(PARENT, true);
    });

    it("adopts a pre-existing collection tag into the hierarchy", async () => {
        stashHas([
            tag("p", PARENT),
            tag("fav", FAVOURITES),
            tag("old", `Road Trip${SUFFIX}`, ["someone-elses-parent"]),
        ]);
        findTagsContaining.mockResolvedValue([
            { id: "old", name: `Road Trip${SUFFIX}` },
        ]);
        const { getCollectionTagIds } = await load();
        await getCollectionTagIds();
        // Keeps the parent the user already had, adds ours.
        expect(tagSetParents).toHaveBeenCalledWith("old", [
            "someone-elses-parent",
            "p",
        ]);
    });

    it("never reparents the Favourites tag, which the rating plugin owns", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES, ["asr-parent"])]);
        const { getCollectionTagIds } = await load();
        await getCollectionTagIds();
        expect(tagSetParents).not.toHaveBeenCalledWith(
            "fav",
            expect.anything(),
        );
    });

    it("leaves a tag alone when it is already nested correctly", async () => {
        stashHas([
            tag("p", PARENT),
            tag("fav", FAVOURITES),
            tag("wl", `Watch Later${SUFFIX}`, ["p"]),
        ]);
        const { getCollectionTagIds } = await load();
        await getCollectionTagIds();
        expect(tagSetParents).not.toHaveBeenCalled();
    });

    it("still resolves the id when reparenting fails", async () => {
        // Cosmetic tidying must not cost the user their collection.
        stashHas([
            tag("p", PARENT),
            tag("fav", FAVOURITES),
            tag("wl", `Watch Later${SUFFIX}`, []),
        ]);
        tagSetParents.mockRejectedValue(new Error("no"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { getCollectionTagIds } = await load();
        const map = await getCollectionTagIds();
        expect(map.get(`Watch Later${SUFFIX}`)).toBe("wl");
        warn.mockRestore();
    });
});

describe("createCollection", () => {
    it("names the tag with the collection suffix", async () => {
        stashHas([tag("p", PARENT)]);
        const { createCollection } = await load();
        const def = await createCollection("Road Trip");
        expect(def.tagName).toBe(`Road Trip${SUFFIX}`);
        expect(tagCreate).toHaveBeenCalledWith(`Road Trip${SUFFIX}`, true, [
            "p",
        ]);
    });

    it("trims the name it was given", async () => {
        stashHas([tag("p", PARENT)]);
        const { createCollection } = await load();
        const def = await createCollection("  Spaced  ");
        expect(def.name).toBe("Spaced");
        expect(def.tagName).toBe(`Spaced${SUFFIX}`);
    });

    it("refuses an empty name", async () => {
        const { createCollection } = await load();
        await expect(createCollection("   ")).rejects.toThrow(/empty/i);
        expect(tagCreate).not.toHaveBeenCalled();
    });

    it("does not create a second tag when one already exists", async () => {
        stashHas([tag("p", PARENT), tag("x", `Road Trip${SUFFIX}`, ["p"])]);
        const { createCollection } = await load();
        await createCollection("Road Trip");
        expect(tagCreate).not.toHaveBeenCalledWith(
            `Road Trip${SUFFIX}`,
            expect.anything(),
            expect.anything(),
        );
    });

    it("notifies subscribers so an open sheet refreshes", async () => {
        stashHas([tag("p", PARENT)]);
        const { createCollection, subscribeCollections } = await load();
        const seen = vi.fn();
        subscribeCollections(seen);
        await createCollection("Road Trip");
        expect(seen).toHaveBeenCalled();
    });

    it("stops notifying once unsubscribed", async () => {
        stashHas([tag("p", PARENT)]);
        const { createCollection, subscribeCollections } = await load();
        const seen = vi.fn();
        subscribeCollections(seen)();
        await createCollection("Road Trip");
        expect(seen).not.toHaveBeenCalled();
    });

    it("invalidates the cache so the new collection shows up", async () => {
        stashHas([tag("p", PARENT)]);
        const { createCollection, getCollections } = await load();
        await getCollections();
        findTagsContaining.mockResolvedValue([
            { id: "n", name: `Road Trip${SUFFIX}` },
        ]);
        await createCollection("Road Trip");
        const after = await getCollections();
        expect(after.map((c) => c.name)).toContain("Road Trip");
    });
});

describe("deleteCollection", () => {
    it("refuses to delete Favourites, which is shared with the rating plugin", async () => {
        const { deleteCollection } = await load();
        await expect(
            deleteCollection({
                name: "Favourites",
                tagName: FAVOURITES,
                id: "fav",
                icon: "favourite",
                isDefault: true,
            }),
        ).rejects.toThrow(/ASR/);
        expect(tagDestroy).not.toHaveBeenCalled();
    });

    it("destroys the tag behind a user collection", async () => {
        // Deliberately WITHOUT the default tags or the parent. Seeding
        // them made the old create-on-delete path a no-op, which is why
        // the suite never saw it: the tags it would have minted already
        // existed. This is the state a user is in after making exactly
        // one collection and deciding against it.
        stashHas([tag("rt", `Road Trip${SUFFIX}`, ["p"])]);
        findTagsContaining.mockResolvedValue([
            { id: "rt", name: `Road Trip${SUFFIX}` },
        ]);
        const { deleteCollection, getCollections } = await load();
        const def = (await getCollections()).find(
            (c) => c.tagName === `Road Trip${SUFFIX}`,
        )!;
        await expect(deleteCollection(def)).resolves.toBe(true);
        expect(tagDestroy).toHaveBeenCalledWith("rt");
        // Deleting must not CREATE anything. This path used to resolve
        // ids with create: true, so pressing Delete minted the two
        // default collection tags and the parent - one of them in the
        // rating plugin's namespace - on the way to destroying one.
        expect(tagCreate).not.toHaveBeenCalled();
    });

    it("destroys the tag it was handed, not a LIKE near-miss", async () => {
        // An underscore is an ordinary thing to put in a folder name,
        // and it is a single-character wildcard in SQL LIKE. Resolving
        // the victim by name meant "Golden_Hours" found the id of
        // "Golden Hours" - which sorts first - and destroyed it, while
        // the collection the user pointed at stayed.
        stashHas([
            tag("p", PARENT),
            tag("fav", FAVOURITES),
            tag("gh", `Golden Hours${SUFFIX}`, ["p"]),
            tag("gu", `Golden_Hours${SUFFIX}`, ["p"]),
        ]);
        findTagsContaining.mockResolvedValue([
            { id: "gh", name: `Golden Hours${SUFFIX}` },
            { id: "gu", name: `Golden_Hours${SUFFIX}` },
        ]);
        const { deleteCollection, getCollections } = await load();
        const def = (await getCollections()).find(
            (c) => c.tagName === `Golden_Hours${SUFFIX}`,
        )!;
        await expect(deleteCollection(def)).resolves.toBe(true);
        expect(tagDestroy).toHaveBeenCalledWith("gu");
        expect(tagDestroy).not.toHaveBeenCalledWith("gh");
    });

    it("reports false for a collection that is not there", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES)]);
        const { deleteCollection } = await load();
        await expect(
            deleteCollection({
                name: "Ghost",
                tagName: `Ghost${SUFFIX}`,
                id: "",
                icon: "generic",
                isDefault: false,
            }),
        ).resolves.toBe(false);
        expect(tagDestroy).not.toHaveBeenCalled();
    });
});

describe("setSceneInCollection", () => {
    const withRoadTrip = () => {
        stashHas([
            tag("p", PARENT),
            tag("fav", FAVOURITES),
            tag("wl", `Watch Later${SUFFIX}`, ["p"]),
            tag("rt", `Road Trip${SUFFIX}`, ["p"]),
        ]);
        findTagsContaining.mockResolvedValue([
            { id: "rt", name: `Road Trip${SUFFIX}` },
        ]);
    };

    it("adds the tag while keeping the scene's other tags", async () => {
        withRoadTrip();
        sceneTagIds = ["existing"];
        const { setSceneInCollection } = await load();
        const got = await setSceneInCollection(
            "s1",
            `Road Trip${SUFFIX}`,
            true,
        );
        expect(got.inCollection).toBe(true);
        expect(sceneUpdate).toHaveBeenCalledWith({
            id: "s1",
            tag_ids: ["existing", "rt"],
        });
    });

    it("removes only the collection's tag", async () => {
        withRoadTrip();
        sceneTagIds = ["existing", "rt"];
        const { setSceneInCollection } = await load();
        await setSceneInCollection("s1", `Road Trip${SUFFIX}`, false);
        expect(sceneUpdate).toHaveBeenCalledWith({
            id: "s1",
            tag_ids: ["existing"],
        });
    });

    it("skips the write when the scene is already in the wanted state", async () => {
        withRoadTrip();
        sceneTagIds = ["rt"];
        const { setSceneInCollection } = await load();
        await setSceneInCollection("s1", `Road Trip${SUFFIX}`, true);
        expect(sceneUpdate).not.toHaveBeenCalled();
    });

    it("reports the unchanged state when the collection cannot be resolved", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES)]);
        const { setSceneInCollection } = await load();
        const got = await setSceneInCollection("s1", `Ghost${SUFFIX}`, true);
        expect(got.inCollection).toBe(false);
        expect(sceneUpdate).not.toHaveBeenCalled();
    });

    // The bug this signature exists to prevent. Tags written by another
    // path since the feed loaded, such as the score tags the rating
    // modal writes, used to be deleted by the next bookmark, because the
    // caller handed in the tag array it had held since page load and
    // this function overwrote the whole thing with it.
    it("keeps tags written since the scene was last fetched", async () => {
        withRoadTrip();
        // What the caller would have had at page load: ["existing"].
        // What Stash holds now, after a rating was applied elsewhere.
        sceneTagIds = ["existing", "score-body-4", "score-quality-5"];
        const { setSceneInCollection } = await load();
        await setSceneInCollection("s1", `Road Trip${SUFFIX}`, true);
        expect(sceneUpdate).toHaveBeenCalledWith({
            id: "s1",
            tag_ids: ["existing", "score-body-4", "score-quality-5", "rt"],
        });
    });

    // Two bookmarks in a row used to lose the first, for the same
    // reason: both writes were built from the same page-load snapshot.
    it("does not lose the previous collection on a second toggle", async () => {
        withRoadTrip();
        sceneTagIds = ["existing"];
        const { setSceneInCollection } = await load();
        await setSceneInCollection("s1", `Road Trip${SUFFIX}`, true);
        // Stash now holds the first write.
        sceneTagIds = ["existing", "rt"];
        await setSceneInCollection("s1", `Watch Later${SUFFIX}`, true);
        expect(sceneUpdate).toHaveBeenLastCalledWith({
            id: "s1",
            tag_ids: ["existing", "rt", "wl"],
        });
    });

    // A missing scene must never be read as "this scene has no tags",
    // because the next step writes that back as the truth.
    it("refuses to write when the scene cannot be read", async () => {
        withRoadTrip();
        sceneTagIds = null;
        const { setSceneInCollection } = await load();
        await expect(
            setSceneInCollection("s1", `Road Trip${SUFFIX}`, true),
        ).rejects.toThrow();
        expect(sceneUpdate).not.toHaveBeenCalled();
    });
});

// Displaying which collections a scene is in must not write anything.
// It used to create the three default tags on mount, so scrolling one
// scene put tags in the user's library, one of them in another
// plugin's namespace, contradicting this module's own stated rule.
describe("reading does not write", () => {
    it("resolves ids without creating when asked not to", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES)]);
        const { getCollectionTagIds } = await load();
        const map = await getCollectionTagIds(false);
        expect(tagCreate).not.toHaveBeenCalled();
        // The tag that does exist is still resolved.
        expect(map.get(FAVOURITES)).toBe("fav");
        // The ones that do not are absent rather than invented.
        expect(map.has(`Watch Later${SUFFIX}`)).toBe(false);
    });

    it("still creates when a save actually needs the tag", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES)]);
        const { getCollectionTagIds } = await load();
        await getCollectionTagIds(true);
        expect(tagCreate).toHaveBeenCalled();
    });
});

// A collection tag ends with the suffix. One that merely contains it
// belongs to the user, and enrolling it meant binge reparented it
// without asking and offered it for deletion.
describe("collection discovery", () => {
    it("ignores a tag that only mentions the suffix", async () => {
        stashHas([tag("p", PARENT), tag("fav", FAVOURITES)]);
        findTagsContaining.mockResolvedValue([
            { id: "mine", name: `My ${SUFFIX} notes` },
            { id: "real", name: `Road Trip${SUFFIX}` },
        ]);
        const { getCollections } = await load();
        const names = (await getCollections()).map((c) => c.tagName);
        expect(names).toContain(`Road Trip${SUFFIX}`);
        expect(names).not.toContain(`My ${SUFFIX} notes`);
    });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// This pass attaches a newly followed performer to scenes the library
// already holds. It used to read each scene's performers and write the
// list back with her appended, which is correct within one pass and
// wrong across two - following a performer and then a co-star put two
// loops in flight, and the second one's whole-array write removed the
// first performer again from every scene they share.
//
// It is now a single bulkSceneUpdate with mode ADD, resolved by Stash
// against the row it is updating. There is no read to be stale and no
// array to overwrite. So the property that matters most is no longer
// "does it read fresh" but "does it stay additive": a change from ADD to
// SET would replace every candidate scene's entire cast with just her.

const scenesForPerformer = vi.fn();
const box = vi.fn();

vi.mock("./stashdb", () => ({
    getStashDBScenesForPerformer: (...a: unknown[]) => scenesForPerformer(...a),
    getStashDBBox: () => box(),
}));

interface Call {
    query: string;
    variables: Record<string, unknown>;
}
const calls: Call[] = [];
let localScenes: {
    id: string;
    stash_ids: { endpoint: string; stash_id: string }[];
}[] = [];
let writeThrows = false;

vi.mock("./graphql", () => ({
    gql: async (query: string, variables: Record<string, unknown> = {}) => {
        calls.push({ query, variables });
        if (query.includes("FindLocalStashDBScenes")) {
            return { findScenes: { scenes: localScenes } };
        }
        if (query.includes("ScenesAddPerformer")) {
            if (writeThrows) throw new Error("stash said no");
            return { bulkSceneUpdate: [] };
        }
        throw new Error("unexpected query");
    },
}));

const SD = "https://stashdb.org/graphql";
const writes = () =>
    calls.filter((c) => c.query.includes("ScenesAddPerformer"));

beforeEach(() => {
    calls.length = 0;
    localScenes = [];
    writeThrows = false;
    scenesForPerformer.mockReset();
    box.mockReset().mockResolvedValue({ api_key: "K", index: 0 });
});

const run = async () => {
    const { linkExistingScenesToPerformer } =
        await import("./linkExistingScenes");
    return linkExistingScenesToPerformer({
        localPerformerId: "p9",
        stashDBPerformerId: "sd-aurora",
    });
};

describe("linking a followed performer to scenes already in the library", () => {
    it("adds her rather than replacing the cast", async () => {
        // The whole safety argument in one assertion. SET here would
        // wipe every listed scene's performers.
        scenesForPerformer.mockResolvedValue([{ id: "sc-a" }]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];

        const r = await run();

        expect(r).toMatchObject({ matched: 1, linked: 1, failed: false });
        expect(writes()).toHaveLength(1);
        expect(writes()[0].query).toContain("mode: ADD");
        expect(writes()[0].query).not.toContain("mode: SET");
        expect(writes()[0].variables).toEqual({
            ids: ["1"],
            performerId: "p9",
        });
    });

    it("covers the whole candidate set in one request", async () => {
        // Not one request per scene: that is what allowed two passes to
        // interleave, and it is also 2N round trips.
        scenesForPerformer.mockResolvedValue([{ id: "a" }, { id: "b" }]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "a" }] },
            { id: "2", stash_ids: [{ endpoint: SD, stash_id: "b" }] },
        ];

        const r = await run();

        expect(writes()).toHaveLength(1);
        expect(writes()[0].variables.ids).toEqual(["1", "2"]);
        expect(r.matched).toBe(2);
    });

    it("ignores a scene matched to a different stash-box", async () => {
        scenesForPerformer.mockResolvedValue([{ id: "sc-a" }]);
        localScenes = [
            {
                id: "1",
                stash_ids: [
                    { endpoint: "https://other.box/graphql", stash_id: "sc-a" },
                ],
            },
        ];

        const r = await run();

        expect(r.matched).toBe(0);
        expect(writes()).toHaveLength(0);
    });

    it("reports a failed write rather than counting it as linked", async () => {
        scenesForPerformer.mockResolvedValue([{ id: "sc-a" }]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];
        writeThrows = true;

        const r = await run();

        expect(r).toMatchObject({ matched: 1, linked: 0, failed: true });
    });

    it("says the lookup failed rather than that she has no scenes", async () => {
        // getStashDBScenesForPerformer breaks out of its pager and
        // returns what it has on a failed request, so an empty answer
        // cannot be trusted to mean "none". Telling the user she has no
        // scenes here when nobody knows is the wrong thing to say.
        scenesForPerformer.mockResolvedValue([]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];

        const r = await run();

        expect(r.lookupFailed).toBe(true);
        expect(writes()).toHaveLength(0);
    });

    it("does nothing when there is no StashDB configured", async () => {
        box.mockResolvedValue(null);
        const r = await run();
        expect(r).toMatchObject({ matched: 0, lookupFailed: true });
        expect(calls).toHaveLength(0);
    });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// This pass writes performer_ids, which sceneUpdate replaces wholesale.
// So the thing that matters most is not that it links the right scenes -
// it is that it never removes anyone from a scene it touches, and never
// writes to a scene it could not read.

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
let scenePerformers: Record<string, { id: string }[] | null> = {};

vi.mock("./graphql", () => ({
    gql: async (query: string, variables: Record<string, unknown> = {}) => {
        calls.push({ query, variables });
        if (query.includes("FindLocalStashDBScenes")) {
            return { findScenes: { scenes: localScenes } };
        }
        if (query.includes("FindScenePerformers")) {
            const p = scenePerformers[variables.id as string];
            return {
                findScene:
                    p === null ? null : { id: variables.id, performers: p },
            };
        }
        if (query.includes("SceneSetPerformers")) {
            return { sceneUpdate: { id: variables.id } };
        }
        throw new Error("unexpected query");
    },
}));

const SD = "https://stashdb.org/graphql";
const writes = () =>
    calls.filter((c) => c.query.includes("SceneSetPerformers"));

beforeEach(() => {
    calls.length = 0;
    localScenes = [];
    scenePerformers = {};
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
    it("appends her without disturbing the existing cast", async () => {
        scenesForPerformer.mockResolvedValue([{ id: "sc-a" }]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];
        scenePerformers = { "1": [{ id: "p1" }, { id: "p2" }] };

        const r = await run();

        expect(r).toMatchObject({ matched: 1, linked: 1, failed: 0 });
        expect(writes()).toHaveLength(1);
        // Everyone who was there is still there, and she is added.
        expect(writes()[0].variables.performer_ids).toEqual(["p1", "p2", "p9"]);
    });

    it("never writes to a scene it could not read", async () => {
        // A scene that reads back as null is not a scene with no
        // performers. Writing [her] to it would replace its whole cast.
        scenesForPerformer.mockResolvedValue([{ id: "sc-a" }]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];
        scenePerformers = { "1": null };

        const r = await run();

        expect(r).toMatchObject({ matched: 1, linked: 0, failed: 1 });
        expect(writes()).toHaveLength(0);
    });

    it("leaves a scene alone when she is already on it", async () => {
        scenesForPerformer.mockResolvedValue([{ id: "sc-a" }]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];
        scenePerformers = { "1": [{ id: "p9" }] };

        const r = await run();

        expect(r).toMatchObject({ alreadyLinked: 1, linked: 0 });
        expect(writes()).toHaveLength(0);
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

    it("does nothing when StashDB has no scenes for her", async () => {
        scenesForPerformer.mockResolvedValue([]);
        localScenes = [
            { id: "1", stash_ids: [{ endpoint: SD, stash_id: "sc-a" }] },
        ];

        const r = await run();

        expect(r.matched).toBe(0);
        // and did not even scan the library for nothing
        expect(
            calls.some((c) => c.query.includes("FindLocalStashDBScenes")),
        ).toBe(false);
    });

    it("does nothing when there is no StashDB configured", async () => {
        box.mockResolvedValue(null);
        const r = await run();
        expect(r).toMatchObject({ matched: 0, linked: 0 });
        expect(calls).toHaveLength(0);
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BingeScene } from "../api/queries";

// The algorithm's only outside dependency is findScenes. Mocking it lets
// the tests drive the pool deterministically, alongside a scripted rng.
const findScenes = vi.fn();
vi.mock("../api/queries", () => ({
    findScenes: (...args: unknown[]) => findScenes(...args),
}));

const { createChainAlgo } = await import("./chainAlgo");

// Minimal scene shaped like the fields the algorithm actually touches.
function scene(
    id: string,
    performers: string[] = [],
    tags: string[] = [],
): BingeScene {
    return {
        id,
        performers: performers.map((p) => ({ id: p, name: p })),
        tags: tags.map((t) => ({ id: t, name: t })),
    } as unknown as BingeScene;
}

const page = (scenes: BingeScene[]) => ({ findScenes: { scenes } });

// An rng that hands back a scripted sequence, then holds the last value.
// Deterministic picks beat hoping a real random lands where we need it.
function scriptedRng(values: number[]): () => number {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
}

beforeEach(() => {
    findScenes.mockReset();
});

describe("context building", () => {
    it("weights performers and tags from the scene just played", () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5]) });
        algo.onPlay(scene("s1", ["p1"], ["t1", "t2"]));
        const ctx = algo.getContext();
        expect(ctx.performers.get("p1")).toBe(1);
        expect(ctx.tags.get("t1")).toBe(1);
        expect(ctx.visited.has("s1")).toBe(true);
    });

    it("decays earlier weights as new scenes play", () => {
        const algo = createChainAlgo({
            rng: scriptedRng([0.5]),
            decayRate: 0.5,
        });
        algo.onPlay(scene("s1", ["p1"]));
        algo.onPlay(scene("s2", ["p2"]));
        const ctx = algo.getContext();
        // p1 decayed once, p2 is fresh.
        expect(ctx.performers.get("p1")).toBe(0.5);
        expect(ctx.performers.get("p2")).toBe(1);
    });

    it("reinforces a performer seen again instead of resetting them", () => {
        const algo = createChainAlgo({
            rng: scriptedRng([0.5]),
            decayRate: 0.5,
        });
        algo.onPlay(scene("s1", ["p1"]));
        algo.onPlay(scene("s2", ["p1"]));
        // 1 decayed to 0.5, then +1.
        expect(algo.getContext().performers.get("p1")).toBe(1.5);
    });

    it("drops weights once they decay below the cutoff", () => {
        const algo = createChainAlgo({
            rng: scriptedRng([0.5]),
            decayRate: 0.1,
        });
        algo.onPlay(scene("s1", ["p1"]));
        algo.onPlay(scene("s2", ["p2"])); // p1 -> 0.1
        algo.onPlay(scene("s3", ["p3"])); // p1 -> 0.01, below 0.05
        expect(algo.getContext().performers.has("p1")).toBe(false);
    });

    it("seeds visited so the scene that started the reel never returns", () => {
        const algo = createChainAlgo({
            rng: scriptedRng([0.5]),
            initialVisited: ["seed"],
        });
        expect(algo.getContext().visited.has("seed")).toBe(true);
    });
});

describe("dominant-attribute streak", () => {
    it("counts consecutive plays led by the same performer", () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5]) });
        algo.onPlay(scene("s1", ["p1"]));
        expect(algo.getContext().sameDominantStreak).toBe(1);
        algo.onPlay(scene("s2", ["p1"]));
        expect(algo.getContext().sameDominantStreak).toBe(2);
        expect(algo.getContext().lastDominantKey).toBe("p:p1");
    });

    it("restarts the count when the lead changes hands", () => {
        const algo = createChainAlgo({
            rng: scriptedRng([0.5]),
            decayRate: 0.1,
        });
        algo.onPlay(scene("s1", ["p1"]));
        algo.onPlay(scene("s2", ["p2"]));
        const ctx = algo.getContext();
        expect(ctx.lastDominantKey).toBe("p:p2");
        expect(ctx.sameDominantStreak).toBe(1);
    });

    it("prefers a performer over a tag when both weigh the same", () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5]) });
        algo.onPlay(scene("s1", ["p1"], ["t1"]));
        expect(algo.getContext().lastDominantKey).toBe("p:p1");
    });
});

describe("nextBatch", () => {
    it("returns chained candidates when the rng says to follow context", () => {
        // rng: seed, then 0 for every pick (0 < chainRate -> chain).
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        algo.onPlay(scene("s1", ["p1"]));
        findScenes.mockResolvedValue(
            page([scene("a", ["p1"]), scene("b", ["p1"])]),
        );

        return algo.nextBatch(2).then((out) => {
            expect(out.map((s) => s.id)).toEqual(["a", "b"]);
        });
    });

    it("never repeats a scene inside one batch", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        algo.onPlay(scene("s1", ["p1"]));
        findScenes.mockResolvedValue(
            page([scene("a", ["p1"]), scene("b", ["p1"]), scene("c", ["p1"])]),
        );
        const out = await algo.nextBatch(3);
        expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
    });

    it("excludes scenes already played", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        algo.onPlay(scene("a", ["p1"]));
        findScenes.mockResolvedValue(
            page([scene("a", ["p1"]), scene("b", ["p1"])]),
        );
        const out = await algo.nextBatch(2);
        expect(out.map((s) => s.id)).not.toContain("a");
    });

    it("ranks a shared performer above a shared tag", async () => {
        // Both candidates match context, but performer matches carry a 1.5x
        // multiplier, so the performer one must sort first and be picked.
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        algo.onPlay(scene("s1", ["p1"], ["t1"]));
        findScenes.mockResolvedValue(
            page([scene("tagged", [], ["t1"]), scene("starred", ["p1"], [])]),
        );
        const out = await algo.nextBatch(1);
        expect(out[0].id).toBe("starred");
    });

    it("goes random when there is no context yet", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        findScenes.mockResolvedValue(page([scene("r1"), scene("r2")]));
        const out = await algo.nextBatch(1);
        expect(out.map((s) => s.id)).toEqual(["r1"]);
        // With an empty context the chained query is skipped entirely.
        const sorts = findScenes.mock.calls.map(
            (c) => (c[0] as { filter: { sort: string } }).filter.sort,
        );
        expect(sorts.every((s) => s.startsWith("random"))).toBe(true);
    });

    it("forces a random injection once the streak hits the threshold", async () => {
        const algo = createChainAlgo({
            rng: scriptedRng([0.5, 0]), // 0 would otherwise always chain
            branchThreshold: 2,
        });
        algo.onPlay(scene("s1", ["p1"]));
        algo.onPlay(scene("s2", ["p1"])); // streak now 2
        findScenes.mockImplementation((vars: unknown) => {
            const v = vars as { scene_filter?: unknown };
            return Promise.resolve(
                page([
                    v.scene_filter ? scene("chained", ["p1"]) : scene("rand"),
                ]),
            );
        });
        const out = await algo.nextBatch(1);
        expect(out[0].id).toBe("rand");
        // and the streak resets so the next pick is free to chain again
        expect(algo.getContext().sameDominantStreak).toBe(0);
    });

    it("falls back to random when the chained pool is exhausted", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        algo.onPlay(scene("s1", ["p1"]));
        findScenes.mockImplementation((vars: unknown) => {
            const v = vars as { scene_filter?: unknown };
            return Promise.resolve(
                v.scene_filter ? page([]) : page([scene("rand")]),
            );
        });
        const out = await algo.nextBatch(1);
        expect(out.map((s) => s.id)).toEqual(["rand"]);
    });

    it("stops early rather than looping when the library runs dry", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        findScenes.mockResolvedValue(page([]));
        const out = await algo.nextBatch(5);
        expect(out).toEqual([]);
    });

    it("paginates the random branch instead of refetching page 1", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 1]) });
        findScenes
            .mockResolvedValueOnce(page([scene("r1")]))
            .mockResolvedValue(page([scene("r2")]));
        await algo.nextBatch(1);
        await algo.nextBatch(1);
        const pages = findScenes.mock.calls.map(
            (c) => (c[0] as { filter: { page: number } }).filter.page,
        );
        expect(pages).toEqual([1, 2]);
    });

    it("reuses one sort seed so random pages do not overlap", async () => {
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 1]) });
        findScenes.mockResolvedValue(page([scene("r1"), scene("r2")]));
        await algo.nextBatch(1);
        await algo.nextBatch(1);
        const sorts = findScenes.mock.calls.map(
            (c) => (c[0] as { filter: { sort: string } }).filter.sort,
        );
        expect(new Set(sorts).size).toBe(1);
    });

    it("queries only the strongest few attributes", async () => {
        // Five performers in context, but the INCLUDES list is capped at 3
        // so the query cannot grow without bound as the session runs on.
        const algo = createChainAlgo({ rng: scriptedRng([0.5, 0]) });
        for (const p of ["p1", "p2", "p3", "p4", "p5"]) {
            algo.onPlay(scene("s-" + p, [p]));
        }
        findScenes.mockResolvedValue(page([scene("a", ["p5"])]));
        await algo.nextBatch(1);
        const chained = findScenes.mock.calls.find(
            (c) => (c[0] as { scene_filter?: unknown }).scene_filter,
        );
        const value = (
            chained?.[0] as {
                scene_filter: { performers: { value: string[] } };
            }
        ).scene_filter.performers.value;
        expect(value).toHaveLength(3);
        // and they are the freshest, since older ones have decayed
        expect(value).toContain("p5");
    });
});

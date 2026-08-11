import { beforeEach, describe, expect, it, vi } from "vitest";

// This module parses the Advanced Rating plugin's own settings record out
// of Stash. It is the seam most likely to break silently when that plugin
// changes upstream: nothing here fails loudly, a misread key just means a
// criterion quietly vanishes from the modal or is rated under the wrong
// name. CLAUDE.md lists the exact keys to re-verify; these tests are that
// checklist, executable.

function stashConfig(plugins: Record<string, unknown>) {
    const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { configuration: { plugins } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

const load = () => import("./config");

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
});

describe("falling back to defaults", () => {
    it("uses the built-in scene criteria when the plugin is not configured", async () => {
        stashConfig({});
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.domain).toBe("scene");
        expect(cfg.groups.map((g) => g.id)).toEqual(["overall"]);
        expect(cfg.criteria.map((c) => c.id)).toContain("production_quality");
    });

    it("uses the built-in performer criteria, which are grouped", async () => {
        stashConfig({});
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("performer");
        const groupIds = new Set(cfg.criteria.map((c) => c.groupId));
        expect(groupIds.has("physical")).toBe(true);
        expect(groupIds.has("performance")).toBe(true);
    });

    it("falls back rather than throwing when Stash errors", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                ok: true,
                json: async () => ({ errors: [{ message: "boom" }] }),
            })),
        );
        const { loadRatingConfig } = await load();
        await expect(loadRatingConfig("scene")).resolves.toMatchObject({
            domain: "scene",
        });
    });

    it("falls back when the request itself fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({ ok: false })),
        );
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria.length).toBeGreaterThan(0);
    });
});

describe("reading a configured plugin", () => {
    // Stash hands plugin settings back as strings, so the parser has to
    // coerce rather than trust the types.
    const configured = {
        advancedRating: {
            scene_group_ids: "g1,g2",
            scene_group_name_g1: "Technical",
            scene_group_weight_g1: "2",
            scene_group_name_g2: "Vibe",
            scene_criteria_ids: "c1,c2",
            scene_name_c1: "Camera Work",
            scene_group_c1: "g1",
            scene_weight_c1: "1.5",
            scene_enabled_c1: "true",
            scene_desc_c1: "How it is shot",
            scene_name_c2: "Chemistry",
            scene_group_c2: "g2",
            scene_enabled_c2: true,
        },
    };

    it("parses groups with names and weights", async () => {
        stashConfig(configured);
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.groups).toEqual([
            { id: "g1", name: "Technical", weight: 2 },
            { id: "g2", name: "Vibe", weight: 1 },
        ]);
    });

    it("parses criteria with their group, weight and description", async () => {
        stashConfig(configured);
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria).toEqual([
            {
                id: "c1",
                name: "Camera Work",
                groupId: "g1",
                weight: 1.5,
                enabled: true,
                description: "How it is shot",
            },
            {
                id: "c2",
                name: "Chemistry",
                groupId: "g2",
                weight: 1,
                enabled: true,
                description: "",
            },
        ]);
    });

    it("tolerates whitespace in the id lists", async () => {
        stashConfig({
            advancedRating: {
                scene_criteria_ids: " c1 , , c2 ",
                scene_name_c1: "One",
                scene_name_c2: "Two",
            },
        });
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria.map((c) => c.id)).toEqual(["c1", "c2"]);
    });

    it("names an unknown criterion after its id rather than dropping it", async () => {
        stashConfig({
            advancedRating: { scene_criteria_ids: "brand_new" },
        });
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria.map((c) => c.name)).toEqual(["brand_new"]);
    });

    it("reattaches a criterion whose group no longer exists", async () => {
        // Otherwise it would score into a group that contributes nothing
        // and silently stop affecting the rating.
        stashConfig({
            advancedRating: {
                scene_group_ids: "g1",
                scene_criteria_ids: "c1",
                scene_group_c1: "deleted-group",
            },
        });
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria[0].groupId).toBe("g1");
    });
});

describe("enabled flags", () => {
    it("drops criteria the user disabled", async () => {
        stashConfig({
            advancedRating: {
                scene_criteria_ids: "on,off",
                scene_enabled_on: "true",
                scene_enabled_off: "false",
            },
        });
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria.map((c) => c.id)).toEqual(["on"]);
    });

    it("accepts the several shapes Stash stores a boolean in", async () => {
        stashConfig({
            advancedRating: {
                scene_criteria_ids: "a,b,c,d",
                scene_enabled_a: "1",
                scene_enabled_b: 0,
                scene_enabled_c: "FALSE",
                scene_enabled_d: true,
            },
        });
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria.map((c) => c.id)).toEqual(["a", "d"]);
    });

    it("honours the plugin's legacy disable_ keys", async () => {
        stashConfig({
            advancedRating: {
                scene_criteria_ids: "c1",
                scene_enabled_c1: "true",
                scene_disable_c1: "true",
            },
        });
        const { loadRatingConfig } = await load();
        const cfg = await loadRatingConfig("scene");
        expect(cfg.criteria).toEqual([]);
    });
});

describe("domain namespacing", () => {
    it("keeps the two domains' settings apart", async () => {
        // Both live under one plugin record, separated only by key prefix.
        // Leakage here would rate scenes against performer criteria.
        stashConfig({
            advancedRating: {
                scene_criteria_ids: "scene_only",
                scene_name_scene_only: "Scene Criterion",
                performer_criteria_ids: "perf_only",
                performer_name_perf_only: "Performer Criterion",
            },
        });
        const { loadRatingConfig } = await load();
        const scene = await loadRatingConfig("scene");
        const performer = await loadRatingConfig("performer");
        expect(scene.criteria.map((c) => c.name)).toEqual(["Scene Criterion"]);
        expect(performer.criteria.map((c) => c.name)).toEqual([
            "Performer Criterion",
        ]);
    });

    it("does not let the performer prefix swallow a scene key", async () => {
        stashConfig({
            advancedRating: { performer_criteria_ids: "p1" },
        });
        const { loadRatingConfig } = await load();
        const scene = await loadRatingConfig("scene");
        // Scene has no configured ids, so it must fall back to defaults
        // rather than adopting the performer list.
        expect(scene.criteria.map((c) => c.id)).not.toContain("p1");
    });
});

describe("caching", () => {
    it("fetches once for both domains", async () => {
        const fetchMock = stashConfig({});
        const { loadRatingConfig } = await load();
        await Promise.all([
            loadRatingConfig("scene"),
            loadRatingConfig("performer"),
            loadRatingConfig("scene"),
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("re-reads after the config is invalidated", async () => {
        const fetchMock = stashConfig({});
        const { loadRatingConfig, invalidateRatingConfig } = await load();
        await loadRatingConfig("scene");
        invalidateRatingConfig();
        await loadRatingConfig("scene");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("can invalidate a single domain", async () => {
        const fetchMock = stashConfig({});
        const { loadRatingConfig, invalidateRatingConfig } = await load();
        await loadRatingConfig("scene");
        await loadRatingConfig("performer");
        invalidateRatingConfig("scene");
        await loadRatingConfig("performer");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await loadRatingConfig("scene");
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

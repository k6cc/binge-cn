// Scribe rewrites score tags, and Stash's update mutations replace the
// whole tag array. Both facts together are how a review save destroyed
// ratings, so the rules that stop it are pinned here.
//
// These call the shipped buildUpdatedTagIds. An earlier version of this
// file re-implemented its rule locally, which meant the tests passed
// whatever the real function did.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TAG_SUFFIX } from "../rating/types";

// getTagIdByName goes through the shared graphql client; stub it so a
// requested score tag always resolves, and no network is needed.
const gqlMock = vi.fn();
vi.mock("../api/graphql", () => ({
    gql: (...args: unknown[]) => gqlMock(...args),
}));

const CRITERIA = [
    { id: "body", name: "Body" },
    { id: "quality", name: "Production Quality" },
    { id: "chem", name: "Chemistry" },
];

const tag = (id: string, name: string) => ({ id, name });

beforeEach(() => {
    gqlMock.mockReset();
    gqlMock.mockImplementation((_q: string, vars: Record<string, unknown>) => {
        const name = (
            vars?.tag_filter as { name?: { value?: string } } | undefined
        )?.name?.value;
        return Promise.resolve({
            findTags: {
                tags: name ? [{ id: `id:${name}`, name }] : [],
            },
        });
    });
});

// What survives a save, given what the subject holds and what the
// caller says about each criterion.
async function resultingIds(
    existing: { id: string; name: string }[],
    scoresByCriterion: Record<string, number | null>,
): Promise<string[]> {
    const { __testBuildUpdatedTagIds } = await import("./api");
    return __testBuildUpdatedTagIds(
        { id: "s1", tags: existing, details: "" } as never,
        CRITERIA as never,
        scoresByCriterion,
        false,
        existing,
    );
}

describe("scribe score-tag rewrites", () => {
    it("leaves alone the criteria the caller says nothing about", async () => {
        const existing = [
            tag("t1", "Amateur"),
            tag("t2", `Body${TAG_SUFFIX}: 4`),
            tag("t3", `Production Quality${TAG_SUFFIX}: 5`),
        ];
        // Only Body is spoken for.
        const ids = await resultingIds(existing, { body: 2 });
        expect(ids).toContain("t1");
        expect(ids).toContain("t3"); // the other score is untouched
        expect(ids).not.toContain("t2"); // Body's old tag replaced
        expect(ids).toContain(`id:Body${TAG_SUFFIX}: 2`);
    });

    // The regression the "only touched" rule introduced: a cleared score
    // and an untouched one were both just missing, so clearing became
    // impossible and the old tag came back every time.
    it("clears a score when the caller explicitly says null", async () => {
        const existing = [
            tag("t1", "Amateur"),
            tag("t2", `Body${TAG_SUFFIX}: 4`),
        ];
        const ids = await resultingIds(existing, { body: null });
        expect(ids).toEqual(["t1"]);
    });

    it("can clear every score at once", async () => {
        const existing = [
            tag("t2", `Body${TAG_SUFFIX}: 4`),
            tag("t3", `Production Quality${TAG_SUFFIX}: 5`),
            tag("t4", `Chemistry${TAG_SUFFIX}: 3`),
        ];
        const ids = await resultingIds(existing, {
            body: null,
            quality: null,
            chem: null,
        });
        expect(ids).toEqual([]);
    });

    it("never drops a tag that is not a score tag", async () => {
        const existing = [
            tag("t1", "Amateur"),
            tag("t5", "Volume: 3"), // matches the shape, not the suffix
            tag("t6", "Watch Later 📁"),
        ];
        const ids = await resultingIds(existing, {
            body: 5,
            quality: 5,
            chem: 5,
        });
        expect(ids).toContain("t1");
        expect(ids).toContain("t5");
        expect(ids).toContain("t6");
    });

    it("keeps a score tag for a criterion nobody has configured", async () => {
        // A criterion removed from the Advanced Rating config still has
        // its tags on scenes. They are not ours to delete.
        const existing = [tag("t7", `Retired Thing${TAG_SUFFIX}: 2`)];
        const ids = await resultingIds(existing, { body: 1 });
        expect(ids).toContain("t7");
    });

    it("changes nothing when the caller speaks for no criterion", async () => {
        const existing = [
            tag("t2", `Body${TAG_SUFFIX}: 4`),
            tag("t3", `Production Quality${TAG_SUFFIX}: 5`),
        ];
        const ids = await resultingIds(existing, {});
        expect(ids).toEqual(["t2", "t3"]);
    });
});

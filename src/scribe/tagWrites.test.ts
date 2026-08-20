// Scribe rewrites score tags, and Stash's update mutations replace the
// whole tag array. Both facts together are how a review save destroyed
// ratings, so the rules that stop it are worth pinning.

import { describe, expect, it } from "vitest";
import { TAG_SUFFIX } from "../rating/types";

// The rule under test, extracted so it can be exercised without the
// network: only the criteria actually being written lose their old
// score tag, and everything else on the subject is carried through.
function keptTags(
    existing: { id: string; name: string }[],
    criteria: { id: string; name: string }[],
    scoresByCriterion: Record<string, number>,
    ratingTagRe: RegExp,
): { id: string; name: string }[] {
    const touched = new Set(
        criteria
            .filter((c) => scoresByCriterion[c.id] != null)
            .map((c) => c.name),
    );
    return existing.filter((t) => {
        const m = (t.name || "").match(ratingTagRe);
        if (!m) return true;
        return !touched.has(m[1].trim());
    });
}

const RATING_TAG_RE = new RegExp(`^(.+?)${TAG_SUFFIX}: ([0-5])$`);

const CRITERIA = [
    { id: "body", name: "Body" },
    { id: "quality", name: "Production Quality" },
    { id: "chem", name: "Chemistry" },
];

const tag = (id: string, name: string) => ({ id, name });

describe("scribe score-tag rewrites", () => {
    it("leaves the scores it was not asked to change", () => {
        const existing = [
            tag("t1", "Amateur"),
            tag("t2", `Body${TAG_SUFFIX}: 4`),
            tag("t3", `Production Quality${TAG_SUFFIX}: 5`),
            tag("t4", `Chemistry${TAG_SUFFIX}: 3`),
        ];
        // One slider moved, the other two untouched.
        const kept = keptTags(existing, CRITERIA, { body: 2 }, RATING_TAG_RE);
        expect(kept.map((t) => t.id)).toEqual(["t1", "t3", "t4"]);
    });

    it("replaces only the criterion being written", () => {
        const existing = [tag("t2", `Body${TAG_SUFFIX}: 4`)];
        const kept = keptTags(existing, CRITERIA, { body: 1 }, RATING_TAG_RE);
        expect(kept).toEqual([]);
    });

    it("never drops a tag that is not a score tag", () => {
        const existing = [
            tag("t1", "Amateur"),
            tag("t5", "Volume: 3"),
            tag("t6", "Watch Later 📁"),
        ];
        const all = { body: 5, quality: 5, chem: 5 };
        const kept = keptTags(existing, CRITERIA, all, RATING_TAG_RE);
        expect(kept.map((t) => t.id)).toEqual(["t1", "t5", "t6"]);
    });

    it("keeps a score tag belonging to a criterion nobody configured", () => {
        // A criterion removed from the Advanced Rating config still has
        // its tags on scenes. They are not ours to delete.
        const existing = [tag("t7", `Retired Thing${TAG_SUFFIX}: 2`)];
        const kept = keptTags(existing, CRITERIA, { body: 1 }, RATING_TAG_RE);
        expect(kept.map((t) => t.id)).toEqual(["t7"]);
    });

    it("changes nothing when no scores are supplied", () => {
        const existing = [
            tag("t2", `Body${TAG_SUFFIX}: 4`),
            tag("t3", `Production Quality${TAG_SUFFIX}: 5`),
        ];
        const kept = keptTags(existing, CRITERIA, {}, RATING_TAG_RE);
        expect(kept.map((t) => t.id)).toEqual(["t2", "t3"]);
    });
});

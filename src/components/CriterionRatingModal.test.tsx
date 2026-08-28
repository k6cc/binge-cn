// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";

// The modal writes tag_ids as a whole array, so whatever list it builds
// that write from becomes the entity's complete set of tags. It used to
// build it from the copy loaded when the modal opened, which meant every
// tag added to the same scene while the modal sat open was silently
// dropped by the next star tapped. The modal can stay open indefinitely,
// and the same library is reachable from the phone and from Stash's own
// UI at the same time, so that window is not a narrow one.

const fetchScene = vi.fn();
const applyScene = vi.fn();

vi.mock("../rating/mutations", () => ({
    fetchSceneTagsAndRating: (...a: unknown[]) => fetchScene(...a),
    fetchPerformerTagsAndRating: (...a: unknown[]) => fetchScene(...a),
    applySceneTagIds: (...a: unknown[]) => applyScene(...a),
    applyPerformerTagIds: (...a: unknown[]) => applyScene(...a),
    findScoreTag: () => Promise.resolve("tag-new"),
}));

const config = {
    groups: [{ id: "g1", name: "Group", weight: 1 }],
    criteria: [
        { id: "c1", name: "Looks", groupId: "g1", weight: 1 },
        { id: "c2", name: "Sound", groupId: "g1", weight: 1 },
    ],
};

vi.mock("../rating/config", () => ({
    loadRatingConfig: () => Promise.resolve(config),
    criterionTagPrefix: (c: { name: string }) => c.name,
    scoreTagName: (c: { name: string }, s: number) => `${c.name}: ${s}`,
}));

vi.mock("../rating/precision", () => ({
    loadRatingPrecision: () => Promise.resolve(20),
}));

import { CriterionRatingModal } from "./CriterionRatingModal";

beforeEach(() => {
    fetchScene.mockReset();
    applyScene.mockReset();
    applyScene.mockResolvedValue([]);
});
afterEach(cleanup);

describe("CriterionRatingModal", () => {
    it("builds the write from a fresh read, not the list it opened with", async () => {
        // Opens seeing one tag; by the time a star is tapped the scene
        // has gained another from somewhere else.
        fetchScene
            .mockResolvedValueOnce({
                tags: [{ id: "keep-1", name: "Favourites" }],
                rating100: null,
            })
            .mockResolvedValue({
                tags: [
                    { id: "keep-1", name: "Favourites" },
                    { id: "keep-2", name: "Watch Later" },
                ],
                rating100: null,
            });

        render(
            <CriterionRatingModal
                target={{ kind: "scene", id: "s1" }}
                onClose={() => {}}
            />,
        );

        const star = await screen.findByRole("button", { name: /Looks.*3/i });
        fireEvent.click(star);

        await waitFor(() => expect(applyScene).toHaveBeenCalled());
        const written = applyScene.mock.calls[0][1] as string[];

        expect(written).toContain("keep-2");
        expect(written).toContain("keep-1");
    });

    it("does not write at all when the fresh read fails", async () => {
        fetchScene
            .mockResolvedValueOnce({
                tags: [{ id: "keep-1", name: "Favourites" }],
                rating100: null,
            })
            .mockRejectedValue(new Error("scene s1 not found"));

        render(
            <CriterionRatingModal
                target={{ kind: "scene", id: "s1" }}
                onClose={() => {}}
            />,
        );

        const star = await screen.findByRole("button", { name: /Looks.*3/i });
        fireEvent.click(star);

        await screen.findByRole("alert");
        expect(applyScene).not.toHaveBeenCalled();
    });
});

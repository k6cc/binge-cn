// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PackFeedItem } from "./useFeed";
import { PackFeedCard } from "./PackFeedCard";

// The card reaches the reel through TabContext. Stubbed rather than
// wrapped in a real provider so the assertions below stay about what
// the card renders and hands off, not about routing.
const setTab = vi.fn();
const setPinFirstSceneId = vi.fn();
const setPinnedQueue = vi.fn();
vi.mock("../tabs/TabContext", () => ({
    useTab: () => ({ setTab, setPinFirstSceneId, setPinnedQueue }),
}));

// Only the unattributed half is covered here, and deliberately: it is the
// half that must NOT claim an identity it does not have. The label comes
// from a folder name, so the card has to read as "here is a batch we
// could not identify" rather than as a performer with a profile.

const item = (over: Partial<PackFeedItem> = {}): PackFeedItem =>
    ({
        kind: "pack",
        key: "pack:s:Xohanna Joy Video Pack:2026-08-01T00:00:00Z",
        primaryPerformer: null,
        matchedPerformer: null,
        label: "Xohanna Joy Video Pack",
        sceneCount: 944,
        createdAt: "2026-08-01T00:00:00Z",
        effectiveAt: "2026-08-01T00:00:00Z",
        isRepost: false,
        scenes: [
            {
                kind: "scene",
                key: "scene:1",
                sceneId: "1",
                screenshot: "/shot-1.jpg",
                performers: [],
                matchedPerformers: [],
            },
            {
                kind: "scene",
                key: "scene:2",
                sceneId: "2",
                screenshot: "/shot-2.jpg",
                performers: [],
                matchedPerformers: [],
            },
        ],
        ...over,
    }) as unknown as PackFeedItem;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // restoreAllMocks restores spies; it does not clear the call
    // history of a vi.fn() declared at module scope, so without this
    // each test sees the previous one's calls.
    setTab.mockClear();
    setPinFirstSceneId.mockClear();
    setPinnedQueue.mockClear();
});

describe("an unattributed batch", () => {
    it("is titled by where it came from", () => {
        render(<PackFeedCard item={item()} />);
        expect(screen.getByText("Xohanna Joy Video Pack")).toBeTruthy();
        expect(screen.getByText("added 944 new scenes")).toBeTruthy();
    });

    it("claims nothing about a person", () => {
        // The label is a guess at a file layout, not a claim about
        // someone, so it must never carry a mark that says otherwise.
        // There used to be a marker here saying so outright; it was
        // explained only by a hover tooltip, so it said nothing on a
        // touch screen. What remains is the absence of any in-library
        // mark, which is the same distinction drawn more quietly.
        render(<PackFeedCard item={item()} />);
        expect(screen.queryByLabelText("In library")).toBeNull();
        expect(screen.queryByLabelText("Favourited")).toBeNull();
        expect(screen.queryByLabelText("Not in your library")).toBeNull();
    });

    it("offers no profile to open", () => {
        // There is no performer, so anything that looks like a profile
        // link would be a dead end.
        render(<PackFeedCard item={item()} />);
        expect(screen.queryByLabelText("In library")).toBeNull();
        expect(screen.queryByLabelText("Favourited")).toBeNull();
    });

    it("hands off to Stash, which is where a performer gets attached", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        render(<PackFeedCard item={item()} />);
        fireEvent.click(screen.getByLabelText("More actions"));
        fireEvent.click(screen.getByText("Find in Stash"));
        expect(open).toHaveBeenCalledWith(
            "/scenes?q=Xohanna%20Joy%20Video%20Pack",
            "_blank",
            "noopener,noreferrer",
        );
    });

    it("escapes a label that would otherwise break the search url", () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        render(
            <PackFeedCard item={item({ label: "[Onlyfans.com] S (@s)" })} />,
        );
        fireEvent.click(screen.getByLabelText("More actions"));
        fireEvent.click(screen.getByText("Find in Stash"));
        expect(open.mock.calls[0][0]).toBe(
            "/scenes?q=%5BOnlyfans.com%5D%20S%20(%40s)",
        );
    });

    it("uses a scene still for the avatar, since there is no portrait", () => {
        render(<PackFeedCard item={item()} />);
        const avatar = screen.getByLabelText(
            "Xohanna Joy Video Pack — open batch",
        );
        expect(avatar.getAttribute("style")).toContain("/shot-1.jpg");
    });

    it("falls back to an initial when no scene has a still", () => {
        render(
            <PackFeedCard
                item={item({
                    scenes: [
                        {
                            kind: "scene",
                            sceneId: "1",
                            screenshot: null,
                            performers: [],
                        },
                    ] as unknown as PackFeedItem["scenes"],
                })}
            />,
        );
        expect(screen.getByText("X")).toBeTruthy();
    });

    it("labels a back-catalog batch as reposted", () => {
        render(<PackFeedCard item={item({ isRepost: true })} />);
        expect(screen.getByText("reposted 944 scenes")).toBeTruthy();
    });
});

describe("the mosaic tiles", () => {
    it("opens the scene that was tapped, not the sheet", () => {
        // One onClick used to sit on the whole grid, so tapping the
        // second cover opened the sheet rather than the second scene -
        // while the iOS twin passed the tile actually tapped. Two
        // clients showing the same covers should not disagree about
        // what tapping one does.
        render(<PackFeedCard item={item({ sceneCount: 2 })} />);
        const tiles = screen.getAllByRole("button", { name: /^Play / });
        expect(tiles).toHaveLength(2);
        fireEvent.click(tiles[1]);
        expect(setPinnedQueue).toHaveBeenCalledWith({
            ids: ["1", "2"],
            startIndex: 1,
        });
        expect(setTab).toHaveBeenCalledWith("foryou");
        // A leftover single-scene pin would resurface in chained mode.
        expect(setPinFirstSceneId).toHaveBeenCalledWith(null);
    });

    it("still opens the sheet from the overflow tile", () => {
        // The last tile stands for everything that did not fit, so it
        // keeps its old job. Ten scenes means nine tiles and one over.
        const many = Array.from({ length: 10 }, (_, i) => ({
            kind: "scene",
            key: `scene:${i}`,
            sceneId: String(i),
            screenshot: `/shot-${i}.jpg`,
            performers: [],
            matchedPerformers: [],
        }));
        render(
            <PackFeedCard
                item={item({
                    scenes: many as never,
                    sceneCount: many.length,
                })}
            />,
        );
        const overflow = screen.getByRole("button", { name: /Open pack/ });
        fireEvent.click(overflow);
        expect(setPinnedQueue).not.toHaveBeenCalled();
        // And the other eight are still scene targets.
        expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(
            8,
        );
    });
});

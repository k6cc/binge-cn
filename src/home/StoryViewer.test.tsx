// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Story, StoryScene } from "./useStories";

// The story viewer walks two nested sequences at once: scenes within a
// performer, and performers within the row. Getting the seams wrong is
// not a crash, it is stories that skip, repeat, or strand the user on a
// black screen at the end of the row. Stepping backwards over a seam is
// the fiddliest part, because it has to land on the PREVIOUS performer's
// last scene rather than their first.

const setActiveIndex = vi.fn();
const close = vi.fn();
const viewerState = {
    isOpen: true,
    stories: [] as Story[],
    activeIndex: 0,
    open: vi.fn(),
    close,
    setActiveIndex,
};

vi.mock("./StoryViewerContext", () => ({
    useStoryViewer: () => viewerState,
}));
vi.mock("../filter/FilterContext", () => ({
    useFilter: () => ({ replace: vi.fn() }),
}));
vi.mock("../tabs/TabContext", () => ({
    useTab: () => ({
        setTab: vi.fn(),
        setPinFirstSceneId: vi.fn(),
        setReelMode: vi.fn(),
    }),
}));
vi.mock("../performer/PerformerProfileContext", () => ({
    usePerformerProfile: () => ({ openProfile: vi.fn() }),
}));
vi.mock("../performer/PerformerProfile", () => ({ VerifiedIcon: () => null }));
vi.mock("../hooks/useMuteState", () => ({
    useMuteState: () => [true, vi.fn()],
}));
vi.mock("../components/MuteToggle", () => ({
    MutedIcon: () => null,
    UnmutedIcon: () => null,
}));

const saveToStash = vi.fn();
vi.mock("../api/bingeServer", () => ({
    saveToStash: (...a: unknown[]) => saveToStash(...a),
    getBingeServerConfig: () => Promise.resolve(null),
    rewriteRedditMediaUrl: (u: string | null) => u,
    rewriteRedgifsMediaUrl: (u: string | null) => u,
}));

const { StoryViewer } = await import("./StoryViewer");

const libraryScene = (id: string): StoryScene =>
    ({
        id,
        source: "library",
        title: "Scene " + id,
        preview: `/preview/${id}.webm`,
        screenshot: `/shot/${id}.jpg`,
        date: "2026-06-01",
        createdAt: "2026-06-01T00:00:00Z",
        effectiveAt: "2026-06-01",
        width: 1920,
        height: 1080,
    }) as StoryScene;

const story = (performerId: string, sceneIds: string[]): Story =>
    ({
        performerId,
        performerName: "P" + performerId,
        performerImagePath: null,
        performerFavorite: false,
        scenes: sceneIds.map(libraryScene),
        latestEffectiveAt: "2026-06-01",
    }) as Story;

function show(stories: Story[], activeIndex = 0) {
    viewerState.stories = stories;
    viewerState.activeIndex = activeIndex;
    viewerState.isOpen = true;
    return render(<StoryViewer />);
}

// The viewer renders one <video> for the focused scene; its src is the
// simplest honest read of "which scene am I on".
const currentSceneSrc = () => {
    const v = document.querySelector("video");
    return v?.getAttribute("src") ?? null;
};

beforeEach(() => {
    // jsdom has no media pipeline: play() returns undefined where every
    // real browser returns a promise, and the component correctly
    // attaches a catch for the autoplay-policy rejection. Give it one.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() =>
        Promise.resolve(),
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
        () => undefined,
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setActiveIndex.mockReset();
    close.mockReset();
    saveToStash.mockReset();
    saveToStash.mockResolvedValue({ ok: true, result: {} });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("stepping forward", () => {
    it("moves to the next scene of the same performer", () => {
        show([story("p1", ["a", "b", "c"])]);
        expect(currentSceneSrc()).toContain("a");
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(currentSceneSrc()).toContain("b");
    });

    it("moves to the next performer after their last scene", () => {
        show([story("p1", ["a"]), story("p2", ["x"])]);
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(setActiveIndex).toHaveBeenCalledWith(1);
        expect(close).not.toHaveBeenCalled();
    });

    it("closes at the end of the last performer's last scene", () => {
        // Otherwise the user is stranded on a finished story.
        show([story("p1", ["a"]), story("p2", ["x"])], 1);
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(close).toHaveBeenCalled();
        expect(setActiveIndex).not.toHaveBeenCalled();
    });
});

describe("stepping backward", () => {
    it("moves to the previous scene of the same performer", () => {
        show([story("p1", ["a", "b"])]);
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(currentSceneSrc()).toContain("b");
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        expect(currentSceneSrc()).toContain("a");
    });

    it("moves to the previous performer when on their first scene", () => {
        show([story("p1", ["a", "b"]), story("p2", ["x"])], 1);
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        expect(setActiveIndex).toHaveBeenCalledWith(0);
    });

    it("lands on the previous performer's LAST scene, not their first", () => {
        // Going back over a seam should feel like rewinding, so it has
        // to resume where that performer's strip ended. Two effects race
        // here: changing performer resets the scene cursor to 0, and
        // goPrev schedules a follow-up that moves it to the end. If the
        // ordering ever inverts, back-navigation silently restarts the
        // previous performer from the beginning.
        const { rerender } = show(
            [story("p1", ["a", "b", "c"]), story("p2", ["x"])],
            1,
        );
        // Let the mocked context behave like the real one.
        setActiveIndex.mockImplementation((i: number) => {
            viewerState.activeIndex = i;
        });

        fireEvent.keyDown(document, { key: "ArrowLeft" });
        rerender(<StoryViewer />);
        act(() => {
            vi.advanceTimersByTime(1);
        });
        rerender(<StoryViewer />);

        expect(currentSceneSrc()).toContain("c");
    });

    it("does nothing at the very beginning", () => {
        // No wrap-around to the end of the row, and no close either.
        show([story("p1", ["a"]), story("p2", ["x"])], 0);
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        expect(setActiveIndex).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(currentSceneSrc()).toContain("a");
    });
});

describe("changing performer", () => {
    it("starts the new performer at their first scene", () => {
        const { rerender } = show([
            story("p1", ["a", "b"]),
            story("p2", ["x", "y"]),
        ]);
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(currentSceneSrc()).toContain("b");

        // The context moves the focus; the viewer must reset its own
        // scene cursor rather than carrying index 1 across.
        viewerState.activeIndex = 1;
        rerender(<StoryViewer />);
        expect(currentSceneSrc()).toContain("x");
    });
});

describe("the escape hatch", () => {
    it("closes on Escape", () => {
        show([story("p1", ["a"])]);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(close).toHaveBeenCalled();
    });

    it("ignores keys it does not own", () => {
        show([story("p1", ["a", "b"])]);
        fireEvent.keyDown(document, { key: "Enter" });
        fireEvent.keyDown(document, { key: "a" });
        expect(close).not.toHaveBeenCalled();
        expect(currentSceneSrc()).toContain("a");
    });

    it("stops listening once closed", () => {
        const { rerender } = show([story("p1", ["a"])]);
        viewerState.isOpen = false;
        rerender(<StoryViewer />);
        fireEvent.keyDown(document, { key: "Escape" });
        expect(close).not.toHaveBeenCalled();
    });
});

describe("when there is nothing to show", () => {
    it("renders nothing while closed", () => {
        viewerState.isOpen = false;
        viewerState.stories = [story("p1", ["a"])];
        const { container } = render(<StoryViewer />);
        expect(container.firstChild).toBeNull();
        expect(document.querySelector("video")).toBeNull();
    });

    it("survives an empty story list", () => {
        expect(() => show([])).not.toThrow();
    });

    it("survives a performer with no scenes", () => {
        expect(() => show([story("p1", [])])).not.toThrow();
    });
});

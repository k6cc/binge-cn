// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// This row is StashDB and nothing else, so the StashDB setting has to
// govern it. It did not, and the row stayed on Explore fetching from
// StashDB after the user had switched the integration off. Third bug of
// that shape in one day (folder names, gallery folders, genders), which
// is why it gets a test rather than just a fix.

const getStashDBBox = vi.fn();
const getTrendingStashDBPerformers = vi.fn();
const getLinkedPerformers = vi.fn();
vi.mock("../api/stashdb", () => ({
    getStashDBBox: (...a: unknown[]) => getStashDBBox(...a),
    getTrendingStashDBPerformers: (...a: unknown[]) =>
        getTrendingStashDBPerformers(...a),
    getLinkedPerformers: (...a: unknown[]) => getLinkedPerformers(...a),
}));
vi.mock("../performer/PerformerProfileContext", () => ({
    usePerformerProfile: () => ({
        openProfile: vi.fn(),
        openStashDBProfile: vi.fn(),
    }),
}));

const { DiscoverPerformersBar } = await import("./DiscoverPerformersBar");

// jsdom has no ResizeObserver, and the row observes its scroller to
// decide whether the arrows can scroll.
class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver ??=
    NoopResizeObserver as unknown as typeof ResizeObserver;

beforeEach(() => {
    localStorage.clear();
    getStashDBBox.mockReset();
    getTrendingStashDBPerformers.mockReset();
    getLinkedPerformers.mockReset();
    getStashDBBox.mockResolvedValue({
        endpoint: "https://stashdb.org/graphql",
        api_key: "k",
        index: 0,
    });
    getTrendingStashDBPerformers.mockResolvedValue([
        {
            id: "p1",
            name: "Vera",
            gender: "FEMALE",
            image: null,
            birthDate: null,
            sceneCount: 3,
        },
    ]);
    getLinkedPerformers.mockResolvedValue([]);
});
afterEach(cleanup);

describe("the StashDB setting governs this row", () => {
    it("renders and fetches when StashDB is on", async () => {
        const { container } = render(<DiscoverPerformersBar />);
        await waitFor(() => expect(getStashDBBox).toHaveBeenCalled());
        await waitFor(() => expect(container.firstChild).not.toBeNull());
    });

    it("renders nothing when StashDB is off", async () => {
        localStorage.setItem("binge.includeStashDB", "0");
        const { container } = render(<DiscoverPerformersBar />);
        expect(container.firstChild).toBeNull();
    });

    it("does not even ask StashDB when it is off", async () => {
        // Rendering nothing is not enough: the row was still fetching,
        // which is a request to a third party the user opted out of.
        localStorage.setItem("binge.includeStashDB", "0");
        render(<DiscoverPerformersBar />);
        await new Promise((r) => setTimeout(r, 50));
        expect(getStashDBBox).not.toHaveBeenCalled();
        expect(getTrendingStashDBPerformers).not.toHaveBeenCalled();
    });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { GalleryFeedItem } from "./useFeed";

// The card carries only the first few images of a gallery; the lightbox
// pages through the rest. The arithmetic is the part worth pinning: the
// first page REPLACES the card's small set rather than appending, so
// every page is the same size and the offsets stay exact. Append it
// instead and the reader sees the opening images twice, then a gap.

const findImagesByGallery = vi.fn();
vi.mock("../api/queries", () => ({
    findImagesByGallery: (...args: unknown[]) => findImagesByGallery(...args),
}));

const openProfile = vi.fn();
vi.mock("../performer/PerformerProfileContext", () => ({
    usePerformerProfile: () => ({ openProfile }),
}));

const { GalleryFeedCard } = await import("./GalleryFeedCard");

const image = (i: number) => ({
    id: String(i),
    title: `image-${i}`,
    paths: { image: `/img/${i}.jpg`, thumbnail: `/thumb/${i}.jpg` },
});

const page = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => image(from + i));

const item = (over: Partial<GalleryFeedItem> = {}): GalleryFeedItem =>
    ({
        kind: "gallery",
        key: "gallery:g1",
        galleryId: "g1",
        title: "A gallery",
        imageCount: 1496,
        createdAt: "2026-08-01T00:00:00Z",
        date: null,
        images: page(0, 10),
        performers: [
            { id: "p1", name: "Ada", image_path: null, favorite: false },
        ],
        ...over,
    }) as unknown as GalleryFeedItem;

// Opening the lightbox from the end panel puts the reader at index 0 of
// a set of 10 with 1496 claimed, which is outside the prefetch window.
// Jumping to the last loaded image is what triggers the first fetch.
const openAtLastLoaded = () => {
    fireEvent.click(screen.getByLabelText("View full gallery"));
    for (let i = 0; i < 9; i++)
        fireEvent.keyDown(document, { key: "ArrowRight" });
};

const stageSrc = () =>
    document.querySelector(".binge-lightbox-image")?.getAttribute("src");

const counter = () =>
    document.querySelector(".binge-lightbox-counter")?.textContent?.trim();

// Proof that a page actually landed. Sitting on the last loaded image
// there is no next arrow; one appears only once more images arrive. The
// counter cannot be used for this: it reads off the claimed gallery
// size, so it says the same thing before and after the fetch.
const pageLanded = () =>
    waitFor(() => expect(screen.getByLabelText("Next image")).toBeTruthy());

beforeEach(() => {
    findImagesByGallery.mockReset();
    openProfile.mockReset();
});
afterEach(cleanup);

describe("paging the whole gallery into the lightbox", () => {
    it("asks for page 1 at the full page size, not the carousel's size", () => {
        findImagesByGallery.mockResolvedValue(page(0, 60));
        render(<GalleryFeedCard item={item()} />);
        openAtLastLoaded();
        expect(findImagesByGallery).toHaveBeenCalledWith("g1", 60, 1);
    });

    it("replaces the carousel's images with page 1 rather than appending", async () => {
        // Page 1 starts at the same image the card already showed, so
        // appending would repeat images 0-9 and then skip 10-59.
        findImagesByGallery.mockResolvedValue(page(0, 60));
        render(<GalleryFeedCard item={item()} />);
        openAtLastLoaded();
        await pageLanded();
        // Index 9 must still be image 9 after the swap.
        expect(stageSrc()).toBe("/img/9.jpg");
        expect(counter()).toBe("10 / 1496");
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(stageSrc()).toBe("/img/10.jpg");
    });

    it("appends the pages after the first, in order", async () => {
        findImagesByGallery
            .mockResolvedValueOnce(page(0, 60))
            .mockResolvedValueOnce(page(60, 60));
        render(<GalleryFeedCard item={item()} />);
        openAtLastLoaded();
        await pageLanded();
        for (let i = 0; i < 50; i++)
            fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(stageSrc()).toBe("/img/59.jpg");
        expect(findImagesByGallery).toHaveBeenLastCalledWith("g1", 60, 2);
        await pageLanded();
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(stageSrc()).toBe("/img/60.jpg");
    });

    it("does not fire a second request while the first is in flight", async () => {
        let release: (v: unknown[]) => void = () => {};
        findImagesByGallery.mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            }),
        );
        render(<GalleryFeedCard item={item()} />);
        openAtLastLoaded();
        // Each keypress re-runs the prefetch check while the page is
        // still loading; without the in-flight guard that is a request
        // per keystroke.
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(findImagesByGallery).toHaveBeenCalledTimes(1);
        release(page(0, 60));
        await waitFor(() => expect(counter()).toBe("10 / 1496"));
    });

    it("stops paging when a short page says the gallery ran out", async () => {
        // image_count lags a rescan often enough that it cannot be the
        // stopping condition on its own.
        findImagesByGallery.mockResolvedValue(page(0, 12));
        render(<GalleryFeedCard item={item()} />);
        openAtLastLoaded();
        await pageLanded();
        for (let i = 0; i < 10; i++)
            fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(stageSrc()).toBe("/img/11.jpg");
        expect(findImagesByGallery).toHaveBeenCalledTimes(1);
    });

    it("stops paging after a failure instead of retrying on every move", async () => {
        findImagesByGallery.mockRejectedValue(new Error("nope"));
        render(<GalleryFeedCard item={item()} />);
        openAtLastLoaded();
        await waitFor(() =>
            expect(findImagesByGallery).toHaveBeenCalledTimes(1),
        );
        for (let i = 0; i < 5; i++) {
            fireEvent.keyDown(document, { key: "ArrowLeft" });
            fireEvent.keyDown(document, { key: "ArrowRight" });
        }
        expect(findImagesByGallery).toHaveBeenCalledTimes(1);
        // What already loaded keeps working.
        expect(stageSrc()).toBe("/img/9.jpg");
    });

    it("does not touch the network for a gallery the card already holds whole", () => {
        render(<GalleryFeedCard item={item({ imageCount: 10 })} />);
        openAtLastLoaded();
        expect(findImagesByGallery).not.toHaveBeenCalled();
    });

    it("keeps paging when image_count is stale-low", async () => {
        // Stash's image_count lags a rescan. A gallery rescanned to 200
        // whose count still reads 50 used to strand the reader at the
        // end of the first page: total became max(50, 60) = 60, the
        // prefetch short-circuited, and the remaining images were
        // unreachable even though the card had never seen a short page.
        findImagesByGallery.mockResolvedValue(page(60, 60));
        render(
            <GalleryFeedCard
                item={item({
                    imageCount: 50,
                    images: page(0, 60) as unknown as GalleryFeedItem["images"],
                })}
            />,
        );
        fireEvent.click(screen.getByLabelText("View full gallery"));
        for (let i = 0; i < 59; i++)
            fireEvent.keyDown(document, { key: "ArrowRight" });
        await waitFor(() => expect(findImagesByGallery).toHaveBeenCalled());
    });

    it("shows the gallery's real size on the end panel", () => {
        render(<GalleryFeedCard item={item()} />);
        expect(
            screen.getByLabelText("View full gallery").textContent,
        ).toContain("1496");
    });
});

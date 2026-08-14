// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PerformerImageCard } from "../api/queries";
import { ImageLightbox } from "./ImageLightbox";

// The key handler used to call goPrev/goNext before they were declared,
// and leaned on an exhaustive-deps suppression to stay quiet about it. It
// now steps the index itself. These cover the keyboard paths end to end,
// since that rewrite was never exercised in a browser.

const images = (n: number): PerformerImageCard[] =>
    Array.from({ length: n }, (_, i) => ({
        id: String(i),
        title: "image-" + i,
        paths: { image: `/img/${i}.jpg`, thumbnail: `/thumb/${i}.jpg` },
    })) as unknown as PerformerImageCard[];

const shownSrc = () =>
    (screen.getAllByRole("img")[0] as HTMLImageElement).getAttribute("src");

afterEach(cleanup);

describe("ImageLightbox", () => {
    it("opens on the image that was clicked", () => {
        render(
            <ImageLightbox
                images={images(3)}
                startIndex={1}
                onClose={vi.fn()}
            />,
        );
        expect(shownSrc()).toBe("/img/1.jpg");
    });

    it("walks forward and back with the arrow keys", () => {
        render(
            <ImageLightbox
                images={images(3)}
                startIndex={0}
                onClose={vi.fn()}
            />,
        );
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(shownSrc()).toBe("/img/1.jpg");
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(shownSrc()).toBe("/img/2.jpg");
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        expect(shownSrc()).toBe("/img/1.jpg");
    });

    it("stops at the ends instead of wrapping or going out of bounds", () => {
        render(
            <ImageLightbox
                images={images(2)}
                startIndex={0}
                onClose={vi.fn()}
            />,
        );
        fireEvent.keyDown(document, { key: "ArrowLeft" });
        expect(shownSrc()).toBe("/img/0.jpg");
        fireEvent.keyDown(document, { key: "ArrowRight" });
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(shownSrc()).toBe("/img/1.jpg");
    });

    it("closes on Escape", () => {
        const onClose = vi.fn();
        render(
            <ImageLightbox
                images={images(2)}
                startIndex={0}
                onClose={onClose}
            />,
        );
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores keys it does not handle", () => {
        const onClose = vi.fn();
        render(
            <ImageLightbox
                images={images(2)}
                startIndex={0}
                onClose={onClose}
            />,
        );
        fireEvent.keyDown(document, { key: "a" });
        fireEvent.keyDown(document, { key: "Enter" });
        expect(onClose).not.toHaveBeenCalled();
        expect(shownSrc()).toBe("/img/0.jpg");
    });

    it("stops listening once unmounted", () => {
        const onClose = vi.fn();
        const { unmount } = render(
            <ImageLightbox
                images={images(2)}
                startIndex={0}
                onClose={onClose}
            />,
        );
        unmount();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("renders nothing when the start index is out of range", () => {
        const { container } = render(
            <ImageLightbox
                images={images(2)}
                startIndex={9}
                onClose={vi.fn()}
            />,
        );
        expect(container.firstChild).toBeNull();
    });
});

// Galleries in a real library run to hundreds or thousands of images
// while a feed card only carries the first handful, so the lightbox has
// to page. The counter must report the WHOLE gallery, not what has been
// fetched, or the viewer looks like it ends after ten.
describe("paging a set larger than what is loaded", () => {
    const counter = () =>
        document.querySelector(".binge-lightbox-counter")?.textContent?.trim();

    it("counts against the full gallery, not the loaded page", () => {
        render(
            <ImageLightbox
                images={images(10)}
                startIndex={0}
                totalCount={1496}
                onNeedMore={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(counter()).toBe("1 / 1496");
    });

    it("counts against the images it has when no total is given", () => {
        // The performer image grid holds the whole set and passes
        // neither prop; it must keep reading "n / <length>".
        render(
            <ImageLightbox
                images={images(4)}
                startIndex={0}
                onClose={vi.fn()}
            />,
        );
        expect(counter()).toBe("1 / 4");
    });

    it("ignores a total smaller than what it was handed", () => {
        // image_count can lag a rescan. Trusting it blindly would make
        // the counter read "12 / 8".
        render(
            <ImageLightbox
                images={images(10)}
                startIndex={0}
                totalCount={3}
                onClose={vi.fn()}
            />,
        );
        expect(counter()).toBe("1 / 10");
    });

    it("does not ask for more while the end is still far off", () => {
        const onNeedMore = vi.fn();
        render(
            <ImageLightbox
                images={images(20)}
                startIndex={0}
                totalCount={100}
                onNeedMore={onNeedMore}
                onClose={vi.fn()}
            />,
        );
        expect(onNeedMore).not.toHaveBeenCalled();
    });

    it("asks for more once the user is within reach of the end", () => {
        const onNeedMore = vi.fn();
        render(
            <ImageLightbox
                images={images(20)}
                startIndex={0}
                totalCount={100}
                onNeedMore={onNeedMore}
                onClose={vi.fn()}
            />,
        );
        // 20 loaded, so the last index is 19 and the prefetch window
        // opens at 16. Walk up to 15 first: still quiet.
        for (let i = 0; i < 15; i++)
            fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(onNeedMore).not.toHaveBeenCalled();
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(onNeedMore).toHaveBeenCalled();
    });

    it("asks immediately when opened near the end of the loaded page", () => {
        // Tapping the last carousel image opens deep into the loaded
        // set, so the fetch has to start on mount, not on first move.
        const onNeedMore = vi.fn();
        render(
            <ImageLightbox
                images={images(10)}
                startIndex={9}
                totalCount={400}
                onNeedMore={onNeedMore}
                onClose={vi.fn()}
            />,
        );
        expect(onNeedMore).toHaveBeenCalled();
    });

    it("stops asking once everything is loaded", () => {
        const onNeedMore = vi.fn();
        render(
            <ImageLightbox
                images={images(10)}
                startIndex={9}
                totalCount={10}
                onNeedMore={onNeedMore}
                onClose={vi.fn()}
            />,
        );
        expect(onNeedMore).not.toHaveBeenCalled();
    });

    it("asks again after a page lands and the end is still near", () => {
        const onNeedMore = vi.fn();
        const { rerender } = render(
            <ImageLightbox
                images={images(10)}
                startIndex={9}
                totalCount={400}
                onNeedMore={onNeedMore}
                onClose={vi.fn()}
            />,
        );
        expect(onNeedMore).toHaveBeenCalledTimes(1);
        // A page of 12 lands; index 9 is still inside the window, so
        // the next page has to be requested without the user moving.
        rerender(
            <ImageLightbox
                images={images(12)}
                startIndex={9}
                totalCount={400}
                onNeedMore={onNeedMore}
                onClose={vi.fn()}
            />,
        );
        expect(onNeedMore).toHaveBeenCalledTimes(2);
    });

    it("navigates only within what has actually been fetched", () => {
        // The counter says 400 but only 10 exist client-side; walking
        // past them would blank the stage.
        render(
            <ImageLightbox
                images={images(10)}
                startIndex={0}
                totalCount={400}
                onNeedMore={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        for (let i = 0; i < 20; i++)
            fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(shownSrc()).toBe("/img/9.jpg");
    });
});

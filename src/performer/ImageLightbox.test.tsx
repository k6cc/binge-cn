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

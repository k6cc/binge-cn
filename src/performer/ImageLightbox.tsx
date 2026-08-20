import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PerformerImageCard } from "../api/queries";

interface ImageLightboxProps {
    images: PerformerImageCard[];
    startIndex: number;
    onClose: () => void;
    // Optional paging, for sets larger than the caller has fetched.
    // `totalCount` is the size of the whole set (so the counter reads
    // "4 / 1496" rather than "4 / 60"), and `onNeedMore` is called as
    // the user approaches the end of what is loaded. Callers with the
    // whole set in hand, like the performer image grid, omit both and
    // the lightbox behaves exactly as before.
    totalCount?: number;
    onNeedMore?: () => void;
}

// How close to the end of the loaded images the user gets before the
// next page is requested. Three is enough to hide the round-trip at
// arrow-key speed without fetching pages nobody looks at.
const PREFETCH_WITHIN = 3;

// Full-screen image viewer. Arrow keys + on-screen prev/next buttons
// navigate; Esc closes. Portalled to <body> so it sits above the profile
// modal (z:90) and any sheets (z:80). Z:110.
export function ImageLightbox({
    images,
    startIndex,
    onClose,
    totalCount,
    onNeedMore,
}: ImageLightboxProps) {
    const [index, setIndex] = useState(startIndex);
    const current = images[index];
    const total = Math.max(totalCount ?? images.length, images.length);

    // Ask for the next page once the user is within PREFETCH_WITHIN of
    // the last loaded image. Re-runs when the page lands and the array
    // grows, so a fast scroll through a large gallery keeps pulling.
    useEffect(() => {
        if (!onNeedMore) return;
        if (images.length >= total) return;
        if (index >= images.length - 1 - PREFETCH_WITHIN) onNeedMore();
    }, [index, images.length, total, onNeedMore]);

    const goPrev = () => setIndex((i) => (i > 0 ? i - 1 : i));
    const goNext = () => setIndex((i) => (i < images.length - 1 ? i + 1 : i));

    // The handler steps the index itself rather than calling goPrev/goNext,
    // which are rebuilt every render and would re-bind the listener on each
    // one. Functional updates mean the effect only needs the image count.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft")
                setIndex((i) => (i > 0 ? i - 1 : i));
            else if (e.key === "ArrowRight")
                setIndex((i) => (i < images.length - 1 ? i + 1 : i));
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [images.length, onClose]);

    if (!current) return null;

    const src = current.paths.image || current.paths.thumbnail || "";
    const canPrev = index > 0;
    const canNext = index < images.length - 1;

    return createPortal(
        <div
            className="binge-lightbox-root"
            role="dialog"
            aria-label="Image viewer"
        >
            <div className="binge-lightbox-backdrop" onClick={onClose} />
            <button
                type="button"
                className="binge-lightbox-close"
                onClick={onClose}
                aria-label="Close"
            >
                ×
            </button>
            <div className="binge-lightbox-stage">
                {src && (
                    <img
                        key={current.id}
                        src={src}
                        alt={current.title || ""}
                        className="binge-lightbox-image"
                    />
                )}
            </div>
            {canPrev && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-prev"
                    onClick={goPrev}
                    aria-label="Previous image"
                >
                    <ChevronLeft />
                </button>
            )}
            {canNext && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-next"
                    onClick={goNext}
                    aria-label="Next image"
                >
                    <ChevronRight />
                </button>
            )}
            <div className="binge-lightbox-counter" aria-hidden="true">
                {index + 1} / {total}
            </div>
        </div>,
        document.body,
    );
}

function ChevronLeft() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}

function ChevronRight() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M9 6l6 6-6 6" />
        </svg>
    );
}

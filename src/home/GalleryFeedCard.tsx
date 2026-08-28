import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryFeedItem } from "./useFeed";
import { findImagesByGallery } from "../api/queries";
import type { PerformerImageCard } from "../api/queries";
import { ImageLightbox } from "../performer/ImageLightbox";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { timeAgo } from "./timeAgo";

interface GalleryFeedCardProps {
    item: GalleryFeedItem;
}

// Images fetched per lightbox page. The feed only loads the handful the
// carousel shows, so the first page here supersedes that small set
// rather than appending to it, which keeps every page the same size and
// the offsets exact.
const LIGHTBOX_PAGE_SIZE = 60;

// Gallery-as-post IG-style card. Horizontal scroll-snap carousel of up
// to MAX_GALLERY_IMAGES (from useFeed); a "View gallery →" panel
// follows as the final slide so the user can jump into the full
// ImageLightbox even when they've scrolled to the end inline.
//
// Tap any image → lightbox at that index. Tap the end panel → lightbox
// at index 0. The lightbox then pages through the whole gallery, which
// for this library routinely means hundreds of images the carousel
// never carried.
export function GalleryFeedCard({ item }: GalleryFeedCardProps) {
    const carouselRef = useRef<HTMLDivElement>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [lightboxOpenAt, setLightboxOpenAt] = useState<number | null>(null);

    // Images beyond the carousel's first page, loaded on demand once
    // the lightbox is open. Null until the first page lands, so the
    // lightbox opens instantly on what the card already has.
    const [pagedImages, setPagedImages] = useState<PerformerImageCard[] | null>(
        null,
    );
    const pageRef = useRef(0);
    const inFlightRef = useRef(false);
    const exhaustedRef = useRef(false);
    // Mirrored into state so flipping it re-renders and the lightbox
    // sees a new totalCount. The ref alone is read inside callbacks; the
    // render needs to know too.
    const [exhausted, setExhausted] = useState(false);

    const loadMoreImages = useCallback(() => {
        if (inFlightRef.current || exhaustedRef.current) return;
        inFlightRef.current = true;
        const next = pageRef.current + 1;
        findImagesByGallery(item.galleryId, LIGHTBOX_PAGE_SIZE, next)
            .then((page) => {
                pageRef.current = next;
                // A short page means the gallery ran out, whatever
                // image_count claimed: Stash's count can lag a rescan.
                if (page.length < LIGHTBOX_PAGE_SIZE) {
                    exhaustedRef.current = true;
                    setExhausted(true);
                    setExhausted(true);
                }
                // Seeded from nothing, not from item.images: page 1
                // starts at the same image the carousel did, so seeding
                // would repeat the opening images and then skip a page.
                setPagedImages((prev) => [...(prev ?? []), ...page]);
            })
            .catch(() => {
                // Stop asking rather than retry on every index change.
                // The user keeps whatever loaded; closing and reopening
                // the lightbox is not a retry, but a broken gallery
                // query will not spin the network either.
                exhaustedRef.current = true;
            })
            .finally(() => {
                inFlightRef.current = false;
            });
    }, [item.galleryId]);

    const lightboxImages = pagedImages ?? item.images;

    // Opening asks for images when there are none.
    //
    // The feed swallows a failed per-gallery image fetch, so a transient
    // error left item.images empty while imageCount still advertised
    // "40 photos" - and the lightbox was gated on item.images, so both
    // taps did nothing at all and nothing ever asked again. The card
    // could not recover for the session.
    const openLightbox = () => {
        setLightboxOpenAt(0);
        if (lightboxImages.length === 0) loadMoreImages();
    };

    const { openProfile } = usePerformerProfile();
    const primaryPerformer = item.performers[0];

    // Total slide count: N images + 1 "View gallery" panel. The panel
    // gets its own snap slot, so the dots indicator needs to track it
    // too (last dot = the end panel).
    const slideCount = item.images.length + 1;

    // Update activeIndex as the carousel scrolls. Uses scroll position
    // / clientWidth math — robust against snap timing differences
    // between browsers and avoids needing one IntersectionObserver
    // per slide.
    useEffect(() => {
        const el = carouselRef.current;
        if (!el) return;
        let raf: number | null = null;
        const handle = () => {
            raf = null;
            if (!el.clientWidth) return;
            const idx = Math.round(el.scrollLeft / el.clientWidth);
            setActiveIndex(idx);
        };
        const onScroll = () => {
            if (raf === null) raf = requestAnimationFrame(handle);
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (raf !== null) cancelAnimationFrame(raf);
        };
    }, []);

    const scrollToSlide = (i: number) => {
        const el = carouselRef.current;
        if (!el) return;
        el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    };

    return (
        <article className="binge-feed-card binge-feed-card-gallery">
            <header className="binge-feed-card-header">
                <button
                    type="button"
                    className="binge-feed-card-author"
                    onClick={() =>
                        primaryPerformer && openProfile(primaryPerformer.id)
                    }
                    aria-label={primaryPerformer?.name ?? "Performer"}
                >
                    <span
                        className="binge-feed-card-avatar"
                        style={
                            primaryPerformer?.imagePath
                                ? {
                                      backgroundImage: `url(${primaryPerformer.imagePath})`,
                                  }
                                : undefined
                        }
                    >
                        {!primaryPerformer?.imagePath && (
                            <span className="binge-feed-card-initial">
                                {primaryPerformer?.name
                                    .charAt(0)
                                    .toUpperCase() ?? "?"}
                            </span>
                        )}
                    </span>
                    <span className="binge-feed-card-name">
                        {item.performers.map((p) => p.name).join(", ") ||
                            "Gallery"}
                    </span>
                </button>
                <span className="binge-feed-card-time">
                    {timeAgo(item.effectiveAt)}
                </span>
            </header>

            <div className="binge-gallery-media">
                <div
                    className="binge-gallery-carousel"
                    ref={carouselRef}
                    role="region"
                    aria-roledescription="carousel"
                    aria-label={item.title ?? "Gallery images"}
                >
                    {item.images.length === 0 ? (
                        // Empty image list — typically means the gallery
                        // exists but no images have been ingested yet.
                        // Show the cover thumbnail as a single slide.
                        <button
                            type="button"
                            className="binge-gallery-slide"
                            style={
                                item.coverPath
                                    ? {
                                          backgroundImage: `url(${item.coverPath})`,
                                      }
                                    : undefined
                            }
                            onClick={openLightbox}
                            aria-label={`Open ${item.title ?? "gallery"}`}
                        />
                    ) : (
                        item.images.map((img, idx) => {
                            const src =
                                img.paths.thumbnail || img.paths.image || "";
                            return (
                                <button
                                    type="button"
                                    key={img.id}
                                    className="binge-gallery-slide"
                                    style={
                                        src
                                            ? { backgroundImage: `url(${src})` }
                                            : undefined
                                    }
                                    onClick={() => setLightboxOpenAt(idx)}
                                    aria-label={`Image ${idx + 1} of ${
                                        item.imageCount
                                    }`}
                                />
                            );
                        })
                    )}

                    {/* End panel — always rendered so the carousel has
                        a "more →" outro slot even on small galleries. */}
                    <button
                        type="button"
                        className="binge-gallery-slide binge-gallery-end"
                        onClick={openLightbox}
                        aria-label="View full gallery"
                    >
                        <span className="binge-gallery-end-inner">
                            <span className="binge-gallery-end-label">
                                View gallery
                            </span>
                            <span className="binge-gallery-end-sub">
                                {item.imageCount}{" "}
                                {item.imageCount === 1 ? "photo" : "photos"}
                            </span>
                            <ChevronRight />
                        </span>
                    </button>
                </div>

                {/* Image count badge (top-right of media). */}
                <div className="binge-gallery-count-badge" aria-hidden="true">
                    <StackIcon />
                    <span>{item.imageCount}</span>
                </div>
            </div>

            {/* Dots indicator (one per slide including the end panel). */}
            {slideCount > 1 && (
                <div
                    className="binge-gallery-dots"
                    role="tablist"
                    aria-label="Gallery position"
                >
                    {Array.from({ length: slideCount }).map((_, i) => (
                        <button
                            key={i}
                            type="button"
                            role="tab"
                            aria-selected={i === activeIndex}
                            className={
                                "binge-gallery-dot" +
                                (i === activeIndex ? " is-active" : "")
                            }
                            onClick={() => scrollToSlide(i)}
                            tabIndex={-1}
                            aria-label={`Go to slide ${i + 1}`}
                        />
                    ))}
                </div>
            )}

            {item.title && (
                <div className="binge-feed-card-caption">{item.title}</div>
            )}

            {lightboxOpenAt !== null && lightboxImages.length > 0 && (
                <ImageLightbox
                    images={lightboxImages}
                    startIndex={lightboxOpenAt}
                    // image_count is a hint; the short-page signal is
                    // the truth. Stash's count lags a rescan, and a
                    // stale-LOW one made total equal the images already
                    // loaded, so the prefetch short-circuited and the
                    // reader was stranded with the rest of the gallery
                    // unreachable.
                    //
                    // Only distrusted when a FULL page has landed and
                    // the count still claims that is everything - the
                    // shape a stale count makes. A card holding less
                    // than a page has genuinely reached the end, so its
                    // count is believed and nothing is fetched.
                    totalCount={
                        exhausted
                            ? lightboxImages.length
                            : lightboxImages.length >= LIGHTBOX_PAGE_SIZE &&
                                item.imageCount <= lightboxImages.length
                              ? lightboxImages.length + 1
                              : item.imageCount
                    }
                    onNeedMore={loadMoreImages}
                    onClose={() => setLightboxOpenAt(null)}
                />
            )}
        </article>
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
            width="20"
            height="20"
        >
            <path d="M9 6l6 6-6 6" />
        </svg>
    );
}

function StackIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            width="14"
            height="14"
        >
            <rect x="7" y="3" width="14" height="14" rx="2" />
            <path d="M3 7v12a2 2 0 0 0 2 2h12" />
        </svg>
    );
}

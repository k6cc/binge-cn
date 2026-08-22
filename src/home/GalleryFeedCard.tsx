import { Fragment, useEffect, useRef, useState } from "react";
import { MAX_GALLERY_IMAGES, type GalleryFeedItem } from "./useFeed";
import { useDragPaging } from "../hooks/useDragPaging";
import { ImageLightbox } from "../performer/ImageLightbox";
import { PerformerHoverCard } from "./PerformerHoverCard";
import { VerifiedIcon } from "../performer/PerformerProfile";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { useSharedStories } from "./StoriesContext";
import { useStoryViewer } from "./StoryViewerContext";
import { timeAgo } from "./timeAgo";
import { useTranslation } from "react-i18next";

interface GalleryFeedCardProps {
    item: GalleryFeedItem;
}

// Gallery-as-post IG-style card. Horizontal scroll-snap carousel of up
// to MAX_GALLERY_IMAGES (from useFeed); a "View gallery →" panel
// follows as the final slide so the user can jump into the full
// ImageLightbox even when they've scrolled to the end inline.
//
// Tap any image → lightbox at that index. Tap the end panel → lightbox
// at index 0. Lightbox 展示同一份前 20 张（不做滚动分页拉全量——控
// 制首页负载，完整图库走"查看图库 →"跳演员档案图库 tab）。
export function GalleryFeedCard({ item }: GalleryFeedCardProps) {
    const carouselRef = useRef<HTMLDivElement>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [lightboxOpenAt, setLightboxOpenAt] = useState<number | null>(null);

    const { openProfile } = usePerformerProfile();
    const { open: openStoryViewer } = useStoryViewer();
    const storiesState = useSharedStories();
    const primaryPerformer = item.performers[0];
    const { t } = useTranslation();

    const handleAvatarTap = () => {
        if (!primaryPerformer) return;
        if (storiesState.state.kind !== "ready") {
            openProfile(primaryPerformer.id);
            return;
        }
        const list = storiesState.state.stories;
        const idx = list.findIndex(
            (s) => s.performerId === primaryPerformer.id
        );
        if (idx >= 0) {
            openStoryViewer(list, idx);
        } else {
            openProfile(primaryPerformer.id);
        }
    };

    const images = item.images.slice(0, MAX_GALLERY_IMAGES);

    // Total slide count: N images + 1 "View gallery" panel. The panel
    // gets its own snap slot, so the dots indicator needs to track it
    // too (last dot = the end panel).
    const slideCount = images.length + 1;

    // 桌面鼠标拖拽翻页（与图片查看器共用 useDragPaging）。触屏走原生
    // 滚动。拖拽松手由 hook 平滑滚到目标页并延迟恢复 snap。
    const { onPointerDown: dragPagingDown } = useDragPaging(carouselRef, {
        pageCount: slideCount,
    });
    const handleCarouselPointerDown = (e: React.PointerEvent) => {
        stopAutoPlay();
        dragPagingDown(e);
    };

    const endBgUrl = images.length > 0
        ? images[0].paths.thumbnail || images[0].paths.image
        : item.coverPath;

    const handleEndClick = () => {
        stopAutoPlay();
        if (primaryPerformer) {
            openProfile(primaryPerformer.id, "galleries");
        } else {
            openLightbox(0);
        }
    };

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
        stopAutoPlay();
        const el = carouselRef.current;
        if (!el) return;
        el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    };

    // 用户交互后永久停止自动轮播（本组件实例生命周期内）：手动滑动
    // （pointerdown 覆盖触屏/鼠标）、点击圆点、点开图片查看器。自动
    // 播放是"预览"性质，用户表达过意图后继续抢滚动位置只会干扰阅读。
    const userStoppedRef = useRef(false);
    function stopAutoPlay() {
        userStoppedRef.current = true;
    }

    // 打开灯箱 = 用户交互，同时停自动轮播。
    const openLightbox = (idx: number) => {
        stopAutoPlay();
        setLightboxOpenAt(idx);
    };

    // 修改10：首页图库卡片自动播放。IntersectionObserver 监听卡片是否
    // 进入视口（threshold 0.5，即 50% 可见）。进入视口且图片数 >1 时，
    // 启动 setInterval 每 2 秒切换到下一张；离开视口时 clearInterval。
    // 组件卸载时 disconnect observer 并清理 interval。
    useEffect(() => {
        const el = carouselRef.current;
        if (!el) return;
        if (images.length <= 1) return;
        let intervalId: number | null = null;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        if (intervalId !== null) continue;
                        intervalId = window.setInterval(() => {
                            if (userStoppedRef.current) {
                                if (intervalId !== null) {
                                    window.clearInterval(intervalId);
                                    intervalId = null;
                                }
                                return;
                            }
                            const cur = el.scrollLeft / el.clientWidth;
                            const n = Math.round(cur);
                            const c = slideCount;
                            el.scrollTo({
                                left: ((n + 1) % c) * el.clientWidth,
                                behavior: "smooth",
                            });
                        }, 2000);
                    } else {
                        if (intervalId !== null) {
                            window.clearInterval(intervalId);
                            intervalId = null;
                        }
                    }
                }
            },
            { threshold: 0.5 }
        );
        observer.observe(el);
        return () => {
            observer.disconnect();
            if (intervalId !== null) window.clearInterval(intervalId);
        };
    }, [item.images.length]);

    return (
        <article className="binge-feed-card binge-feed-card-gallery">
            <header className="binge-feed-card-header">
                <div className="binge-feed-card-author">
                    {primaryPerformer ? (
                        <PerformerHoverCard
                            name={primaryPerformer.name}
                            image={primaryPerformer.imagePath ?? null}
                            gender={null}
                            birthDate={null}
                            inLibrary
                            favorite={primaryPerformer.favorite}
                            onOpenProfile={() => openProfile(primaryPerformer.id)}
                        >
                            <span
                                className="binge-feed-card-avatar-ring"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleAvatarTap();
                                }}
                                style={{ cursor: "pointer" }}
                            >
                                <span
                                    className="binge-feed-card-avatar"
                                    style={
                                        primaryPerformer.imagePath
                                            ? { backgroundImage: `url("${primaryPerformer.imagePath}")` }
                                            : undefined
                                    }
                                >
                                    {!primaryPerformer.imagePath && (
                                        <span className="binge-feed-card-initial">
                                            {primaryPerformer.name.charAt(0).toUpperCase()}
                                        </span>
                                    )}
                                </span>
                            </span>
                            <button
                                type="button"
                                className="binge-feed-card-name-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openProfile(primaryPerformer.id);
                                }}
                                aria-label={primaryPerformer.name}
                            >
                                <span className="binge-feed-card-name">
                                    {item.performers.map((p, idx) => (
                                        <Fragment key={p.id}>
                                            {idx > 0 && ", "}
                                            {p.name}
                                            <span
                                                className={
                                                    "binge-feed-card-verified" +
                                                    (p.favorite ? " is-favorite" : "")
                                                }
                                                aria-label={
                                                    p.favorite
                                                        ? t("status.favorite")
                                                        : t("status.in_library")
                                                }
                                                title={
                                                    p.favorite
                                                        ? t("status.favorite")
                                                        : t("status.in_library")
                                                }
                                            >
                                                <VerifiedIcon />
                                            </span>
                                        </Fragment>
                                    ))}
                                </span>
                            </button>
                        </PerformerHoverCard>
                    ) : (
                        <>
                            <span className="binge-feed-card-avatar-ring">
                                <span className="binge-feed-card-avatar">
                                    <span className="binge-feed-card-initial">?</span>
                                </span>
                            </span>
                            <span className="binge-feed-card-name">{t("gallery.gallery")}</span>
                        </>
                    )}
                </div>
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
                    aria-label={item.title ?? t("gallery.gallery_image")}
                    onPointerDown={handleCarouselPointerDown}
                >
                    {images.length === 0 ? (
                        // Empty image list — typically means the gallery
                        // exists but no images have been ingested yet.
                        // Show the cover thumbnail as a single slide.
                        <button
                            type="button"
                            className="binge-gallery-slide"
                            style={
                                item.coverPath
                                    ? {
                                          backgroundImage: `url("${item.coverPath}")`,
                                      }
                                    : undefined
                            }
                            onClick={() => openLightbox(0)}
                            aria-label={t("gallery.open_gallery_title", { title: item.title ?? t("gallery.gallery") })}
                        />
                    ) : (
                        images.map((img, idx) => {
                            const src =
                                img.paths.thumbnail || img.paths.image || "";
                            return (
                                <button
                                    type="button"
                                    key={img.id}
                                    className="binge-gallery-slide"
                                    style={
                                        src
                                            ? { backgroundImage: `url("${src}")` }
                                            : undefined
                                    }
                                    onClick={() => openLightbox(idx)}
                                    aria-label={t("gallery.slide_position", { current: idx + 1, total: item.imageCount })}
                                />
                            );
                        })
                    )}

                    {/* End panel — always rendered so the carousel has
                        a "more →" outro slot even on small galleries.
                        Bug 8：点击纯色图直接跳转到演员档案的图库 tab，
                        而非打开灯箱。
                        */}
                    <button
                        type="button"
                        className="binge-gallery-slide binge-gallery-end"
                        onClick={handleEndClick}
                        aria-label={t("gallery.view_full_gallery")}
                        style={
                            endBgUrl
                                ? ({ "--end-bg": `url("${endBgUrl}")` } as React.CSSProperties)
                                : undefined
                        }
                    >
                        <span className="binge-gallery-end-inner">
                            <span className="binge-gallery-end-label">
                                {t("gallery.view_gallery")}
                            </span>
                            <span className="binge-gallery-end-sub">
                                {t("gallery.image_count", { count: item.imageCount })}
                            </span>
                            <ChevronRight />
                        </span>
                    </button>
                </div>

                {/* Image count badge (top-right of media). 真 button（非
                    div+role）：此前 role="button" + tabIndex=0 +
                    aria-hidden="true" 自相矛盾——可聚焦元素对 AT 隐藏，
                    点击跳转后焦点残留触发 Chrome aria-hidden 警告。 */}
                <button
                    type="button"
                    className="binge-gallery-count-badge"
                    onClick={handleEndClick}
                    aria-label={t("gallery.open_full_gallery_title", {
                        count: item.imageCount,
                    })}
                >
                    <StackIcon />
                    <span>{item.imageCount}</span>
                </button>
            </div>

            {/* Dots indicator (one per slide including the end panel). */}
            {slideCount > 1 && (
                <div
                    className="binge-gallery-dots"
                    role="tablist"
                    aria-label={t("nav.gallery_position")}
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
                            aria-label={t("gallery.jump_to_slide", { current: i + 1 })}
                        />
                    ))}
                </div>
            )}

            {item.title && (
                <div className="binge-feed-card-caption">{item.title}</div>
            )}

            {lightboxOpenAt !== null && item.images.length > 0 && (
                <ImageLightbox
                    images={item.images}
                    startIndex={lightboxOpenAt}
                    totalCount={item.imageCount}
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

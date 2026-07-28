import { useEffect, useRef, useState } from "react";
import {
    findGalleriesByPerformer,
    findImagesByGallery,
    type PerformerDetail,
    type PerformerGalleryCard,
    type PerformerImageCard,
} from "../api/queries";
import { ImageLightbox } from "./ImageLightbox";
import { useTranslation } from "react-i18next";

interface PerformerImageGridProps {
    performer: PerformerDetail;
}

const PAGE_SIZE = 30;
const NEAR_BOTTOM_PX = 600;
// 图库图片单次最多加载 500 张（硬约束）。
const MAX_GALLERY_IMAGES = 500;
// 封面悬停预览时抓取的图片数（mYf 组件）。
const HOVER_PREVIEW_IMAGES = 50;
const HOVER_FETCH_DELAY_MS = 500;
const HOVER_CYCLE_INTERVAL_MS = 1000;

// 演员档案页"图库"tab。两层结构：
//   第一层 — 图库封面网格（binge-gallery-grid），3 列，封面 3:4 竖屏。
//   第二层 — 点击封面进入该图库的图片网格（复用 binge-profile-photo-grid），
//            图片来自 findImagesByGallery（ta 查询），最多 500 张。
// 点击图片打开 ImageLightbox 灯箱。无图库时显示"无图库"。
export function PerformerImageGrid({ performer }: PerformerImageGridProps) {
    const { t } = useTranslation();
    const [galleries, setGalleries] = useState<PerformerGalleryCard[]>([]);
    const [count, setCount] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 第二层：当前打开的图库 + 该图库的图片。
    const [openGallery, setOpenGallery] = useState<PerformerGalleryCard | null>(
        null
    );
    const [galleryImages, setGalleryImages] = useState<PerformerImageCard[]>(
        []
    );
    const [galleryLoading, setGalleryLoading] = useState(false);
    const [galleryError, setGalleryError] = useState<string | null>(null);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    // 切换演员时重置第一层状态并关闭第二层。
    useEffect(() => {
        setGalleries([]);
        setCount(null);
        setPage(1);
        setError(null);
        setOpenGallery(null);
        setGalleryImages([]);
        setGalleryError(null);
    }, [performer.id]);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        findGalleriesByPerformer(performer.id, page, PAGE_SIZE)
            .then((res) => {
                if (!alive) return;
                setCount(res.count);
                setGalleries((prev) =>
                    page === 1 ? res.galleries : [...prev, ...res.galleries]
                );
            })
            .catch((err: Error) => {
                if (!alive) return;
                setError(err.message);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [performer.id, page]);

    // 打开某个图库：抓取其图片（最多 500 张）进入第二层。
    useEffect(() => {
        if (!openGallery) return;
        let alive = true;
        setGalleryLoading(true);
        setGalleryError(null);
        setGalleryImages([]);
        findImagesByGallery(openGallery.id, MAX_GALLERY_IMAGES)
            .then((imgs) => {
                if (!alive) return;
                setGalleryImages(imgs);
            })
            .catch((err: Error) => {
                if (!alive) return;
                setGalleryError(err.message);
            })
            .finally(() => {
                if (alive) setGalleryLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [openGallery]);

    // 第一层无限滚动哨兵。
    const sentinelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        if (count == null) return;
        if (galleries.length >= count) return;
        if (loading) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        setPage((p) => p + 1);
                    }
                }
            },
            { rootMargin: `0px 0px ${NEAR_BOTTOM_PX}px 0px` }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [count, galleries.length, loading]);

    // ── 第二层：图库内图片网格 ───────────────────────────────
    if (openGallery) {
        return (
            <section className="binge-profile-photos">
                <button
                    type="button"
                    className="binge-gallery-back"
                    onClick={() => setOpenGallery(null)}
                >
                    ← {t("nav.back")}
                </button>
                {openGallery.title && (
                    <div className="binge-gallery-title">
                        {openGallery.title}
                    </div>
                )}
                {galleryError && (
                    <div className="binge-status binge-status-error">
                        {t("status.error_message", { message: galleryError })}
                    </div>
                )}
                {galleryImages.length === 0 && galleryLoading && (
                    <div className="binge-status">{t("status.loading")}</div>
                )}
                {galleryImages.length === 0 &&
                    !galleryLoading &&
                    !galleryError && (
                        <div className="binge-status">{t("status.no_image")}</div>
                    )}
                {galleryImages.length > 0 && (
                    <ul className="binge-profile-photo-grid">
                        {galleryImages.map((img, i) => (
                            <li
                                key={img.id}
                                className="binge-profile-photo-cell"
                            >
                                <button
                                    type="button"
                                    className="binge-profile-photo-card"
                                    onClick={() => setLightboxIndex(i)}
                                    title={img.title || t("gallery.image_id", { id: img.id })}
                                >
                                    <img
                                        src={
                                            img.paths.thumbnail ||
                                            img.paths.image ||
                                            ""
                                        }
                                        alt={img.title || ""}
                                        className="binge-profile-photo-thumb"
                                        loading="lazy"
                                    />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {galleryLoading && galleryImages.length > 0 && (
                <div className="binge-status binge-profile-scenes-loading">
                    {t("status.loading")}
                </div>
            )}
                {lightboxIndex != null && galleryImages.length > 0 && (
                    <ImageLightbox
                        images={galleryImages}
                        startIndex={lightboxIndex}
                        onClose={() => setLightboxIndex(null)}
                    />
                )}
            </section>
        );
    }

    // ── 第一层：图库封面网格 ─────────────────────────────────
    return (
        <section className="binge-profile-photos">
            {error && (
                <div className="binge-status binge-status-error">
                    {t("status.error_message", { message: error })}
                </div>
            )}
            {galleries.length === 0 && loading && (
                <div className="binge-status">{t("status.loading")}</div>
            )}
            {galleries.length === 0 && !loading && !error && (
                <div className="binge-status">{t("status.no_gallery")}</div>
            )}
            {galleries.length > 0 && (
                <ul className="binge-gallery-grid">
                    {galleries.map((g) => (
                        <GalleryCoverCell
                            key={g.id}
                            gallery={g}
                            onOpen={() => setOpenGallery(g)}
                        />
                    ))}
                </ul>
            )}
            <div ref={sentinelRef} aria-hidden="true" />
            {loading && galleries.length > 0 && (
                <div className="binge-status binge-profile-scenes-loading">
                    {t("status.loading")}
                </div>
            )}
        </section>
    );
}

// mYf 组件：图库封面单元格 + 悬停自动播放。
// 悬停 0.5 秒后抓取该图库前 50 张图片，加载完成立即切到下一张，
// 随后每秒循环切换。鼠标离开时若图片尚未加载完，hover 守卫阻止
// 启动 setInterval；离开时清除所有定时器并恢复封面图。
function GalleryCoverCell({
    gallery,
    onOpen,
}: {
    gallery: PerformerGalleryCard;
    onOpen: () => void;
}) {
    const { t } = useTranslation();
    const imgRef = useRef<HTMLImageElement>(null);
    const indexRef = useRef(0);
    const imagesCacheRef = useRef<PerformerImageCard[] | null>(null);
    const fetchTimerRef = useRef<number | null>(null);
    const cycleTimerRef = useRef<number | null>(null);
    const hoverGuardRef = useRef(false);
    // 需求3：封面默认右对齐，但悬停循环切换图片时改为铺满（center）。
    // 用 React 状态驱动 className，避免直接操作 DOM class。
    const [cycling, setCycling] = useState(false);

    const coverSrc = gallery.cover?.paths.thumbnail ?? "";

    const clearTimers = () => {
        if (fetchTimerRef.current !== null) {
            window.clearTimeout(fetchTimerRef.current);
            fetchTimerRef.current = null;
        }
        if (cycleTimerRef.current !== null) {
            window.clearInterval(cycleTimerRef.current);
            cycleTimerRef.current = null;
        }
    };

    const restoreCover = () => {
        if (imgRef.current) imgRef.current.src = coverSrc;
        indexRef.current = 0;
        setCycling(false);
    };

    const startCycle = async () => {
        if (!imagesCacheRef.current) {
            try {
                imagesCacheRef.current = await findImagesByGallery(
                    gallery.id,
                    HOVER_PREVIEW_IMAGES
                );
            } catch {
                return;
            }
        }
        // 鼠标离开期间图片尚未加载完 — 守卫阻止启动循环。
        if (!hoverGuardRef.current) return;
        const imgs = imagesCacheRef.current;
        if (imgs.length > 1 && imgRef.current) {
            setCycling(true);
            indexRef.current = (indexRef.current + 1) % imgs.length;
            imgRef.current.src =
                imgs[indexRef.current]?.paths?.thumbnail || coverSrc;
            cycleTimerRef.current = window.setInterval(() => {
                indexRef.current = (indexRef.current + 1) % imgs.length;
                if (imgRef.current) {
                    imgRef.current.src =
                        imgs[indexRef.current]?.paths?.thumbnail ||
                        coverSrc;
                }
            }, HOVER_CYCLE_INTERVAL_MS);
        }
    };

    useEffect(() => {
        return () => {
            clearTimers();
        };
    }, []);

    return (
        <li className="binge-gallery-cell">
            <button
                type="button"
                className="binge-gallery-cover-btn"
                onClick={onOpen}
                aria-label={t("action.view_gallery", { title: gallery.title ?? gallery.id })}
                onMouseEnter={() => {
                    hoverGuardRef.current = true;
                    fetchTimerRef.current = window.setTimeout(
                        startCycle,
                        HOVER_FETCH_DELAY_MS
                    );
                }}
                onMouseLeave={() => {
                    hoverGuardRef.current = false;
                    clearTimers();
                    restoreCover();
                }}
            >
                <img
                    ref={imgRef}
                    src={coverSrc}
                    alt={gallery.title || ""}
                    className={
                        "binge-gallery-cover" +
                        (cycling ? " is-cycling" : "")
                    }
                    loading="lazy"
                />
                <span className="binge-gallery-cell-title">
                    {gallery.title || t("gallery.gallery_id", { id: gallery.id })}
                </span>
                <span className="binge-gallery-cell-count">
                    {t("gallery.image_count", { count: gallery.image_count })}
                </span>
            </button>
        </li>
    );
}

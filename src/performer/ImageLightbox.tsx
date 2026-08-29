import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDragPaging } from "../hooks/useDragPaging";
import type { PerformerImageCard } from "../api/queries";

interface ImageLightboxProps {
    images: PerformerImageCard[];
    startIndex: number;
    onClose: () => void;
    // 整套图片的真实总数：计数显示 "4 / 1496"。不传时用 images.length
    // （首页图库卡片：feed 只带前 20 张，计数如实显示总数；演员档案
    // 图库：一次拉全，两者都由调用方传入或按实际数显示）。
    totalCount?: number;
}

// Full-screen image viewer. 原生横向滚动 + scroll-snap 轨道：跟手拖
// 动、惯性滑动、吸附切换全由浏览器处理（与首页图库卡片轮播同一机
// 制），左右两张图物理衔接滑动。箭头按钮/方向键调用 scrollTo 翻
// 页；Esc 关闭。Portalled to <body> so it sits above the profile
// modal (z:90) and any sheets (z:80). Z:110.
export function ImageLightbox({
    images,
    startIndex,
    onClose,
    totalCount,
}: ImageLightboxProps) {
    const trackRef = useRef<HTMLDivElement>(null);

    // 初始定位到 startIndex：轨道布局完成后一次到位（无动画）。
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        const slide = el.clientWidth;
        if (slide > 0) {
            el.scrollLeft = startIndex * slide;
        }
    }, [startIndex]);

    // The handler steps the track itself rather than calling goPrev/goNext,
    // which are rebuilt every render and would re-bind the listener on each
    // one. stepRef 每次渲染都指向最新 step（含最新 images.length 上
    // 限），不存在上游"翻页落定后箭头键短暂失灵"的时序窗口。
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") stepRef.current(-1);
            else if (e.key === "ArrowRight") stepRef.current(1);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // 翻页：绝对定位 scrollTo（与图库卡片轮播同款）。不用 scrollBy：
    // 相对增量在滚动被打断后会累积偏移、落在 snap 点之间被强制吸附
    // 截停（表现为"位移几十像素、再点一次才翻页"）；绝对索引始终
    // 精确落在 snap 点上，无累积误差。
    const step = (delta: 1 | -1) => {
        const el = trackRef.current;
        if (!el || el.clientWidth <= 0) return;
        const cur = Math.round(el.scrollLeft / el.clientWidth);
        const target = Math.min(
            Math.max(cur + delta, 0),
            images.length - 1,
        );
        el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
    };
    const stepRef = useRef(step);
    stepRef.current = step;
    const goPrev = () => step(-1);
    const goNext = () => step(1);

    // 当前页索引：跟踪轨道滚动位置（snap 落定后 slide = 一屏宽）。
    // 驱动计数显示与箭头显隐——手势滑动和按钮/键盘翻页都走这里。
    const [index, setIndex] = useState(startIndex);
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        let raf = 0;
        const sync = () => {
            raf = 0;
            if (el.clientWidth <= 0) return;
            // clamp 防御：过冲回弹的瞬态 scrollLeft 可能算出越界
            // 索引（如 16/15），钳制到合法区间。
            const i = Math.min(
                Math.max(Math.round(el.scrollLeft / el.clientWidth), 0),
                images.length - 1,
            );
            setIndex((prev) => (prev === i ? prev : i));
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(sync);
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [images.length]);

    // 点空白关闭 + 桌面鼠标拖拽翻页。拖拽逻辑抽到 useDragPaging（与
    // 首页图库卡片轮播共用）；松手后 snap 的恢复延迟到平滑滚动落定
    // （scrollend + timeout 兜底）——立即恢复会瞬间吸附到最近 snap
    // 点，表现为"图片先跳回中心再滑走"。触屏滚动由浏览器原生处理。
    const { onPointerDown: dragPagingDown } = useDragPaging(trackRef, {
        pageCount: images.length,
    });
    const downPosRef = useRef<{ x: number; y: number } | null>(null);
    const handleTrackPointerDown = (e: React.PointerEvent) => {
        downPosRef.current = { x: e.clientX, y: e.clientY };
        dragPagingDown(e);
    };
    const handleTrackClick = (e: React.MouseEvent) => {
        const down = downPosRef.current;
        downPosRef.current = null;
        if (!down) return;
        const moved =
            Math.abs(e.clientX - down.x) > 6 ||
            Math.abs(e.clientY - down.y) > 6;
        if (moved) return;
        // 点在空白（slide/track 容器）而非图片上 → 关闭。
        const target = e.target as HTMLElement;
        if (target.closest(".binge-lightbox-image")) return;
        onClose();
    };

    const total = totalCount ?? images.length;

    return createPortal(
        <div
            className="binge-lightbox-root"
            role="dialog"
            aria-label="Image viewer"
        >
            <button
                type="button"
                className="binge-lightbox-close"
                onClick={onClose}
                aria-label="Close"
            >
                ×
            </button>
            <div
                className="binge-lightbox-track"
                ref={trackRef}
                onPointerDown={handleTrackPointerDown}
                onClick={handleTrackClick}
            >
                {images.map((img) => {
                    // 无 src 也保留 slide 占位：索引与 images 严格对齐，
                    // 否则滚动位置与 startIndex 错位。
                    const src = img.paths.image || img.paths.thumbnail || "";
                    return (
                        <div className="binge-lightbox-slide" key={img.id}>
                            {src && (
                                <img
                                    src={src}
                                    alt={img.title || ""}
                                    className="binge-lightbox-image"
                                    loading="lazy"
                                    draggable={false}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            {index > 0 && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-prev"
                    onClick={goPrev}
                    aria-label="Previous image"
                >
                    <ChevronLeft />
                </button>
            )}
            {index < images.length - 1 && (
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

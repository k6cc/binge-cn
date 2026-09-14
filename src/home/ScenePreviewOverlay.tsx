import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDragPaging } from "../hooks/useDragPaging";
import { getSourceBox, getStashDBScene } from "../api/stashdb";
import {
    contentIdFromR18Url,
    deriveContentId,
    probeDmmGallery,
} from "./dmmGallery";
import { formatDuration } from "../utils/date";
import { useTranslation } from "react-i18next";

interface ScenePreviewOverlayProps {
    sceneStashId: string;
    coverUrl: string;
    title: string | null;
    // 文件名素材：卡片引用的演员（primary + 库内联合，非场景全量）
    // 与发布日期，供下载按钮命名。
    performerNames: string[];
    releaseDate: string | null;
    onClose: () => void;
}

// 详情会话缓存：重开预览窗不重查 findScene。失败时清除，避免缓存
// rejected promise。
const detailCache = new Map<
    string,
    Promise<Awaited<ReturnType<typeof getStashDBScene>>>
>();
function loadSceneDetail(sceneId: string, apiKey: string) {
    let p = detailCache.get(sceneId);
    if (!p) {
        p = getStashDBScene(sceneId, apiKey).catch((err) => {
            detailCache.delete(sceneId);
            throw err;
        });
        detailCache.set(sceneId, p);
    }
    return p;
}

// 发现页卡片的全屏剧照预览。第 0 页是封面（横版，底部信息栏显示
// 番号（后跟小号工作室·时长）/简介/标签，剧照数底部居中），之后
// 是剧照页（底部居中 n/N，封面不计入）。轨道机制与 ImageLightbox
// 同款：原生横向滚动 + scroll-snap、箭头/方向键/Esc、点空白关闭、
// 桌面拖拽翻页。关闭按钮左侧的下载按钮保存当前页图片，命名"番号
// 演员日期"；CORS 拒绝的图床（DMM）退化为新标签打开。
//
// 剧照按需加载：打开时才发一次 findScene 详情查询（首页 feed 零
// 开销），场景 urls 含 r18.dev 链接时用其 id 参数生成 DMM 图床序
// 列并批量探测——每张确认即追加到轨道，右箭头随之出现。探测结果
// 与详情均会话内缓存，重开秒进。
export function ScenePreviewOverlay({
    sceneStashId,
    coverUrl,
    title,
    performerNames,
    releaseDate,
    onClose,
}: ScenePreviewOverlayProps) {
    const { t } = useTranslation();
    const trackRef = useRef<HTMLDivElement>(null);

    const [detail, setDetail] = useState<Awaited<
        ReturnType<typeof getStashDBScene>
    > | null>(null);
    const [gallery, setGallery] = useState<string[]>([]);
    const [probing, setProbing] = useState(false);

    // 详情 + 剧照探测。alive 防关闭后的迟到 setState。
    useEffect(() => {
        let alive = true;
        (async () => {
            const box = await getSourceBox();
            if (!box || !alive) return;
            const d = await loadSceneDetail(sceneStashId, box.api_key);
            if (!alive) return;
            setDetail(d);
            if (!d) return;
            const r18Url = d.urls.find((u) =>
                u.url.includes("r18.dev"),
            );
            if (!r18Url) return;
            const contentId =
                contentIdFromR18Url(r18Url.url) ?? deriveContentId(d.code);
            if (!contentId) return;
            setProbing(true);
            // 首次探测经 onImage 渐进追加；resolve 值是完整序列，结尾
            // 覆盖一次以覆盖会话缓存命中场景（缓存命中不触发回调）。
            const found = await probeDmmGallery(contentId, (url) => {
                if (alive) setGallery((prev) => [...prev, url]);
            });
            if (alive) setGallery(found);
            if (alive) setProbing(false);
        })();
        return () => {
            alive = false;
        };
    }, [sceneStashId]);

    // 方向键/Esc。stepRef 每渲染指向最新 step（slides.length 随探
    // 测增长），无 stale 上限。
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") stepRef.current(-1);
            else if (e.key === "ArrowRight") stepRef.current(1);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // 翻页：绝对索引 scrollTo（与 ImageLightbox 同款，无 scrollBy
    // 累积误差）。
    const slideCount = gallery.length + 1;
    const step = (delta: 1 | -1) => {
        const el = trackRef.current;
        if (!el || el.clientWidth <= 0) return;
        const cur = Math.round(el.scrollLeft / el.clientWidth);
        const target = Math.min(Math.max(cur + delta, 0), slideCount - 1);
        el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
    };
    const stepRef = useRef(step);
    stepRef.current = step;

    // 当前页索引：snap 落定后一屏宽一页。
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        let raf = 0;
        const sync = () => {
            raf = 0;
            if (el.clientWidth <= 0) return;
            const i = Math.min(
                Math.max(Math.round(el.scrollLeft / el.clientWidth), 0),
                slideCount - 1,
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
    }, [slideCount]);

    // 点空白关闭 + 桌面拖拽翻页（与 ImageLightbox 同款）。
    const { onPointerDown: dragPagingDown } = useDragPaging(trackRef, {
        pageCount: slideCount,
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
        if (
            Math.abs(e.clientX - down.x) > 6 ||
            Math.abs(e.clientY - down.y) > 6
        ) {
            return;
        }
        const target = e.target as HTMLElement;
        if (target.closest(".binge-scene-preview-image")) return;
        onClose();
    };

    const code = detail?.code ?? null;
    const studioName = detail?.studio?.name ?? null;
    const duration = detail?.duration ?? null;
    const tags = detail?.tags ?? [];
    const detailsText = detail?.details ?? null;
    const hasMeta = studioName != null || duration != null;

    // 当前页图片：第 0 页封面，其余对应 gallery[index-1]。
    const currentImageUrl =
        index === 0 ? coverUrl : (gallery[index - 1] ?? null);

    // 下载命名：番号 演员列表 发布日期（缺失项跳过，全缺退回标题），
    // 扩展名取自 URL。演员名清理文件系统非法字符。
    const handleDownload = async () => {
        const url = currentImageUrl;
        if (!url) return;
        const sanitize = (s: string) =>
            s.replace(/[\\/:*?"<>|]/g, "").trim();
        const parts = [
            code ? sanitize(code) : null,
            performerNames.length > 0
                ? sanitize(performerNames.join(" "))
                : null,
            releaseDate,
        ].filter(Boolean);
        const base =
            parts.length > 0 ? parts.join(" ") : (title ?? "binge-scene");
        const ext = url.match(/\.(jpe?g|png|webp|gif)$/i)?.[0] ?? ".jpg";
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = base + ext;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch {
            // 图床无 CORS 头（DMM 图床实测 fetch 拒绝）：新标签打开，
            // 由用户手动另存。javstash 等允许 CORS 的源直接落盘。
            window.open(url, "_blank", "noopener");
        }
    };

    return createPortal(
        <div
            className="binge-lightbox-root binge-scene-preview-root"
            role="dialog"
            aria-label={title ?? t("action.preview_scene")}
        >
            <button
                type="button"
                className="binge-lightbox-close binge-lightbox-download"
                onClick={() => void handleDownload()}
                aria-label={t("action.download_image")}
                title={t("action.download_image")}
            >
                <DownloadIcon />
            </button>
            <button
                type="button"
                className="binge-lightbox-close"
                onClick={onClose}
                aria-label={t("action.close")}
            >
                ×
            </button>
            <div
                className="binge-lightbox-track"
                ref={trackRef}
                onPointerDown={handleTrackPointerDown}
                onClick={handleTrackClick}
            >
                <div className="binge-lightbox-slide">
                    <img
                        src={coverUrl}
                        alt={title ?? ""}
                        className="binge-lightbox-image binge-scene-preview-image"
                        draggable={false}
                    />
                </div>
                {gallery.map((url) => (
                    <div className="binge-lightbox-slide" key={url}>
                        <img
                            src={url}
                            alt=""
                            className="binge-lightbox-image binge-scene-preview-image"
                            loading="lazy"
                            draggable={false}
                        />
                    </div>
                ))}
            </div>
            {index > 0 && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-prev"
                    onClick={() => step(-1)}
                    aria-label={t("action.previous")}
                >
                    <ChevronLeft />
                </button>
            )}
            {index < slideCount - 1 && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-next"
                    onClick={() => step(1)}
                    aria-label={t("action.next")}
                >
                    <ChevronRight />
                </button>
            )}

            {detail && (
                <div
                    className={
                        "binge-scene-preview-info" +
                        (index === 0 ? "" : " is-hidden")
                    }
                >
                    {(code || hasMeta) && (
                        <div className="binge-scene-preview-code">
                            {code}
                            {hasMeta && (
                                <span className="binge-scene-preview-meta">
                                    {" "}
                                    {studioName}
                                    {studioName && duration != null
                                        ? " · "
                                        : ""}
                                    {duration != null && (
                                        <strong className="binge-scene-preview-duration">
                                            {formatDuration(duration)}
                                        </strong>
                                    )}
                                </span>
                            )}
                        </div>
                    )}
                    {detailsText && (
                        <p className="binge-scene-preview-details">
                            {detailsText}
                        </p>
                    )}
                    {tags.length > 0 && (
                        <div className="binge-scene-preview-tags">
                            {tags.map((tag) => (
                                <span
                                    className="binge-scene-preview-tag"
                                    key={tag.stashId}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    )}
                    {(gallery.length > 0 || probing) && (
                        <div className="binge-scene-preview-count">
                            {probing && gallery.length === 0
                                ? t("scene.gallery_probing")
                                : t("scene.gallery_count", {
                                      count: gallery.length,
                                  })}
                            {probing && gallery.length > 0 ? "…" : ""}
                        </div>
                    )}
                </div>
            )}

            {index > 0 && (
                <div className="binge-lightbox-counter" aria-hidden="true">
                    {index} / {gallery.length}
                    {probing ? "…" : ""}
                </div>
            )}
        </div>,
        document.body,
    );
}

function DownloadIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
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

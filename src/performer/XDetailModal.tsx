import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { saveToStash, type SaveToStashRequest, type XMedia } from "../api/bingeServer";
import { useFetchBlobUrl } from "../hooks/useFetchBlobUrl";
import { timeAgo } from "../home/timeAgo";

interface XDetailModalProps {
    media: XMedia[];
    index: number;
    performerStashId: string;
    onClose: () => void;
    onIndexChange: (i: number) => void;
}

// X 媒体详情查看器：全屏 modal，点击 X tab 卡片后弹出。
//
// 与 StoryViewer 的区别：
// - StoryViewer 是"故事流"模式（15 秒自动切换、进度条推进、上下滑切换演员）
// - XDetailModal 是"浏览模式"（手动翻页、无自动切换、视频用原生 controls）
//
// 视频：fetch + blob URL 方案绕过 twimg 的 Referer 检查（与 XVideoThumb 一致）
// 图片：直接 <img referrerPolicy="no-referrer">
// 保存：调用 saveToStash API（source:"x"），按 mediaId 记录状态
export function XDetailModal({
    media,
    index,
    performerStashId,
    onClose,
    onIndexChange,
}: XDetailModalProps) {
    const { t } = useTranslation();
    const current = media[index];
    const videoUrl = current?.kind === "video" ? current.mediaUrl : null;
    const { blobUrl, failed } = useFetchBlobUrl(videoUrl);
    const [saveState, setSaveState] = useState<
        Record<string, "saving" | "saved" | "error">
    >({});

    // 键盘导航
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft" && index > 0) onIndexChange(index - 1);
            else if (e.key === "ArrowRight" && index < media.length - 1)
                onIndexChange(index + 1);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [index, media.length, onClose, onIndexChange]);

    // 触屏划动翻页：媒体区按下 → 划过阈值（min(20% 宽, 200px)）松手
    // 翻页，仅 touch 指针（鼠标不参与——桌面用左右按钮/键盘）。视频
    // 控制栏（底部 ~56px）内的按下不参与——拖进度条会被误判成划动。
    const mediaRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ x: number; dragged: boolean } | null>(null);

    const onMediaPointerDown = (e: React.PointerEvent) => {
        if (!e.isPrimary || e.pointerType !== "touch") return;
        if (e.target instanceof HTMLElement && e.target.tagName === "VIDEO") {
            const r = e.target.getBoundingClientRect();
            if (e.clientY > r.bottom - 56) return;
        }
        dragRef.current = { x: e.clientX, dragged: false };
    };

    useEffect(() => {
        const swallowClick = (ev: Event) => {
            ev.stopPropagation();
            ev.preventDefault();
        };
        const onMove = (e: PointerEvent) => {
            const d = dragRef.current;
            if (d && Math.abs(e.clientX - d.x) > 8) d.dragged = true;
        };
        const onUp = (e: PointerEvent) => {
            const d = dragRef.current;
            dragRef.current = null;
            if (!d || !d.dragged) return;
            // 划动后的松手 click 不落到图片上（防触发浏览器拖拽预览）
            const el = mediaRef.current;
            if (!el) return;
            el.addEventListener("click", swallowClick, { capture: true, once: true });
            window.setTimeout(
                () => el.removeEventListener("click", swallowClick, true),
                300,
            );
            const dx = d.x - e.clientX;
            const threshold = Math.min(el.clientWidth * 0.2, 200);
            if (dx > threshold && index < media.length - 1) onIndexChange(index + 1);
            else if (dx < -threshold && index > 0) onIndexChange(index - 1);
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [index, media.length, onIndexChange]);

    if (!current) return null;

    const saveKey = `${current.tweetId}:${current.mediaUrl}`;
    const st = saveState[saveKey];

    const buildReq = (): SaveToStashRequest | null => {
        if (!current.mediaUrl) return null;
        const xm = current.tweetUrl.match(
            /x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i
        );
        return {
            performerStashId,
            source: "x",
            handle: xm?.[1] ?? current.authorHandle,
            id: xm?.[2] ?? current.tweetId,
            mediaUrl: current.mediaUrl,
            kind: current.kind,
            sourceUrl: current.tweetUrl,
            text: current.text,
            createdUtc: current.createdUtc,
        };
    };

    const handleSave = async () => {
        if (st === "saving" || st === "saved") return;
        const req = buildReq();
        if (!req) return;
        setSaveState((m) => ({ ...m, [saveKey]: "saving" }));
        const res = await saveToStash(req);
        setSaveState((m) => ({
            ...m,
            [saveKey]: res.ok ? "saved" : "error",
        }));
    };

    return createPortal(
        <div className="binge-x-modal-root" role="dialog" aria-label={t("modal.x_media_details")}>
            <div
                className="binge-x-modal-backdrop"
                onClick={onClose}
                aria-hidden="true"
            />
            <button
                type="button"
                className="binge-x-modal-close"
                onClick={onClose}
                aria-label={t("action.close")}
            >
                ×
            </button>
            {/* 左右翻页 */}
            {index > 0 && (
                <button
                    type="button"
                    className="binge-x-modal-nav binge-x-modal-nav-prev"
                    onClick={() => onIndexChange(index - 1)}
                    aria-label={t("action.previous")}
                >
                    ‹
                </button>
            )}
            {index < media.length - 1 && (
                <button
                    type="button"
                    className="binge-x-modal-nav binge-x-modal-nav-next"
                    onClick={() => onIndexChange(index + 1)}
                    aria-label={t("action.next")}
                >
                    ›
                </button>
            )}
            <div className="binge-x-modal-content">
                <div
                    className="binge-x-modal-media"
                    ref={mediaRef}
                    onPointerDown={onMediaPointerDown}
                >
                    {current.kind === "video" ? (
                        failed ? (
                            <div className="binge-x-modal-error">
                                {t("status.video_load_failed")}
                            </div>
                        ) : blobUrl ? (
                            <video
                                src={blobUrl}
                                className="binge-x-modal-video"
                                controls
                                autoPlay
                                playsInline
                            />
                        ) : (
                            <div className="binge-x-modal-loading">
                                {t("status.video_loading")}
                            </div>
                        )
                    ) : (
                        <img
                            src={current.mediaUrl}
                            alt={current.text || ""}
                            className="binge-x-modal-image"
                            referrerPolicy="no-referrer"
                        />
                    )}
                </div>
                <div className="binge-x-modal-info">
                    {current.text && (
                        <p className="binge-x-modal-text">{current.text}</p>
                    )}
                    <div className="binge-x-modal-meta">
                        <span className="binge-x-modal-date">
                            {timeAgo(new Date(current.createdUtc * 1000).toISOString())}
                        </span>
                        {typeof current.favoriteCount === "number" &&
                            current.favoriteCount > 0 && (
                                <span className="binge-x-modal-likes">
                                    ♥ {compactCount(current.favoriteCount)}
                                </span>
                            )}
                        {typeof current.viewCount === "number" &&
                            current.viewCount > 0 && (
                                <span className="binge-x-modal-views">
                                    ▶ {compactCount(current.viewCount)}
                                </span>
                            )}
                        <span className="binge-x-modal-index">
                            {t("x_modal.medi-index_count", "{{current}} / {{total}}", { current: index + 1, total: media.length })}
                        </span>
                    </div>
                    <div className="binge-x-modal-actions">
                        <button
                            type="button"
                            className="binge-x-modal-save"
                            onClick={handleSave}
                            disabled={st === "saving" || st === "saved"}
                        >
                            {st === "saving"
                                ? t("action.saving")
                                : st === "saved"
                                ? t("status.saved")
                                : st === "error"
                                ? t("action.save_failed_retry")
                                : t("action.save_to_stash")}
                        </button>
                        <a
                            href={current.tweetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="binge-x-modal-open-x"
                        >
                            {t("action.open_in_x")}
                        </a>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}

function compactCount(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n < 1000) return String(n);
    if (n < 10_000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
}

import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { getXFeed, xHandleFromUrls, type XMedia } from "../api/bingeServer";
import { useFetchBlobUrl } from "../hooks/useFetchBlobUrl";
import { XDetailModal } from "./XDetailModal";
import type { PerformerDetail } from "../api/queries";
import {
    PLAYBACK_LAYER,
    isPlaybackGated,
} from "../util/playbackStack";

interface PerformerXGridProps {
    performer: PerformerDetail;
}

// Bug 11：演员档案页的 X (Twitter) 标签页。
//
// 当 binge 设置中开启了"在档案中包含 X (Twitter) 媒体"，且演员的
// urls[] 含 twitter.com / x.com 链接时，PerformerProfile 会渲染一个
// 额外的"X"标签。本组件即该 tab 的内容：调用 binge-server 守护进程
// 拉取该演员最近的 X 媒体（图片 + 视频），以 3:4 竖排网格展示。
//
// 点击卡片弹出 XDetailModal（就地播放/查看 + 保存到 Stash + 在 X 打开）。
// 卡片悬停时右上角浮现保存按钮，无需打开 modal 也能快速保存。
//
// 守护进程不可达 / 无 cookies / 无 handle 时显示空状态而非崩溃
// （与首页故事栏 X 集成的优雅降级契约一致）。
export function PerformerXGrid({ performer }: PerformerXGridProps) {
    const { t } = useTranslation();
    const [media, setMedia] = useState<XMedia[]>([]);
    const [handle, setHandle] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [modalIndex, setModalIndex] = useState<number | null>(null);
    // 重试计数器：自增触发 effect 重新拉取。服务端缓存场景下
    // 点击重试可能仍返回旧空结果，但给用户明确反馈"已重试"，
    // 且对网络瞬时失败（超时/断网）场景完全有效。
    const [retryTick, setRetryTick] = useState(0);

    useEffect(() => {
        setMedia([]);
        setHandle(null);
        setError(null);
        setLoading(true);

        const h = xHandleFromUrls(performer.urls);
        if (!h) {
            setHandle(null);
            setLoading(false);
            return;
        }
        setHandle(h);

        let alive = true;
        const stashId = Number(performer.id);
        if (!Number.isFinite(stashId) || stashId <= 0) {
            setError(t("error.invalid_performer_id"));
            setLoading(false);
            return;
        }
        // 拉取较多条目（X tab 是浏览入口，不像故事栏只看 7 天）。
        getXFeed(stashId, 100)
            .then((res) => {
                if (!alive) return;
                if (!res) {
                    // 守护进程不可达 / 未配置 cookies — 友好提示。
                    setError(null);
                    setMedia([]);
                    return;
                }
                setMedia(res.media);
                if (res.handle) setHandle(res.handle);
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
    }, [performer.id, performer.urls, retryTick]);

    const retry = () => {
        if (loading) return;
        setRetryTick((n) => n + 1);
    };

    if (loading) {
        return (
            <section className="binge-profile-photos">
                <div className="binge-status">{t("status.loading_x_media")}</div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="binge-profile-photos binge-x-status-section">
                <div className="binge-status binge-status-error binge-x-status-msg">
                    {t("status.error_message", { message: error })}
                </div>
                <button
                    type="button"
                    className="binge-retry-btn"
                    onClick={retry}
                    disabled={loading}
                >
                    <span className={loading ? "binge-retry-icon is-spinning" : "binge-retry-icon"} aria-hidden="true">⟳</span>
                    <span>{t("action.retry")}</span>
                </button>
            </section>
        );
    }

    if (!handle) {
        return (
            <section className="binge-profile-photos">
                <div className="binge-status">
                    {t("status.no_x_links")}
                </div>
            </section>
        );
    }

    if (media.length === 0) {
        return (
            <section className="binge-profile-photos binge-x-status-section">
                <div className="binge-status binge-x-status-msg">
                    {t("status.no_x_media_found", { handle })}
                </div>
                <button
                    type="button"
                    className="binge-retry-btn"
                    onClick={retry}
                    disabled={loading}
                >
                    <span className={loading ? "binge-retry-icon is-spinning" : "binge-retry-icon"} aria-hidden="true">⟳</span>
                    <span>{t("action.retry")}</span>
                </button>
            </section>
        );
    }

    return (
        <section className="binge-profile-photos">
            <div className="binge-x-grid-meta">
                <a
                    href={`https://x.com/${handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="binge-x-grid-handle"
                >
                    @{handle}
                </a>
                <span className="binge-x-grid-count">
                    {t("x_grid.media_count", { count: media.length })}
                </span>
            </div>
            <ul className="binge-gallery-grid binge-x-grid">
                {media.map((m, i) => (
                    <XCell
                        key={`${m.tweetId}:${m.mediaUrl}`}
                        media={m}
                        performerStashId={performer.id}
                        onOpen={() => setModalIndex(i)}
                        t={t}
                    />
                ))}
            </ul>
            {modalIndex !== null && (
                <XDetailModal
                    media={media}
                    index={modalIndex}
                    performerStashId={performer.id}
                    onClose={() => setModalIndex(null)}
                    onIndexChange={setModalIndex}
                />
            )}
        </section>
    );
}

// X 单元格：3:4 竖排卡片。点击打开 XDetailModal，悬停显示保存按钮。
function XCell({
    media,
    performerStashId,
    onOpen,
    t,
}: {
    media: XMedia;
    performerStashId: string;
    onOpen: () => void;
    t: TFunction;
}) {
    const isVideo = media.kind === "video";
    const [saveState, setSaveState] = useState<
        "idle" | "saving" | "saved" | "error"
    >("idle");

    const handleSave = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (saveState === "saving" || saveState === "saved") return;
        setSaveState("saving");
        const { saveToStash } = await import("../api/bingeServer");
        const xm = media.tweetUrl.match(
            /x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i
        );
        const res = await saveToStash({
            performerStashId,
            source: "x",
            handle: xm?.[1] ?? media.authorHandle,
            id: xm?.[2] ?? media.tweetId,
            mediaUrl: media.mediaUrl,
            kind: media.kind,
            sourceUrl: media.tweetUrl,
            text: media.text,
            createdUtc: media.createdUtc,
        });
        setSaveState(res.ok ? "saved" : "error");
    };

    return (
        <li className="binge-gallery-cell binge-x-cell">
            <button
                type="button"
                onClick={onOpen}
                className="binge-gallery-cover-btn binge-x-tile"
                title={media.text || t("x_grid.tweet", { tweetId: media.tweetId })}
            >
                {isVideo ? (
                    <XVideoThumb media={media} />
                ) : (
                    <img
                        src={media.mediaUrl}
                        alt={media.text || ""}
                        className="binge-gallery-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                    />
                )}
                {isVideo && (
                    <span className="binge-x-play-badge" aria-hidden="true">
                        ▶
                    </span>
                )}
                {typeof media.favoriteCount === "number" &&
                    media.favoriteCount > 0 && (
                        <span className="binge-x-cell-likes">
                            ♥ {compactCount(media.favoriteCount)}
                        </span>
                    )}
                {/* 悬停浮现的保存按钮 */}
                <span
                    className="binge-x-cell-save"
                    onClick={handleSave}
                    role="button"
                    aria-label={
                        saveState === "saved"
                            ? t("status.saved")
                            : saveState === "saving"
                            ? t("status.saving")
                            : t("action.save_to_stash")
                    }
                >
                    {saveState === "saving"
                        ? "⏳"
                        : saveState === "saved"
                        ? "✓"
                        : saveState === "error"
                        ? "✕"
                        : "⬇"}
                </span>
            </button>
        </li>
    );
}

// 视频缩略图（悬停播放 + 下载进度条）：
//
// 加载：fetch(referrerPolicy:'no-referrer') 拿到 blob → createObjectURL
// 生成 blob: URL 喂给 <video>.src。浏览器对 <video> 元素的
// referrerpolicy 属性实现滞后（Chromium 对 media element 长期不实现），
// 从 stash 页面加载 twimg 视频会带 Referer 被 403。fetch API 的
// referrerPolicy 选项可靠，blob URL 是同源本地资源不再发网络请求。
//
// 进度：fetch 时通过 ReadableStream 读取 chunks 计算已下载字节数，
// 配合 Content-Length 显示进度条（0-100%）。无 Content-Length 时退化
// 为 indeterminate（仅 spinner）。
//
// 交互：默认 onLoadedMetadata seek 到 10% 位置显示静态帧；鼠标悬停时
// play() 循环播放预览，离开时 pause() 并重置回静态帧。移动端无 hover
// 保持静态帧 + 点击打开 modal。
//
// blob 加载逻辑抽到 useFetchBlobUrl hook（与 StoryViewer 共用）。
function XVideoThumb({ media }: { media: XMedia }) {
    const { blobUrl, failed, progress } = useFetchBlobUrl(media.mediaUrl);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const seekToThumb = (v: HTMLVideoElement) => {
        try {
            v.currentTime = Math.min(1, (v.duration || 1) * 0.1);
        } catch {
            /* 未就绪时可能抛错，忽略 */
        }
    };

    const handleEnter = () => {
        const v = videoRef.current;
        if (!v) return;
        // 播放层栈：更高的覆盖层打开期间不播预览。
        if (isPlaybackGated(PLAYBACK_LAYER.profile)) return;
        void v.play().catch(() => {
            /* 浏览器自动播放策略拒绝时忽略 */
        });
    };
    const handleLeave = () => {
        const v = videoRef.current;
        if (!v) return;
        v.pause();
        seekToThumb(v);
    };

    if (failed) {
        return (
            <div className="binge-gallery-cover binge-x-thumb-placeholder">
                ▶
            </div>
        );
    }
    if (!blobUrl) {
        return (
            <div className="binge-gallery-cover binge-x-thumb-placeholder">
                {progress !== null ? (
                    <div className="binge-x-progress">
                        <div
                            className="binge-x-progress-bar"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                ) : null}
            </div>
        );
    }
    return (
        <video
            ref={videoRef}
            src={blobUrl}
            className="binge-gallery-cover"
            preload="metadata"
            muted
            loop
            playsInline
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            onLoadedMetadata={(e) => seekToThumb(e.currentTarget)}
        />
    );
}

function compactCount(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n < 1000) return String(n);
    if (n < 10_000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
}

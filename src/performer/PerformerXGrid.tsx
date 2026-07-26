import { useEffect, useRef, useState } from "react";
import { getXFeed, xHandleFromUrls, type XMedia } from "../api/bingeServer";
import type { PerformerDetail } from "../api/queries";

interface PerformerXGridProps {
    performer: PerformerDetail;
}

// Bug 11：演员档案页的 X (Twitter) 标签页。
//
// 当 binge 设置中开启了"在档案中包含 X (Twitter) 媒体"，且演员的
// urls[] 含 twitter.com / x.com 链接时，PerformerProfile 会渲染一个
// 额外的"X"标签。本组件即该 tab 的内容：调用 binge-server 守护进程
// 拉取该演员最近的 X 媒体（图片 + 视频），以 3:4 竖排网格展示。
// 点击任意单元格在新标签页中打开原推文。
//
// 复用 .binge-gallery-grid 的 3:4 网格样式（与图库封面一致），
// 通过 .binge-x-tile 类叠加 X 专属样式（视频播放徽章、计数）。
//
// 守护进程不可达 / 无 cookies / 无 handle 时显示空状态而非崩溃
// （与首页故事栏 X 集成的优雅降级契约一致）。
export function PerformerXGrid({ performer }: PerformerXGridProps) {
    const [media, setMedia] = useState<XMedia[]>([]);
    const [handle, setHandle] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
            setError("无效的演员 ID");
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
    }, [performer.id, performer.urls]);

    if (loading) {
        return (
            <section className="binge-profile-photos">
                <div className="binge-status">加载 X 媒体中…</div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="binge-profile-photos">
                <div className="binge-status binge-status-error">
                    错误：{error}
                </div>
            </section>
        );
    }

    if (!handle) {
        return (
            <section className="binge-profile-photos">
                <div className="binge-status">
                    该演员没有 X (Twitter) 链接。
                </div>
            </section>
        );
    }

    if (media.length === 0) {
        return (
            <section className="binge-profile-photos">
                <div className="binge-status">
                    未获取到 X 媒体。守护进程可能未配置 X cookies，或
                    @{handle} 近期没有发布带媒体的内容。
                </div>
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
                    {media.length} 条媒体
                </span>
            </div>
            <ul className="binge-gallery-grid binge-x-grid">
                {media.map((m) => (
                    <XCell key={`${m.tweetId}:${m.mediaUrl}`} media={m} />
                ))}
            </ul>
        </section>
    );
}

// X 单元格：3:4 竖排卡片，点击在新标签页打开原推文。视频显示播放
// 徽章。
//
// twimg 视频缩略图加载方案（经过多轮实测确认）：
// 1. <img src>：浏览器无法解码 mp4 为图片 → 空白
// 2. <video src> + referrerpolicy="no-referrer"：浏览器对 <video> 元素
//    的 referrerpolicy 属性实现滞后（HTML spec 有，Chromium 对 media
//    element 长期不实现），setAttribute 也无效 → 403
// 3. <video src> + onLoadedMetadata 设 currentTime：因 403 拿不到
//    metadata，黑屏
// 4. fetch(referrerPolicy:'no-referrer') + createObjectURL + <video src>：
//    fetch API 的 referrerPolicy 选项可靠（不同于 video 元素属性），
//    拿到 blob 后 createObjectURL 生成 blob: URL 给 video.src，blob URL
//    是同源本地资源不再发网络请求 → 无 referrer 问题 → 视频正常解码
//
// 代价：每个视频缩略图需完整下载（X 视频通常 < 5MB）。组件卸载时
// revokeObjectURL 释放内存。
function XCell({ media }: { media: XMedia }) {
    const isVideo = media.kind === "video";
    return (
        <li className="binge-gallery-cell binge-x-cell">
            <a
                href={media.tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="binge-gallery-cover-btn binge-x-tile"
                title={media.text || `推文 ${media.tweetId}`}
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
            </a>
        </li>
    );
}

// 视频缩略图：fetch 拿到 blob 后用 createObjectURL 喂给 <video>，
// 在 onLoadedMetadata 时 seek 到 10% 位置（最多 1 秒）显示该帧。
// 加载中/失败时显示占位（保持网格布局不塌陷）。
function XVideoThumb({ media }: { media: XMedia }) {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
        let alive = true;
        let createdUrl: string | null = null;
        setFailed(false);
        setBlobUrl(null);
        fetch(media.mediaUrl, { referrerPolicy: "no-referrer" })
            .then((r) => {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.blob();
            })
            .then((b) => {
                if (!alive || b.size === 0) return;
                createdUrl = URL.createObjectURL(b);
                if (alive) setBlobUrl(createdUrl);
            })
            .catch(() => {
                if (alive) setFailed(true);
            });
        return () => {
            alive = false;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [media.mediaUrl]);

    if (failed) {
        return (
            <div className="binge-gallery-cover binge-x-thumb-placeholder">
                ▶
            </div>
        );
    }
    if (!blobUrl) {
        return (
            <div className="binge-gallery-cover binge-x-thumb-placeholder" />
        );
    }
    return (
        <video
            ref={videoRef}
            src={blobUrl}
            className="binge-gallery-cover"
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                try {
                    v.currentTime = Math.min(1, (v.duration || 1) * 0.1);
                } catch {
                    /* 未就绪时可能抛错，忽略 */
                }
            }}
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

import { useEffect, useState } from "react";
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
// 徽章。twimg.com 与 pbs.twimg.com 同源无防盗链，图片能直接加载说明
// 视频也能——只是之前视频 URL 被塞进 <img src>，浏览器无法解码 mp4
// 为图片导致空白。修复：视频改用 <video>，在 onLoadedMetadata 时显式
// 设置 currentTime 触发 range request 加载该帧作为缩略图。
//
// 为什么不用 #t=0.1 Media Fragment URI：preload="metadata" 只加载头部
// 元数据，浏览器不会主动 seek 并解码 #t 指定的帧 → 黑屏。必须显式设置
// currentTime，浏览器才会发起 range request 下载该位置数据并解码帧。
// 取视频 10% 位置（最多 1 秒）避免开头黑屏淡入。
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
                    <video
                        src={media.mediaUrl}
                        className="binge-gallery-cover"
                        preload="metadata"
                        muted
                        playsInline
                        onLoadedMetadata={(e) => {
                            const v = e.currentTarget;
                            try {
                                v.currentTime = Math.min(
                                    1,
                                    (v.duration || 1) * 0.1
                                );
                            } catch {
                                /* 未就绪时可能抛错，忽略 */
                            }
                        }}
                    />
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

function compactCount(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (n < 1000) return String(n);
    if (n < 10_000) return `${(n / 1000).toFixed(1)}k`.replace(".0k", "k");
    if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
}

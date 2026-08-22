import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useStoryViewer } from "./StoryViewerContext";
import { StoryProgressStrip } from "./StoryProgressStrip";
import { useMuteState } from "../hooks/useMuteState";
import {
    PLAYBACK_LAYER,
    closePlaybackLayer,
    isPlaybackGated,
    openPlaybackLayer,
    subscribePlaybackGate,
} from "../util/playbackStack";
import { MutedIcon, UnmutedIcon } from "../components/MuteToggle";
import { useFilter } from "../filter/FilterContext";
import { useTab } from "../tabs/TabContext";
import { VerifiedIcon } from "../performer/PerformerProfile";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { timeAgo } from "./timeAgo";
import {
    rewriteRedditMediaUrl,
    rewriteRedgifsMediaUrl,
    saveToStash,
    getBingeServerConfig,
    type SaveToStashRequest,
} from "../api/bingeServer";
import { useFetchBlobUrl } from "../hooks/useFetchBlobUrl";
import type { StoryScene } from "./useStories";
import { useTranslation } from "react-i18next";

type RedditStoryScene = Extract<StoryScene, { source: "reddit" }>;

// Max time a story item is shown when the preview WebM doesn't auto-end
// within that window. Mirrors IG's "stories run for a bounded time."
const PREVIEW_CAP_MS = 15_000;
// Shorter cap when we have only a still screenshot (no preview WebM).
const STILL_CAP_MS = 5_000;
// Reddit text/link cards — enough to read a paragraph but not loiter.
const TEXT_LINK_CAP_MS = 8_000;

// IG-style story viewer. Portalled to <body>, only renders when the
// context has isOpen=true. Drives a single <video> through each
// performer's `scenes` array; auto-advances on `ended` or on the cap
// timer, whichever fires first.
export function StoryViewer() {
    const {
        isOpen,
        stories,
        activeIndex,
        setActiveIndex,
        close,
    } = useStoryViewer();
    const { replace } = useFilter();
    const { setTab, setPinFirstSceneId } = useTab();
    const { openProfile } = usePerformerProfile();
    const { t } = useTranslation();

    const [sceneIndex, setSceneIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [progress, setProgress] = useState(0);
    const [muted, setMuted, setMutedSession] = useMuteState();
    // Whether the daemon can save posts to Stash (library roots set).
    const [saveConfigured, setSaveConfigured] = useState(false);
    // Per-scene save status, keyed by scene id.
    const [saveState, setSaveState] = useState<
        Record<string, "saving" | "saved" | "error">
    >({});

    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        getBingeServerConfig().then((c) => {
            if (alive) setSaveConfigured(!!c?.socialSaveConfigured);
        });
        return () => {
            alive = false;
        };
    }, [isOpen]);

    // 播放层栈：story 弹窗打开期间登记为 story 层（z:120），底层的
    // feed 卡片 / reel 视频暂停并停止自动播放；关闭时注销。
    useEffect(() => {
        if (!isOpen) return;
        openPlaybackLayer(PLAYBACK_LAYER.story);
        return () => closePlaybackLayer(PLAYBACK_LAYER.story);
    }, [isOpen]);

    // 更高的覆盖层（PH 播放器等）压在本弹窗之上时冻结：复用用户暂停
    // 机制（视频 + 进度条一起停），关闭后不自动恢复——用户点击继续，
    // 避免两层同时出声。
    useEffect(() => {
        if (!isOpen) return;
        const sync = () => {
            if (isPlaybackGated(PLAYBACK_LAYER.story)) setPaused(true);
        };
        sync();
        return subscribePlaybackGate(sync);
    }, [isOpen]);

    const videoRef = useRef<HTMLVideoElement>(null);
    const rafRef = useRef<number | null>(null);
    const startRef = useRef<number>(0);
    const accumRef = useRef<number>(0);

    const activeStory = stories[activeIndex];
    const currentScene = activeStory?.scenes[sceneIndex];
    // Per-source cap: video-bearing slides get 15s, stills 5s, reddit
    // text/link cards 8s (enough to read a paragraph).
    const capMs = ((): number => {
        if (!currentScene) return STILL_CAP_MS;
        if (currentScene.source === "library") {
            return currentScene.preview ? PREVIEW_CAP_MS : STILL_CAP_MS;
        }
        if (currentScene.source === "stashdb") return STILL_CAP_MS;
        // reddit
        switch (currentScene.kind) {
            case "video":
                return PREVIEW_CAP_MS;
            case "image":
                return STILL_CAP_MS;
            case "text":
            case "link":
            default:
                return TEXT_LINK_CAP_MS;
        }
    })();

    // A reddit-source scene that's actually savable (downloadable media).
    const savableReq: SaveToStashRequest | null =
        currentScene && activeStory
            ? buildSaveRequest(currentScene, activeStory.performerId)
            : null;
    const savableKey = currentScene ? currentScene.id : "";
    const handleSave = async () => {
        const st = saveState[savableKey];
        if (!savableReq || st === "saving" || st === "saved") return;
        setSaveState((m) => ({ ...m, [savableKey]: "saving" }));
        const res = await saveToStash(savableReq);
        setSaveState((m) => ({
            ...m,
            [savableKey]: res.ok ? "saved" : "error",
        }));
    };

    // Reset sceneIndex whenever the focused performer changes. Don't
    // reset on simple sceneIndex-bumps from within the same performer.
    useEffect(() => {
        setSceneIndex(0);
        setPaused(false);
    }, [activeIndex]);

    // Reset progress + accumulator on scene/performer change.
    useEffect(() => {
        accumRef.current = 0;
        setProgress(0);
    }, [activeIndex, sceneIndex]);

    const advance = useCallback(() => {
        if (!activeStory) return;
        if (sceneIndex < activeStory.scenes.length - 1) {
            setSceneIndex((i) => i + 1);
            return;
        }
        if (activeIndex < stories.length - 1) {
            setActiveIndex(activeIndex + 1);
            return;
        }
        close();
    }, [activeStory, sceneIndex, activeIndex, stories.length, setActiveIndex, close]);

    const goPrev = useCallback(() => {
        if (sceneIndex > 0) {
            setSceneIndex((i) => i - 1);
            return;
        }
        if (activeIndex > 0) {
            const prevStory = stories[activeIndex - 1];
            setActiveIndex(activeIndex - 1);
            // The activeIndex effect will reset sceneIndex to 0; we want
            // the LAST scene of the previous performer. Schedule a follow-up.
            setTimeout(() => {
                setSceneIndex(Math.max(0, prevStory.scenes.length - 1));
            }, 0);
        }
        // At first performer + first scene: no-op.
    }, [activeIndex, sceneIndex, stories, setActiveIndex]);

    // Drive the progress bar via requestAnimationFrame; advance when full.
    useEffect(() => {
        if (!isOpen) return;
        if (paused) {
            // Capture elapsed-since-resume into the accumulator so the
            // next play continues from the same fraction.
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            accumRef.current += performance.now() - startRef.current;
            return;
        }
        startRef.current = performance.now();
        const tick = (now: number) => {
            const elapsed = accumRef.current + (now - startRef.current);
            const fraction = Math.min(1, elapsed / capMs);
            setProgress(fraction);
            if (fraction >= 1) {
                rafRef.current = null;
                advance();
                return;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [isOpen, paused, capMs, activeIndex, sceneIndex, advance]);

    // Sync the <video> element's play state with our `paused` flag.
    //
    // Bug 修复（需求3）：首次打开 StoryViewer 时，<video> 元素刚挂载，src 刚
    // 设置但浏览器还没开始加载/解码。此时调用 play() 会因视频未就绪返回
    // AbortError 或 NotAllowedError，catch 里的静音重试也会因同样原因失败
    // → 第一部影片大概率不会自动播放。切换下一部再切回时，video.key 变化
    // 触发 remount，此时视频管道已"预热"且用户手势更新鲜，所以能播放。
    //
    // 修复：添加 canplay / loadeddata 事件监听，在视频就绪时重试 play()。
    // 同时添加调试日志便于排查。useMuteState 的两层（persisted/effective）
    // 保证用户偏好不被覆盖。
    //
    // Bug 修复（需求2）：依赖数组必须包含 `isOpen`。StoryViewerContext.open
    // 传入的 stories 来自 StoriesContext 共享状态——关闭后重开同一演员时，
    // stories 是同一引用，setStories 不触发 re-render；activeIndex 因传入
    // 相同 startIndex 也不变 → sceneIndex/currentScene 引用均不变 → 若 deps
    // 不含 isOpen，effect 不会重跑，新挂载的 <video> 既未绑定 canplay/
    // loadeddata 监听器，tryPlay("effect") 也不会被调用 → 自动播放失败。
    // 用户点击两次影片或切换其他演员时 sceneIndex/activeIndex 变化 → effect
    // 重跑 → 监听器重新绑定 → 自动播放恢复。加入 isOpen 后，关闭→重开同一
    // 演员时 isOpen 从 false 变 true → effect 重跑 → 正确驱动新 video。
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (paused) {
            video.pause();
            return;
        }
        video.muted = muted;
        const tryPlay = () => {
            if (video.paused) {
                void video.play().then(
                    () => { /* play ok */ },
                    (err: unknown) => {
                        const name = (err as DOMException | null)?.name;
                        // AbortError: play() interrupted by load()/src swap
                        // — 不要改 mute 状态，canplay 监听器会在就绪后重试。
                        if (name === "AbortError") return;
                        // NotAllowedError 等：静音后重试，canplay 监听器兜底。
                        video.muted = true;
                        if (!muted) setMutedSession(true);
                        void video.play().catch(() => {
                            /* canplay 监听器会重试 */
                        });
                    }
                );
            }
        };
        tryPlay();
        // 视频就绪时重试 play() — 解决首次打开未自动播放的核心修复。
        const onCanPlay = () => tryPlay();
        const onLoadedData = () => tryPlay();
        video.addEventListener("canplay", onCanPlay);
        video.addEventListener("loadeddata", onLoadedData);
        return () => {
            video.removeEventListener("canplay", onCanPlay);
            video.removeEventListener("loadeddata", onLoadedData);
        };
    }, [isOpen, paused, sceneIndex, activeIndex, muted, setMutedSession, currentScene]);

    // Keep <video>.muted in sync when the user toggles mute mid-story.
    useEffect(() => {
        const video = videoRef.current;
        if (video) video.muted = muted;
    }, [muted]);

    // Keyboard nav, mirroring ImageLightbox.
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowLeft") goPrev();
            else if (e.key === "ArrowRight") advance();
            else if (e.key === " ") {
                e.preventDefault();
                setPaused((p) => !p);
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [isOpen, close, goPrev, advance]);

    if (!isOpen || !activeStory || !currentScene) return null;

    const handleCta = () => {
        if (currentScene.source === "stashdb") {
            // StashDB scenes aren't in the library — there's nothing
            // to play. Open the StashDB page so the user can browse
            // full metadata + decide whether to grab the scene.
            window.open(
                currentScene.stashboxUrl,
                "_blank",
                "noopener,noreferrer"
            );
            close();
            return;
        }
        if (currentScene.source === "reddit") {
            // Reddit posts open on reddit.com in a new tab — that's
            // where comments + interaction live.
            window.open(
                currentScene.permalink,
                "_blank",
                "noopener,noreferrer"
            );
            close();
            return;
        }
        // Library scene — existing reel-entry flow.
        // Defensive reset: if the user was in chained mode (entered
        // the reel via Explore earlier), the "Watch full scene" CTA
        // is a fresh, filter-driven random entry. Don't carry
        // chained state into it.
        //
        // Bug 修复：setTab 内部会 setPinFirstSceneId(null) + setReelMode("random")，
        // 若在 setTab 之前调用 setPinFirstSceneId / setReelMode，最终状态会被
        // setTab 清空 → Reel 走 random 路径拉一页随机场景 → 用户看到随机影片
        // 而非点击的影片。必须在 setTab 之后再设置 pin，利用 React 18 批处理
        // "后写胜"语义保证最终状态正确（与 SceneFeedCard 的 handleWatchFullScene、
        // PackDetailSheet 的 handlePick 保持一致）。reelMode 已由 setTab 重置
        // 为 random，无需重复设置。
        replace({
            performers: [
                {
                    id: activeStory.performerId,
                    name: activeStory.performerName,
                    image_path: activeStory.performerImagePath,
                },
            ],
            tags: [],
            studios: [],
        });
        setTab("foryou");
        setPinFirstSceneId(currentScene.id);
        close();
    };

    // Adjacent peeks. ±1 is the primary peek; ±2 sits further out and
    // dimmer. Out-of-range indices simply omit a peek.
    const leftPeeks = [activeIndex - 2, activeIndex - 1]
        .filter((i) => i >= 0)
        .map((i) => stories[i]);
    const rightPeeks = [activeIndex + 1, activeIndex + 2]
        .filter((i) => i < stories.length)
        .map((i) => stories[i]);

    return createPortal(
        <div
            className="binge-story-viewer-root"
            role="dialog"
            aria-label={t("nav.story_viewer")}
        >
            <div
                className="binge-story-viewer-backdrop"
                onClick={close}
                aria-label={t("action.close")}
            />
            <button
                type="button"
                className="binge-story-viewer-close"
                onClick={close}
                aria-label={t("action.close")}
            >
                ×
            </button>
            {/* Desktop chevrons. Pinned to the viewport edges so they
                never crowd the focused card regardless of how many
                peeks are showing. Hidden on narrow viewports — touch
                users have the in-card tap zones. */}
            <button
                type="button"
                className="binge-story-viewer-chevron binge-story-viewer-chevron-prev"
                onClick={goPrev}
                aria-label={t("action.previous")}
                disabled={activeIndex === 0 && sceneIndex === 0}
            >
                <ChevronLeft />
            </button>
            <button
                type="button"
                className="binge-story-viewer-chevron binge-story-viewer-chevron-next"
                onClick={advance}
                aria-label={t("action.next")}
            >
                <ChevronRight />
            </button>
            <div className="binge-story-viewer-stage">
                <div className="binge-story-viewer-peeks binge-story-viewer-peeks-left">
                    {leftPeeks.map((p, idx) => (
                        <Peek
                            key={p.performerId}
                            story={p}
                            distance={leftPeeks.length - idx}
                            onClick={() =>
                                setActiveIndex(activeIndex - (leftPeeks.length - idx))
                            }
                        />
                    ))}
                </div>

                <div className="binge-story-viewer-card">
                    {currentScene.source === "library" && (
                        <video
                            ref={videoRef}
                            className={
                                "binge-story-viewer-video" +
                                (currentScene.width !== null &&
                                currentScene.height !== null &&
                                currentScene.height > currentScene.width
                                    ? " is-portrait"
                                    : "")
                            }
                            key={currentScene.id}
                            src={currentScene.preview ?? undefined}
                            poster={currentScene.screenshot ?? undefined}
                            playsInline
                            muted={muted}
                            onEnded={advance}
                        />
                    )}
                    {currentScene.source === "stashdb" && (
                        <img
                            className="binge-story-viewer-image"
                            key={currentScene.id}
                            src={currentScene.cover ?? undefined}
                            alt={currentScene.title ?? t("scene.stashdb_scene")}
                        />
                    )}
                    {currentScene.source === "reddit" && (
                        <RedditCardBody
                            scene={currentScene}
                            videoRef={videoRef}
                            muted={muted}
                            onEnded={advance}
                        />
                    )}

                    <div className="binge-story-viewer-header">
                        <StoryProgressStrip
                            sceneCount={activeStory.scenes.length}
                            currentIndex={sceneIndex}
                            progress={progress}
                        />
                        <div className="binge-story-viewer-meta">
                            <button
                                type="button"
                                className="binge-story-viewer-performer"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openProfile(activeStory.performerId);
                                    close();
                                }}
                                aria-label={t("action.open_profile_name", { name: activeStory.performerName })}
                                title={t("action.open_profile")}
                            >
                                <span
                                    className="binge-story-viewer-avatar"
                                    style={
                                        activeStory.performerImagePath
                                            ? {
                                                  backgroundImage: `url(${activeStory.performerImagePath})`,
                                              }
                                            : undefined
                                    }
                                    aria-hidden="true"
                                />
                                <span className="binge-story-viewer-name">
                                    {activeStory.performerName}
                                    <span
                                        className={
                                            "binge-feed-card-verified" +
                                            (activeStory.performerFavorite
                                                ? " is-favorite"
                                                : "")
                                        }
                                        aria-label={
                                            activeStory.performerFavorite
                                                ? t("status.favorite")
                                                : t("status.in_library")
                                        }
                                        title={
                                            activeStory.performerFavorite
                                                ? t("status.favorite")
                                                : t("status.in_library")
                                        }
                                    >
                                        <VerifiedIcon />
                                    </span>
                                </span>
                            </button>
                            <span className="binge-story-viewer-time">
                                {timeAgo(currentScene.effectiveAt)}
                            </span>
                            {currentScene.source === "stashdb" && (
                                <span
                                    className="binge-story-viewer-source-badge"
                                    title={t("status.from_stashdb_not_in_library")}
                                >
                                    StashDB
                                </span>
                            )}
                            {currentScene.source === "reddit" && (
                                <span
                                    className="binge-story-viewer-source-badge"
                                    title={
                                        currentScene.mediaUrl ??
                                        currentScene.linkUrl ??
                                        currentScene.permalink
                                    }
                                >
                                    {redditBadgeLabel(currentScene, t)}
                                </span>
                            )}
                            <button
                                type="button"
                                className="binge-story-viewer-mute"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setMuted(!muted);
                                }}
                                aria-label={muted ? t("action.unmute") : t("action.mute")}
                                title={muted ? t("action.unmute") : t("action.mute")}
                            >
                                {muted ? <MutedIcon /> : <UnmutedIcon />}
                            </button>
                            {savableReq && saveConfigured && (
                                <button
                                    type="button"
                                    className={
                                        "binge-story-viewer-save" +
                                        (saveState[savableKey] === "saved"
                                            ? " is-saved"
                                            : "") +
                                        (saveState[savableKey] === "error"
                                            ? " is-error"
                                            : "")
                                    }
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleSave();
                                    }}
                                    disabled={
                                        saveState[savableKey] === "saving" ||
                                        saveState[savableKey] === "saved"
                                    }
                                    title={
                                        saveState[savableKey] === "error"
                                            ? t("action.save_failed_retry")
                                            : t("action.save_to_stash")
                                    }
                                >
                                    {saveState[savableKey] === "saved"
                                        ? t("status.saved_with_check")
                                        : saveState[savableKey] === "saving"
                                          ? t("status.saving")
                                          : saveState[savableKey] === "error"
                                            ? t("action.retry")
                                            : t("action.save")}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tap zones. Order matters — sit above the video,
                        below the header/footer overlays so the chrome
                        captures its own clicks. */}
                    <button
                        type="button"
                        className="binge-story-viewer-tap binge-story-viewer-tap-left"
                        onClick={goPrev}
                        aria-label={t("action.previous")}
                        tabIndex={-1}
                    />
                    <button
                        type="button"
                        className="binge-story-viewer-tap binge-story-viewer-tap-center"
                        onClick={() => setPaused((p) => !p)}
                        aria-label={paused ? t("action.continue") : t("action.pause")}
                        tabIndex={-1}
                    />
                    <button
                        type="button"
                        className="binge-story-viewer-tap binge-story-viewer-tap-right"
                        onClick={advance}
                        aria-label={t("action.next")}
                        tabIndex={-1}
                    />

                    <div className="binge-story-viewer-footer">
                        {currentScene.title && (
                            <div className="binge-story-viewer-caption">
                                {currentScene.title}
                            </div>
                        )}
                        <button
                            type="button"
                            className="binge-story-viewer-cta"
                            onClick={handleCta}
                        >
                            {currentScene.source === "stashdb"
                                ? t("action.view_on_stashdb_arrow")
                                : currentScene.source === "reddit"
                                  ? currentScene.domain === "x.com" ||
                                    currentScene.domain === "twitter.com"
                                      ? t("action.open_on_x_arrow")
                                      : currentScene.domain === "pornhub.com"
                                        ? t("action.open_on_pornhub_arrow")
                                        : t("action.open_on_reddit_arrow")
                                  : t("action.watch_full_scene_arrow")}
                        </button>
                    </div>
                </div>

                <div className="binge-story-viewer-peeks binge-story-viewer-peeks-right">
                    {rightPeeks.map((p, idx) => (
                        <Peek
                            key={p.performerId}
                            story={p}
                            distance={idx + 1}
                            onClick={() => setActiveIndex(activeIndex + idx + 1)}
                        />
                    ))}
                </div>
            </div>
        </div>,
        document.body
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

// Compact source label for the header pill on reddit posts. Lets us
// tell at a glance whether a video that won't play is a redgifs failure
// (CDN block / referrer / etc.) vs a v.redd.it issue vs an image post
// vs something else.
// Build a save-to-Stash request from a savable reddit-source story scene
// (image/video with a direct media url). Returns null for non-savable
// scenes (library/stashdb, or reddit text/link cards). Source is inferred
// from the domain; handle + id parsed from an X permalink when present
// (the daemon derives them otherwise).
function buildSaveRequest(
    scene: StoryScene,
    performerId: string
): SaveToStashRequest | null {
    if (scene.source !== "reddit") return null;
    if (!scene.mediaUrl || (scene.kind !== "image" && scene.kind !== "video")) {
        return null;
    }
    const d = (scene.domain ?? "").toLowerCase();
    let source: SaveToStashRequest["source"] = "reddit";
    if (d === "x.com" || d === "twitter.com") source = "x";
    else if (d.includes("redgifs")) source = "redgifs";
    let handle: string | undefined;
    let id: string | undefined;
    const xm = scene.permalink.match(/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i);
    if (xm) {
        handle = xm[1];
        id = xm[2];
    }
    return {
        performerStashId: performerId,
        source,
        handle,
        id,
        mediaUrl: scene.mediaUrl,
        kind: scene.kind,
        sourceUrl: scene.permalink,
        text: scene.title ?? undefined,
        createdUtc: scene.createdUtc,
    };
}

function redditBadgeLabel(scene: RedditStoryScene, t: (key: string) => string): string {
    const d = (scene.domain ?? "").toLowerCase();
    // X and PornHub media are folded onto the reddit scene shape (same
    // image/video render path) with their own domain — label accordingly.
    if (d === "x.com" || d === "twitter.com") return "X";
    if (d === "pornhub.com") return "PornHub";
    if (scene.kind === "video") {
        if (d.includes("redgifs")) return "redgifs";
        if (d === "v.redd.it") return t("status.reddit_video");
        return d || t("status.video");
    }
    if (scene.kind === "image") {
        if (d === "i.redd.it") return t("status.reddit_image");
        return d || t("status.image");
    }
    if (scene.kind === "text") return t("status.reddit_text");
    return d || t("status.reddit_link");
}

// Reddit card body: switches on `kind` to render image / video / text /
// link. Video shares the same ref as library so the existing mute +
// pause-sync effects keep working.
function RedditCardBody({
    scene,
    videoRef,
    muted,
    onEnded,
}: {
    scene: RedditStoryScene;
    videoRef: RefObject<HTMLVideoElement | null>;
    muted: boolean;
    onEnded: () => void;
}) {
    const [videoError, setVideoError] = useState<string | null>(null);
    // PH videos whose mediabook preview 404'd (most studio content) —
    // rendered as a still poster instead of an error card.
    const [posterOnly, setPosterOnly] = useState(false);
    const { t } = useTranslation();

    // Reset error when scene id changes (next slide).
    useEffect(() => {
        setVideoError(null);
        setPosterOnly(false);
    }, [scene.id]);

    // X (twimg) / Reddit (v.redd.it) 视频会检查 Referer，<video> 元素的
    // referrerpolicy 属性浏览器实现滞后（Chromium 对 media element 长期
    // 不实现），从 stash 页面加载带 Referer 会被 403。改用 fetch +
    // createObjectURL 生成 blob: URL 绕过。redgifs 已有 binge-server
    // 代理（rewriteRedgifsMediaUrl），保持原样。
    const needsBlobProxy = (() => {
        if (scene.kind !== "video") return false;
        const d = (scene.domain || "").toLowerCase();
        if (d === "x.com" || d === "twitter.com") return true;
        if (d === "v.redd.it" || d === "redditmedia.com") return true;
        return false;
    })();
    const { blobUrl: fetchedBlobUrl, failed: blobFailed } =
        useFetchBlobUrl(needsBlobProxy ? scene.mediaUrl : null);

    // blob URL 就绪时赋给 <video>.src。
    useEffect(() => {
        if (!needsBlobProxy) return;
        const v = videoRef.current;
        if (!v) return;
        if (blobFailed) {
            setVideoError(t("status.video_load_failed"));
            return;
        }
        if (fetchedBlobUrl && v.src !== fetchedBlobUrl) {
            v.src = fetchedBlobUrl;
        }
    }, [needsBlobProxy, fetchedBlobUrl, blobFailed]);

    // Set referrerpolicy BEFORE the src triggers a load — redgifs
    // (and similar anti-hotlink CDNs) 403 any request whose Referer
    // isn't their own origin. Browsers fire the network request as
    // soon as the element commits with src; useEffect runs too late.
    // A callback ref lets us setAttribute and src in deterministic
    // order on the same DOM node.
    //
    // X/Reddit 视频（needsBlobProxy）改用 fetch+blob URL 绕过 Referer
    // 检查，不再 setAttribute("referrerpolicy")（对 <video> 无效）。
    // blob: URL 是同源本地资源，不发网络请求，无 Referer 问题。
    const setVideoRef = (el: HTMLVideoElement | null) => {
        videoRef.current = el;
        if (!el) return;
        if (scene.kind === "video" && scene.mediaUrl) {
            if (needsBlobProxy) {
                // blob URL 由 useFetchBlobUrl hook 异步提供，上方 effect
                // 会在 blobUrl 就绪时设置 src。
                return;
            }
            el.setAttribute("referrerpolicy", "no-referrer");
            const src = rewriteRedgifsMediaUrl(scene.mediaUrl);
            if (src && el.src !== src) el.src = src;
        }
    };

    if (scene.kind === "image") {
        // Proxy Reddit-hosted images through binge-server for the same
        // referrer / firewall reasons we proxy redgifs videos. The
        // helper passes through unchanged for non-Reddit URLs.
        const rawImg = scene.mediaUrl ?? scene.thumbUrl;
        const imgSrc = rewriteRedditMediaUrl(rawImg) ?? undefined;
        return (
            <img
                className="binge-story-viewer-image"
                key={scene.id}
                src={imgSrc}
                referrerPolicy="no-referrer"
                alt={scene.title ?? t("status.reddit_image")}
            />
        );
    }
    if (scene.kind === "video") {
        // PH story items carry a "ph:{viewkey}" id and play the preview
        // (mediabook) proxy. Most studio videos have no mediabook, so the
        // proxy 404s — render the poster still instead (stories are 15s
        // capped; the full stream belongs to the popup player, not here).
        // The rAF cap advances to the next scene as usual.
        const isPornhub = (scene.domain || "").toLowerCase() === "pornhub.com";
        const posterSrc = rewriteRedditMediaUrl(scene.thumbUrl);
        if (posterOnly && posterSrc) {
            return (
                <img
                    className="binge-story-viewer-image"
                    key={scene.id}
                    src={posterSrc}
                    referrerPolicy="no-referrer"
                    alt={scene.title ?? ""}
                />
            );
        }
        const handleError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
            const v = e.currentTarget;
            if (isPornhub && scene.id.startsWith("ph:") && posterSrc) {
                setPosterOnly(true);
                return;
            }
            const err = v.error;
            setVideoError(
                err
                    ? `MediaError ${err.code} (${err.message || t("status.no_message")})`
                    : t("status.unknown_video_error")
            );
        };
        return (
            <>
                <video
                    ref={setVideoRef}
                    className="binge-story-viewer-video"
                    key={scene.id}
                    poster={posterSrc ?? undefined}
                    playsInline
                    muted={muted}
                    onEnded={onEnded}
                    onError={handleError}
                />
                {videoError && (
                    <>
                        {/* Backdrop so a failed video isn't a black void —
                            the thumb proxy usually still serves. */}
                        {posterSrc && (
                            <img
                                className="binge-story-viewer-image"
                                src={posterSrc}
                                alt=""
                            />
                        )}
                        <div className="binge-story-viewer-video-error">
                            <div>{t("status.video_play_failed")}</div>
                            <code>{videoError}</code>
                            <code style={{ wordBreak: "break-all" }}>
                                {scene.mediaUrl}
                            </code>
                        </div>
                    </>
                )}
            </>
        );
    }
    if (scene.kind === "text") {
        return (
            <div
                className="binge-story-viewer-text"
                key={scene.id}
                aria-label={scene.title ?? t("status.reddit_text_post")}
            >
                {scene.title && (
                    <h2 className="binge-story-viewer-text-title">
                        {scene.title}
                    </h2>
                )}
                {scene.body && (
                    <p className="binge-story-viewer-text-body">
                        {truncate(scene.body, 600)}
                    </p>
                )}
            </div>
        );
    }
    // link
    const linkThumb = rewriteRedditMediaUrl(scene.thumbUrl);
    return (
        <div
            className="binge-story-viewer-link"
            key={scene.id}
            style={
                linkThumb
                    ? { backgroundImage: `url(${linkThumb})` }
                    : undefined
            }
            aria-label={scene.title ?? t("status.reddit_link_post")}
        >
            <div className="binge-story-viewer-link-overlay">
                {scene.domain && (
                    <span className="binge-story-viewer-link-domain">
                        {scene.domain}
                    </span>
                )}
                {scene.title && (
                    <h2 className="binge-story-viewer-link-title">
                        {scene.title}
                    </h2>
                )}
            </div>
        </div>
    );
}

function truncate(text: string, limit: number): string {
    if (text.length <= limit) return text;
    return text.slice(0, limit).trimEnd() + "…";
}

// Shrunken adjacent story. Uses the latest scene's screenshot as a still
// background — no <video> here, peeks must stay cheap.
function Peek({
    story,
    distance,
    onClick,
}: {
    story: import("./useStories").Story;
    distance: number;
    onClick: () => void;
}) {
    const latest = story.scenes[0];
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className={`binge-story-viewer-peek is-distance-${distance}`}
            onClick={onClick}
            aria-label={t("action.view_story_name", { name: story.performerName })}
            style={(() => {
                if (!latest) return undefined;
                // Library scenes have `screenshot`; StashDB scenes have
                // `cover`; reddit posts have `thumbUrl` (or `mediaUrl`
                // when the post is an image). Use whichever the source
                // provides as the peek thumbnail.
                let bg: string | null = null;
                if (latest.source === "library") bg = latest.screenshot;
                else if (latest.source === "stashdb") bg = latest.cover;
                else if (latest.source === "reddit")
                    bg = latest.thumbUrl ?? latest.mediaUrl;
                return bg
                    ? { backgroundImage: `url(${bg})` }
                    : undefined;
            })()}
        >
            <span className="binge-story-viewer-peek-name">
                {story.performerName}
            </span>
        </button>
    );
}

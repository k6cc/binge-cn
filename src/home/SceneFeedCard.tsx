import { useEffect, useMemo, useRef, useState } from "react";
import { SceneCardMenu } from "./SceneCardMenu";
import { PerformerHoverCard } from "./PerformerHoverCard";
import { Fragment } from "react";
import type { FeedPerformer, FeedTag, SceneFeedItem } from "./useFeed";
import { VerifiedIcon } from "../performer/PerformerProfile";
import { useSharedStories } from "./StoriesContext";
import { useStoryViewer } from "./StoryViewerContext";
import { useFilter } from "../filter/FilterContext";
import { useTab } from "../tabs/TabContext";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { useMuteState } from "../hooks/useMuteState";
import { readDemoMode } from "./pluginSettings";
import { sceneIncrementO } from "../api/mutations";
import { recordTagInteractions } from "../api/interactedTags";
import {
    useHasAdvancedRating,
    useHasMultiview,
    useHasScribe,
} from "../plugins/PluginContext";
import {
    isInMultiviewQueue,
    toggleMultiviewQueueScene,
    subscribeMultiviewQueue,
    startMultiviewSync,
} from "../api/multiview";
import {
    GridIcon,
    PencilIcon,
    StarIcon,
    BookmarkIcon,
    RepostIcon,
} from "../components/ActionStack";
import { CriterionRatingModal } from "../components/CriterionRatingModal";
import { MutedIcon, UnmutedIcon } from "../components/MuteToggle";
import { SaveSheet } from "../components/SaveSheet";
import {
    getCollectionTagIds,
    getCollections,
    setSceneInCollection,
    subscribeCollections,
} from "../api/collections";
import { timeAgo } from "./timeAgo";
import { useScribeModal } from "../scribe/ScribeContext";
import { useTranslation } from "react-i18next";

interface SceneFeedCardProps {
    item: SceneFeedItem;
}

// Scene-as-post IG-style card. Preview WebM auto-plays muted when ≥60%
// in view (IntersectionObserver, same threshold the Reel uses). Click
// the media to toggle play/pause; double-click to like; tap the header
// avatar/name to open that performer's profile.
//
// 硬约束：CTA "观看完整场景 →" 使用 chained 模式（而非 pinnedQueue）。
// chained 模式以当前场景为种子，由 chainAlgo 生成后续推荐，避免
// pinnedQueue 的 scrollTo() 被虚拟列表逻辑覆盖的问题。
export function SceneFeedCard({ item }: SceneFeedCardProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [muted, setMuted] = useMuteState();
    const [oCount, setOCount] = useState(0);
    const [liked, setLiked] = useState(false);
    const oBusyRef = useRef(false);
    const { t } = useTranslation();

    const { replace } = useFilter();
    const { setTab, setPinFirstSceneId, setReelMode } = useTab();
    const { openProfile } = usePerformerProfile();
    const { open: openStoryViewer } = useStoryViewer();
    const storiesState = useSharedStories();
    // Set of localIds with an active story right now. Used by the
    // avatar stack to render the gradient ring + route the tap to
    // the story viewer instead of the profile. Memoized so it only
    // rebuilds when the shared stories change, not on every render
    // of every mounted card.
    const storyPerformerIds = useMemo<Set<string>>(
        () =>
            storiesState.state.kind === "ready"
                ? new Set(
                      storiesState.state.stories.map((s) => s.performerId)
                  )
                : new Set(),
        [storiesState.state]
    );

    const hasAdvancedRating = useHasAdvancedRating();
    const hasMultiview = useHasMultiview();
    const hasScribe = useHasScribe();

    const [ratingOpen, setRatingOpen] = useState(false);
    const [saveSheetOpen, setSaveSheetOpen] = useState(false);
    const [inMVQueue, setInMVQueue] = useState(false);
    const [inCollections, setInCollections] = useState<Record<string, boolean>>({});

    // Multiview queue membership — resynced on every queue change (this
    // tab, other tabs, and other clients via the config poll).
    useEffect(() => {
        startMultiviewSync();
        const refresh = () => setInMVQueue(isInMultiviewQueue(item.sceneId));
        refresh();
        return subscribeMultiviewQueue(refresh);
    }, [item.sceneId]);

    // Per-collection membership for the bookmark fill state. Mirrors
    // SceneSlide's pattern: cross-reference each collection's tag id
    // against the scene's tags.
    useEffect(() => {
        let alive = true;
        const refresh = async () => {
            try {
                const [collections, tagIdMap] = await Promise.all([
                    getCollections(),
                    getCollectionTagIds(),
                ]);
                if (!alive) return;
                const result: Record<string, boolean> = {};
                for (const c of collections) {
                    const id = tagIdMap.get(c.tagName);
                    result[c.tagName] = id
                        ? item.tags.some((t) => t.id === id)
                        : false;
                }
                setInCollections(result);
            } catch {
                /* leave previous map */
            }
        };
        void refresh();
        const unsub = subscribeCollections(() => void refresh());
        return () => {
            alive = false;
            unsub();
        };
    }, [item.sceneId, item.tags]);

    const savedSomewhere = Object.values(inCollections).some(Boolean);
    const handleToggleMV = () => {
        setInMVQueue(toggleMultiviewQueueScene(item.sceneId));
    };
    const scribeModal = useScribeModal();
    const handleOpenScribe = () => {
        scribeModal.openScene(item.sceneId);
    };
    const handleToggleCollection = async (tagName: string) => {
        const next = !inCollections[tagName];
        setInCollections((m) => ({ ...m, [tagName]: next }));
        // Same intent signal as the reel: saving = strong taste data.
        if (next) recordTagInteractions(item.tags);
        try {
            const confirmed = await setSceneInCollection(
                item.sceneId,
                item.tags.map((t) => t.id),
                tagName,
                next
            );
            setInCollections((m) => ({ ...m, [tagName]: confirmed }));
        } catch {
            // Revert on error.
            setInCollections((m) => ({ ...m, [tagName]: !next }));
        }
    };

    const isPortrait =
        item.width !== null &&
        item.height !== null &&
        item.height > item.width;
    const primaryPerformer = item.performers[0];

    // Auto-play when scrolled into view. Mirrors SceneSlide's IO logic
    // but drops the muted-fallback dance — feed previews are always
    // muted by default, the user has to click the card to unmute.
    //
    // 需求1 修复：原代码在 IO callback 里写 `video.muted = muted`，但
    // 闭包固定了 mount 时的 muted 值——用户切换静音后，新进入视口的
    // 卡片会被旧闭包值覆盖，导致每部影片都要关再开才有声音。
    // 现在 IO 只负责 play/pause，muted 完全交给下方的独立 effect 同步。
    // threshold 提高到 0.75，减少窄卡片场景下两张影片同时满足阈值
    // 而同时播放声音的问题。
    useEffect(() => {
        const container = containerRef.current;
        const video = videoRef.current;
        if (!container || !video) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const active = entry.intersectionRatio >= 0.75;
                    if (active) {
                        void video.play().catch(() => {
                            // Retry muted, accept failure silently.
                            video.muted = true;
                            void video.play().catch(() => {});
                        });
                    } else {
                        video.pause();
                    }
                }
            },
            { threshold: [0, 0.75, 1] }
        );
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    // 同步 video.muted 与 React muted 状态。IO 不再触碰 muted，
    // 因此无论用户何时切换静音，当前及后续进入视口的卡片都会
    // 立即应用最新的 muted 值。
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = muted;
    }, [muted]);

    // Track play state for the centred play-glyph overlay.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        return () => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
        };
    }, []);

    const togglePlayPause = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) void video.play().catch(() => {});
        else video.pause();
    };

    const triggerLike = () => {
        if (oBusyRef.current) return;
        oBusyRef.current = true;
        // Push this scene's tags into Explore's recency ring — likes
        // are the strongest cheap-to-emit signal of taste.
        recordTagInteractions(item.tags);
        const prev = oCount;
        setOCount(prev + 1);
        setLiked(true);
        sceneIncrementO(item.sceneId)
            .then((next) => setOCount(next))
            .catch(() => {
                setOCount(prev);
                setLiked(prev > 0);
            })
            .finally(() => {
                oBusyRef.current = false;
            });
    };

    // Single-vs-double tap discriminator. First tap arms a 250ms timer;
    // a second tap inside the window cancels the timer and triggers a
    // like. If the timer fires, it toggles play/pause.
    const tapTimerRef = useRef<number | null>(null);
    useEffect(() => {
        return () => {
            if (tapTimerRef.current !== null)
                window.clearTimeout(tapTimerRef.current);
        };
    }, []);
    const handleTap = () => {
        if (tapTimerRef.current !== null) {
            window.clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
            triggerLike();
            return;
        }
        tapTimerRef.current = window.setTimeout(() => {
            tapTimerRef.current = null;
            togglePlayPause();
        }, 250);
    };

    const handleWatchFullScene = () => {
        // 硬约束：使用 chained 模式（而非 pinnedQueue）。以当前场景为
        // 种子进入 reel，chainAlgo 基于该场景的演员/标签生成后续推荐，
        // 避免 pinnedQueue 的 scrollTo() 被虚拟列表逻辑覆盖。
        // 清空筛选以防 chained 模式的 filter-takeover 把用户弹回 random。
        //
        // Bug 5 修复：setTab 会清除 pin/queue 并重置 reelMode=random，
        // 因此必须在 setTab 之后再设置 pin 和 reelMode=chained，利用
        // React 18 批处理"后写胜"语义保证最终状态正确。
        replace({ performers: [], tags: [], studios: [] });
        setTab("foryou");
        setPinFirstSceneId(item.sceneId);
        setReelMode("chained");
    };

    return (
        <article className="binge-feed-card" ref={containerRef}>
            <header className="binge-feed-card-header">
                <div className="binge-feed-card-author">
                    <AvatarStack
                        performers={item.performers}
                        isRepost={item.isRepost}
                        onClick={(id) => openProfile(id)}
                        onOpenStory={(performerId) => {
                            // Tap on an avatar whose performer
                            // has a current story → drop straight
                            // into their story instead of the
                            // profile. Matches the iOS post-card
                            // story-tap path.
                            if (storiesState.state.kind !== "ready") {
                                openProfile(performerId);
                                return;
                            }
                            const list = storiesState.state.stories;
                            const idx = list.findIndex(
                                (s) => s.performerId === performerId
                            );
                            if (idx >= 0) {
                                openStoryViewer(list, idx);
                            } else {
                                openProfile(performerId);
                            }
                        }}
                        storyPerformerIds={storyPerformerIds}
                    />
                    {primaryPerformer ? (
                        <PerformerHoverCard
                            name={primaryPerformer.name}
                            image={primaryPerformer.imagePath}
                            gender={null}
                            birthDate={null}
                            inLibrary
                            favorite={primaryPerformer.favorite}
                            onOpenProfile={() =>
                                openProfile(primaryPerformer.id)
                            }
                        >
                            <button
                                type="button"
                                className="binge-feed-card-name-btn"
                                onClick={(e) => {
                                    // Don't let the outer hover-card
                                    // wrapper also receive the click
                                    // (it would toggle the popover
                                    // open while we're navigating
                                    // away to the profile).
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
                                                    (p.favorite
                                                        ? " is-favorite"
                                                        : "")
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
                        <span className="binge-feed-card-name">
                            {t("performer.unknown")}
                        </span>
                    )}
                </div>
                <span className="binge-feed-card-time">
                    {timeAgo(item.effectiveAt)}
                </span>
                <SceneCardMenu
                    items={[
                        {
                            label: t("action.open_in_stash"),
                            sub: t("action.open_in_stash_details"),
                            onClick: () =>
                                window.open(
                                    `/scenes/${item.sceneId}`,
                                    "_blank",
                                    "noopener,noreferrer"
                                ),
                        },
                    ]}
                />
            </header>

            <div
                className={
                    "binge-feed-card-media" +
                    (isPortrait ? " is-portrait" : " is-landscape")
                }
            >
                <video
                    ref={videoRef}
                    className={
                        "binge-feed-card-video" +
                        (isPortrait ? " is-portrait" : "")
                    }
                    src={readDemoMode() ? undefined : item.preview ?? undefined}
                    poster={item.screenshot ?? undefined}
                    playsInline
                    loop
                    muted={muted}
                />
                <button
                    type="button"
                    className="binge-feed-card-tap"
                    onClick={handleTap}
                    aria-label={isPlaying ? t("action.pause") : t("action.play")}
                    tabIndex={-1}
                />
                {!isPlaying && (
                    <div
                        className="binge-feed-card-play-glyph"
                        aria-hidden="true"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                        >
                            <path d="M9 7L18 12L9 17Z" />
                        </svg>
                    </div>
                )}
                <button
                    type="button"
                    className="binge-feed-card-mute"
                    onClick={(e) => {
                        e.stopPropagation();
                        setMuted(!muted);
                    }}
                    aria-label={muted ? t("action.unmute") : t("action.mute")}
                    title={muted ? t("action.unmute") : t("action.mute")}
                >
                    {muted ? <MutedIcon /> : <UnmutedIcon />}
                </button>
            </div>

            <div className="binge-feed-card-actions">
                <button
                    type="button"
                    className={
                        "binge-feed-card-like" +
                        (liked || oCount > 0 ? " is-liked" : "")
                    }
                    onClick={triggerLike}
                    aria-label={t("action.like")}
                    title={t("action.like")}
                >
                    <HeartIcon filled={liked || oCount > 0} />
                    {oCount > 0 && (
                        <span className="binge-feed-card-like-count">
                            {oCount}
                        </span>
                    )}
                </button>
                {hasAdvancedRating && (
                    <button
                        type="button"
                        className="binge-feed-card-iconbtn"
                        onClick={() => setRatingOpen(true)}
                        aria-label={t("action.rate")}
                        title={t("action.rate_advanced")}
                    >
                        <StarIcon filled={false} />
                    </button>
                )}
                {hasMultiview && (
                    <button
                        type="button"
                        className={
                            "binge-feed-card-iconbtn" +
                            (inMVQueue ? " is-active" : "")
                        }
                        onClick={handleToggleMV}
                        aria-label={
                            inMVQueue
                                ? t("action.remove_from_multiview")
                                : t("action.add_to_multiview")
                        }
                        title={t("action.send_to_multiview")}
                    >
                        <GridIcon filled={inMVQueue} />
                    </button>
                )}
                {hasScribe && (
                    <button
                        type="button"
                        className="binge-feed-card-iconbtn"
                        onClick={handleOpenScribe}
                        aria-label={t("action.write_scribe_review")}
                        title={t("action.write_review")}
                    >
                        <PencilIcon />
                    </button>
                )}
                <button
                    type="button"
                    className={
                        "binge-feed-card-iconbtn" +
                        (savedSomewhere ? " is-active" : "")
                    }
                    onClick={() => setSaveSheetOpen(true)}
                    aria-label={t("action.save")}
                    title={t("action.save")}
                >
                    <BookmarkIcon filled={savedSomewhere} />
                </button>
                <button
                    type="button"
                    className="binge-feed-card-cta"
                    onClick={handleWatchFullScene}
                >
                    {t("action.watch_full_scene")}
                </button>
            </div>

            {ratingOpen && (
                <CriterionRatingModal
                    target={{ kind: "scene", id: item.sceneId }}
                    onClose={() => setRatingOpen(false)}
                />
            )}
            {saveSheetOpen && (
                <SaveSheet
                    inCollections={inCollections}
                    onToggle={handleToggleCollection}
                    onClose={() => setSaveSheetOpen(false)}
                />
            )}

            {(item.title || item.details) && (
                <FeedCaption title={item.title} details={item.details} />
            )}

            {item.tags.length > 0 && (
                <HashtagRow
                    tags={item.tags}
                    onTap={(tag) => {
                        // Hashtag taps are deterministic filter-driven —
                        // not chained. Defensively reset reelMode.
                        setReelMode("random");
                        replace({
                            performers: [],
                            tags: [{ id: tag.id, name: tag.name }],
                            studios: [],
                        });
                        setTab("foryou");
                    }}
                />
            )}
        </article>
    );
}

// IG-style caption: bold title acts as the lead-in, with an inline
// "…more" button when the scene has a `details` field. Tapping more
// expands the details paragraph below; tapping "less" collapses.
function FeedCaption({
    title,
    details,
}: {
    title: string | null;
    details: string | null;
}) {
    const [expanded, setExpanded] = useState(false);
    const { t } = useTranslation();
    const trimmedDetails = details?.trim() || "";
    const hasDetails = trimmedDetails.length > 0;
    return (
        <div className="binge-feed-card-caption">
            <div className="binge-feed-card-caption-line">
                {title && (
                    <span className="binge-feed-card-title">{title}</span>
                )}
                {hasDetails && !expanded && (
                    <>
                        {title && (
                            <span className="binge-feed-card-caption-dim">
                                {" "}
                                …{" "}
                            </span>
                        )}
                        <button
                            type="button"
                            className="binge-feed-card-more-btn"
                            onClick={() => setExpanded(true)}
                        >
                            {t("action.more")}
                        </button>
                    </>
                )}
            </div>
            {hasDetails && expanded && (
                <div className="binge-feed-card-details">
                    {trimmedDetails}{" "}
                    <button
                        type="button"
                        className="binge-feed-card-more-btn"
                        onClick={() => setExpanded(false)}
                    >
                        {t("action.collapse")}
                    </button>
                </div>
            )}
        </div>
    );
}

// Stacked-circle avatar row. Each avatar gets wrapped in a
// PerformerHoverCard so hovering it shows the same IG-style mini
// profile that DiscoveryFeedCard's co-stars expose. Library
// performers naturally show "In library" + "Open profile" inside
// the card. Click on the avatar still routes straight to the
// profile (we stopPropagation so the card-toggle handler at the
// wrapper level doesn't also fire).
function AvatarStack({
    performers,
    onClick,
    onOpenStory,
    storyPerformerIds,
    isRepost = false,
}: {
    performers: FeedPerformer[];
    onClick: (performerId: string) => void;
    /// Tap routed here when this performer has a current story.
    /// Caller looks the story up and opens the viewer; if no
    /// matching story is found, expected to fall back to onClick.
    onOpenStory?: (performerId: string) => void;
    /// localIds with an active story right now — drives the
    /// gradient ring + the alternate tap route.
    storyPerformerIds?: ReadonlySet<string>;
    /// When true, the PRIMARY (first) avatar gets the repost badge —
    /// matching the pack card's avatar treatment for back-catalog
    /// re-adds.
    isRepost?: boolean;
}) {
    const { t } = useTranslation();
    if (performers.length === 0) return null;
    const visible = performers.slice(0, 3);
    const overflow = performers.length - visible.length;
    return (
        <div className="binge-feed-card-avatar-stack">
            {visible.map((p, i) => {
                const hasStory =
                    !!storyPerformerIds?.has(p.id) && !!onOpenStory;
                const handleTap = hasStory
                    ? () => onOpenStory!(p.id)
                    : () => onClick(p.id);
                const avatarNode = (
                    <span
                        className="binge-feed-card-stack-avatar"
                        style={{
                            zIndex: visible.length - i,
                            position: "relative",
                            ...(p.imagePath
                                ? {
                                      backgroundImage: `url(${p.imagePath})`,
                                  }
                                : {}),
                        }}
                        title={p.name}
                        aria-label={p.name}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleTap();
                        }}
                        role="button"
                        tabIndex={0}
                    >
                        {!p.imagePath && (
                            <span className="binge-feed-card-stack-initial">
                                {p.name.charAt(0).toUpperCase()}
                            </span>
                        )}
                    </span>
                );
                const ringedNode = hasStory ? (
                    <span
                        className="binge-feed-card-stack-story-ring"
                        style={{ zIndex: visible.length - i }}
                    >
                        {avatarNode}
                    </span>
                ) : (
                    avatarNode
                );
                // Repost badge sits only on the primary (first)
                // avatar. Wrapped so the badge escapes the avatar's
                // overflow:hidden clip.
                const node =
                    isRepost && i === 0 ? (
                        <span
                            className="binge-feed-card-stack-avatar-wrap"
                            style={{ zIndex: visible.length - i }}
                        >
                            {ringedNode}
                            <span
                                className="binge-feed-card-stack-repost-badge"
                                aria-label={t("status.reposted")}
                                title={t("status.reposted_details")}
                            >
                                <RepostIcon />
                            </span>
                        </span>
                    ) : (
                        ringedNode
                    );
                return (
                    <PerformerHoverCard
                        key={p.id}
                        name={p.name}
                        image={p.imagePath}
                        gender={null}
                        birthDate={null}
                        inLibrary
                        favorite={p.favorite}
                        onOpenProfile={() => onClick(p.id)}
                    >
                        {node}
                    </PerformerHoverCard>
                );
            })}
            {overflow > 0 && (
                <span
                    className="binge-feed-card-stack-avatar binge-feed-card-stack-overflow"
                    aria-hidden="true"
                >
                    +{overflow}
                </span>
            )}
        </div>
    );
}

// IG-style hashtag row. Shows first 7 tags; "+N more" expands the rest
// inline. Each tag tap filters the For You reel to that tag.
function HashtagRow({
    tags,
    onTap,
}: {
    tags: FeedTag[];
    onTap: (tag: FeedTag) => void;
}) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const INITIAL = 7;
    const shown = expanded ? tags : tags.slice(0, INITIAL);
    const hidden = tags.length - shown.length;
    return (
        <div className="binge-feed-card-hashtags">
            {shown.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    className="binge-feed-card-hashtag"
                    onClick={() => onTap(t)}
                >
                    #{t.name}
                </button>
            ))}
            {hidden > 0 && (
                <button
                    type="button"
                    className="binge-feed-card-hashtag-more"
                    onClick={() => setExpanded(true)}
                    aria-label={t("action.show_more_tags", { count: hidden })}
                >
                    +{hidden}
                </button>
            )}
            {expanded && tags.length > INITIAL && (
                <button
                    type="button"
                    className="binge-feed-card-hashtag-more"
                    onClick={() => setExpanded(false)}
                    aria-label={t("action.show_fewer_tags")}
                >
                    {t("action.collapse")}
                </button>
            )}
        </div>
    );
}

function HeartIcon({ filled }: { filled: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="1.4em"
            height="1.4em"
            fill={filled ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={filled ? 1 : 1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
    );
}

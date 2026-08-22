import { useEffect, useMemo, useRef, useState } from "react";
import { SceneCardMenu } from "./SceneCardMenu";
import { PerformerHoverCard } from "./PerformerHoverCard";
import { Fragment } from "react";
import type { FeedPerformer, FeedTag, SceneFeedItem } from "./useFeed";
import type { MatchedScenePerformer } from "../api/stashdb";
import { VerifiedIcon } from "../performer/PerformerProfile";
import { useSharedStories } from "./StoriesContext";
import { useStoryViewer } from "./StoryViewerContext";
import { useFilter } from "../filter/FilterContext";
import { useTab } from "../tabs/TabContext";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { useMuteState } from "../hooks/useMuteState";
import { sceneIncrementO } from "../api/mutations";
import { currentOCount, rememberOCount } from "./oCounterStore";
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

// How many performers are named before the row switches to a count.
// The verified marks beside each name do not shrink, so a long cast
// squeezed the names away and left a row of bare ticks.
const NAME_LIMIT = 2;

// "Alice, Bree +12". Kept as a plain string because the matched-name
// branch has no per-name markup to interleave.
function nameList(names: string[]): string {
    const shown = names.slice(0, NAME_LIMIT).join(", ");
    const rest = names.length - NAME_LIMIT;
    return rest > 0 ? `${shown} +${rest}` : shown;
}

interface SceneFeedCardProps {
    item: SceneFeedItem;
    /// Date-sorted list of every scene id in the home feed.
    /// "Watch full scene" now drops the user into the reel
    /// pre-populated with this list, starting at this card's
    /// scene — they walk through the home timeline rather than
    /// landing in a filter-scoped reel.
    feedSceneIds: string[];
}

// Scene-as-post IG-style card. Preview WebM auto-plays muted when ≥60%
// in view (IntersectionObserver, same threshold the Reel uses). Click
// the media to toggle play/pause; double-click to like; tap the header
// avatar/name to open that performer's profile.
//
// The CTA "Watch full scene →" drops into the reel with the WHOLE
// home feed pre-loaded as a deterministic queue (no filter, no
// chained algo) — the user keeps walking the home timeline,
// starting at the tapped scene. Same UX as the iOS port.
export function SceneFeedCard({ item, feedSceneIds }: SceneFeedCardProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    // All three. The second writes the user's stated preference; the
    // third is session-only, for when the BROWSER mutes us rather than
    // the user. The fallback below used neither, silencing the element
    // imperatively without telling React - so the button rendered
    // "Mute" (claiming sound) over a video the browser had already
    // muted, and tapping it wrote a preference instead of unmuting.
    const [muted, setMuted, setMutedSession] = useMuteState();
    // The observer's callback is created once and would otherwise close
    // over the first render's `muted` forever.
    const mutedRef = useRef(muted);
    useEffect(() => {
        mutedRef.current = muted;
    }, [muted]);
    // Seeded from the scene, not from zero. The virtualizer unmounts a
    // card that scrolls a few rows away, so a local-only count was lost
    // on every pass - the heart came back empty and a second tap
    // incremented the scene again.
    const [oCount, setOCount] = useState(() =>
        currentOCount(item.sceneId, item.oCounter),
    );
    const [liked, setLiked] = useState(false);
    const oBusyRef = useRef(false);

    const { replace } = useFilter();
    const { setTab, setPinFirstSceneId, setReelMode, setPinnedQueue } =
        useTab();
    const { openProfile, openStashDBProfile } = usePerformerProfile();
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
                ? new Set(storiesState.state.stories.map((s) => s.performerId))
                : new Set(),
        [storiesState.state],
    );

    const hasAdvancedRating = useHasAdvancedRating();
    const hasMultiview = useHasMultiview();
    const hasScribe = useHasScribe();

    const [ratingOpen, setRatingOpen] = useState(false);
    const [saveSheetOpen, setSaveSheetOpen] = useState(false);
    const [inMVQueue, setInMVQueue] = useState(false);
    const [inCollections, setInCollections] = useState<Record<string, boolean>>(
        {},
    );

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
                    // false: displaying membership must not
                    // write tags into the user's library.
                    getCollectionTagIds(false),
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
    // A queue, not a gate. See handleToggleCollection.
    const collectionChainRef = useRef<Promise<void>>(Promise.resolve());
    const handleToggleCollection = async (tagName: string) => {
        // The reel has always serialised these; this one did not, so
        // two quick taps could put two whole-array tag writes in flight
        // against the same scene at once.
        // Keyed on the scene, not the collection. Two different
        // collections of one scene each passed their own key, so both
        // read the same tag list and the second write replaced the
        // first: the membership that lost the race was dropped
        // silently while both rows showed a tick. sceneUpdate replaces
        // the whole array, so writes to one scene have to be one at a
        // time.
        //
        // Queued rather than dropped. The guard used to return, so the
        // losing tap was thrown away with no tick, no spinner and no
        // error - tapping Favourites then Watch Later quickly wrote only
        // the first, and the second row stayed unchecked, which is
        // indistinguishable from a dead button.
        const next = !inCollections[tagName];
        // Optimistic immediately, so the tap is acknowledged even while
        // an earlier write is still in flight.
        setInCollections((m) => ({ ...m, [tagName]: next }));
        // Same intent signal as the reel: saving = strong taste data.
        if (next) recordTagInteractions(item.tags);
        const run = async (): Promise<void> => {
            try {
                const { inCollection } = await setSceneInCollection(
                    item.sceneId,
                    tagName,
                    next,
                );
                setInCollections((m) => ({ ...m, [tagName]: inCollection }));
            } catch {
                // Revert on error.
                setInCollections((m) => ({ ...m, [tagName]: !next }));
            }
        };
        // Chained on both settle paths, so one failure does not stall
        // every later toggle on this card.
        collectionChainRef.current = collectionChainRef.current.then(run, run);
        await collectionChainRef.current;
    };

    const isPortrait =
        item.width !== null && item.height !== null && item.height > item.width;
    const primaryPerformer = item.performers[0];

    // Auto-play when scrolled into view. Mirrors SceneSlide's IO logic
    // but drops the muted-fallback dance — feed previews are always
    // muted by default, the user has to click the card to unmute.
    useEffect(() => {
        const container = containerRef.current;
        const video = videoRef.current;
        if (!container || !video) return;
        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const active = entry.intersectionRatio >= 0.6;
                    if (active) {
                        video.muted = mutedRef.current;
                        void video.play().catch((err: unknown) => {
                            // An interrupted play() says nothing about
                            // autoplay policy.
                            if (
                                err instanceof Error &&
                                err.name === "AbortError"
                            ) {
                                return;
                            }
                            // Retry muted, and say so, or the button
                            // keeps claiming sound the user does not
                            // have.
                            video.muted = true;
                            setMutedSession(true);
                            void video.play().catch(() => {});
                        });
                    } else {
                        video.pause();
                    }
                }
            },
            { threshold: [0, 0.6, 1] },
        );
        observer.observe(container);
        return () => observer.disconnect();
        // muted intentionally not a dep, so the observer is not torn
        // down on every mute toggle. It reads mutedRef instead: a
        // closure over a useState value is frozen at the render that
        // created it, so this callback used to re-apply the FIRST
        // render's value on every scroll-in - unmute a card, scroll it
        // out and back, and it silently re-muted while the button still
        // read "Mute".
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            .then((next) => {
                setOCount(next);
                // Server-confirmed, so it survives this card being
                // unmounted by the virtualizer and remounted later.
                rememberOCount(item.sceneId, next);
            })
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
        // Home → reel timeline jump. Hands the reel the home
        // feed's ordered scene id list + the index of this
        // card's scene; the reel's pinnedQueue path renders them
        // verbatim, in order, no pagination. User walks the
        // timeline forward/back from where they tapped.
        //
        // Previously this was filter-scoped (replace filter to
        // primary performer + pin first scene). That dropped the
        // user out of the date-ordered timeline and into a
        // random feed of one performer's scenes — surprising on
        // a date-ordered home page. Same change shipped on iOS.
        setReelMode("random");
        // Clear any stale chained-mode filter so the reel reads
        // the pinned queue cleanly.
        replace({ performers: [], tags: [], studios: [] });
        const startIndex = Math.max(0, feedSceneIds.indexOf(item.sceneId));
        setPinFirstSceneId(null);
        setPinnedQueue({ ids: feedSceneIds, startIndex });
        setTab("foryou");
    };

    return (
        <article className="binge-feed-card" ref={containerRef}>
            <header className="binge-feed-card-header">
                <div className="binge-feed-card-author">
                    {item.performers.length === 0 &&
                    item.matchedPerformers.length > 0 ? (
                        // Nobody linked locally, so the stack above has
                        // nothing to draw and the card named its cast
                        // against an empty space. StashDB knows these
                        // people and hosts their images, so they get
                        // faces from there instead.
                        <MatchedAvatarStack
                            performers={item.matchedPerformers}
                            onClick={(stashId) => openStashDBProfile(stashId)}
                        />
                    ) : null}
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
                                (s) => s.performerId === performerId,
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
                                    {item.performers
                                        .slice(0, NAME_LIMIT)
                                        .map((p, idx) => (
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
                                                            ? "Favourited"
                                                            : "In library"
                                                    }
                                                    title={
                                                        p.favorite
                                                            ? "Favourited"
                                                            : "In library"
                                                    }
                                                >
                                                    <VerifiedIcon />
                                                </span>
                                            </Fragment>
                                        ))}
                                    {item.performers.length > NAME_LIMIT && (
                                        <span className="binge-feed-card-name-overflow">
                                            {" +"}
                                            {item.performers.length -
                                                NAME_LIMIT}
                                        </span>
                                    )}
                                </span>
                            </button>
                        </PerformerHoverCard>
                    ) : (
                        // Nobody linked locally. The scene only reached
                        // the feed at all because it has a StashDB
                        // match, so StashDB usually knows the cast:
                        // name them. The studio is the fallback for a
                        // match StashDB lists no performers for.
                        //
                        // No marker beside the names. There used to be
                        // one, explained only by a hover tooltip, which
                        // meant it explained nothing on a touch screen
                        // and read as an error state. The distinction
                        // survives without it: a performer in the
                        // library carries a verified mark and these do
                        // not, so the absence is the signal.
                        <span className="binge-feed-card-name">
                            {item.matchedPerformers.length > 0
                                ? nameList(
                                      item.matchedPerformers.map((p) => p.name),
                                  )
                                : (item.impliedSource ?? "Unidentified")}
                        </span>
                    )}
                </div>
                <span className="binge-feed-card-time">
                    {timeAgo(item.effectiveAt)}
                </span>
                <SceneCardMenu
                    items={[
                        {
                            label: "Open in Stash",
                            sub: "Opens the scene in your Stash UI",
                            onClick: () =>
                                window.open(
                                    `/scenes/${item.sceneId}`,
                                    "_blank",
                                    "noopener,noreferrer",
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
                    src={item.preview ?? undefined}
                    poster={item.screenshot ?? undefined}
                    playsInline
                    loop
                    muted={muted}
                />
                <button
                    type="button"
                    className="binge-feed-card-tap"
                    onClick={handleTap}
                    aria-label={isPlaying ? "Pause" : "Play"}
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
                    aria-label={muted ? "Unmute" : "Mute"}
                    title={muted ? "Unmute" : "Mute"}
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
                    aria-label="Like"
                    title="Like"
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
                        aria-label="Rate"
                        title="Rate (advanced)"
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
                                ? "Remove from Multiview"
                                : "Add to Multiview"
                        }
                        title="Send to Multiview"
                    >
                        <GridIcon filled={inMVQueue} />
                    </button>
                )}
                {hasScribe && (
                    <button
                        type="button"
                        className="binge-feed-card-iconbtn"
                        onClick={handleOpenScribe}
                        aria-label="Write review with Scribe"
                        title="Write review"
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
                    aria-label="Save"
                    title="Save"
                >
                    <BookmarkIcon filled={savedSomewhere} />
                </button>
                <button
                    type="button"
                    className="binge-feed-card-cta"
                    onClick={handleWatchFullScene}
                >
                    Watch full scene →
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
                            more
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
                        less
                    </button>
                </div>
            )}
        </div>
    );
}

// The same stacked row for performers StashDB named on a scene
// nobody is linked to locally. Shares the avatar-stack styling so
// the two are indistinguishable in layout, and differs only where
// the data does: no story ring (a story belongs to someone in the
// library), no repost badge, and the hover card says not-in-library.
// Clicking opens the StashDB profile, since there is no local one.
function MatchedAvatarStack({
    performers,
    onClick,
}: {
    performers: MatchedScenePerformer[];
    onClick: (stashId: string) => void;
}) {
    if (performers.length === 0) return null;
    const visible = performers.slice(0, 3);
    const overflow = performers.length - visible.length;
    return (
        <div className="binge-feed-card-avatar-stack">
            {visible.map((p, i) => (
                <PerformerHoverCard
                    key={p.stashId}
                    name={p.name}
                    image={p.image}
                    gender={p.gender}
                    birthDate={null}
                    inLibrary={false}
                    favorite={false}
                    onOpenProfile={() => onClick(p.stashId)}
                >
                    <span
                        className="binge-feed-card-stack-avatar"
                        style={{
                            zIndex: visible.length - i,
                            position: "relative",
                            ...(p.image
                                ? { backgroundImage: `url(${p.image})` }
                                : {}),
                        }}
                        title={p.name}
                        aria-label={p.name}
                        onClick={(e) => {
                            e.stopPropagation();
                            onClick(p.stashId);
                        }}
                        role="button"
                        tabIndex={0}
                    >
                        {!p.image && (
                            <span className="binge-feed-card-stack-initial">
                                {p.name.charAt(0).toUpperCase()}
                            </span>
                        )}
                    </span>
                </PerformerHoverCard>
            ))}
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
                                aria-label="Reposted"
                                title="Reposted — back-catalog you re-added"
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
                    aria-label={`Show ${hidden} more tag${
                        hidden === 1 ? "" : "s"
                    }`}
                >
                    +{hidden} more
                </button>
            )}
            {expanded && tags.length > INITIAL && (
                <button
                    type="button"
                    className="binge-feed-card-hashtag-more"
                    onClick={() => setExpanded(false)}
                    aria-label="Show fewer tags"
                >
                    less
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

import { useState } from "react";
import type { FeedPerformer, PackFeedItem } from "./useFeed";
import { VerifiedIcon } from "../performer/PerformerProfile";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { PerformerHoverCard } from "./PerformerHoverCard";
import { useSharedStories } from "./StoriesContext";
import { useStoryViewer } from "./StoryViewerContext";
import { timeAgo } from "./timeAgo";
import { PackDetailSheet } from "./PackDetailSheet";
import { RepostIcon } from "../components/ActionStack";
import { UnidentifiedIcon } from "./UnidentifiedIcon";

// Number of cover tiles rendered in the 3×3 mosaic. The pack may
// hold dozens or hundreds of scenes; the tile grid surfaces only
// the first 9 (newest-first) and the "+N more" badge counts the
// remainder so the card stays compact.
const MOSAIC_TILES = 9;

// Bulk-import card. Renders as a single feed entry when binge
// detects many scenes from the same performer added in one batch
// (e.g. a 221-scene OnlyFans pack). The cover is a 3×3 mosaic of
// the newest screenshots with a "+N" overlay; tap any tile to
// open the pack sheet listing every scene.
//
// Header chrome matches SceneFeedCard so the cards read as
// siblings: avatar with story ring (when the performer has fresh
// activity) + hover card + relative time.
export function PackFeedCard({ item }: { item: PackFeedItem }) {
    const [sheetOpen, setSheetOpen] = useState(false);
    const primary = item.primaryPerformer;
    // An unattributed batch has no profile to open, no story ring and
    // nobody to hover, so it takes a separate header rather than
    // threading null checks through the one below.
    if (!primary) {
        return (
            <UnattributedPackCard
                item={item}
                sheetOpen={sheetOpen}
                setSheetOpen={setSheetOpen}
            />
        );
    }
    return (
        <AttributedPackCard
            item={item}
            primary={primary}
            sheetOpen={sheetOpen}
            setSheetOpen={setSheetOpen}
        />
    );
}

interface PackCardProps {
    item: PackFeedItem;
    sheetOpen: boolean;
    setSheetOpen: (open: boolean) => void;
}

function AttributedPackCard({
    item,
    primary,
    sheetOpen,
    setSheetOpen,
}: PackCardProps & { primary: FeedPerformer }) {
    const { openProfile } = usePerformerProfile();
    const { open: openStoryViewer } = useStoryViewer();
    const storiesState = useSharedStories();

    const hasStory =
        storiesState.state.kind === "ready" &&
        storiesState.state.stories.some((s) => s.performerId === primary.id);

    const handleAvatarTap = () => {
        if (hasStory && storiesState.state.kind === "ready") {
            const list = storiesState.state.stories;
            const idx = list.findIndex((s) => s.performerId === primary.id);
            if (idx >= 0) {
                openStoryViewer(list, idx);
                return;
            }
        }
        openProfile(primary.id);
    };

    const avatarButton = (
        <button
            type="button"
            className="binge-pack-card-avatar"
            onClick={(e) => {
                e.stopPropagation();
                handleAvatarTap();
            }}
            aria-label={primary.name}
            style={
                primary.imagePath
                    ? { backgroundImage: `url(${primary.imagePath})` }
                    : undefined
            }
        >
            {!primary.imagePath && (
                <span className="binge-pack-card-avatar-initial">
                    {primary.name.charAt(0).toUpperCase()}
                </span>
            )}
        </button>
    );

    return (
        <>
            <article className="binge-feed-card binge-pack-card">
                <header className="binge-feed-card-header">
                    <div className="binge-feed-card-author">
                        <PerformerHoverCard
                            name={primary.name}
                            image={primary.imagePath}
                            gender={null}
                            birthDate={null}
                            inLibrary
                            favorite={primary.favorite}
                            onOpenProfile={() => openProfile(primary.id)}
                        >
                            <span className="binge-pack-card-avatar-wrap">
                                {hasStory ? (
                                    <span className="binge-feed-card-stack-story-ring binge-pack-card-avatar-ring">
                                        {avatarButton}
                                    </span>
                                ) : (
                                    avatarButton
                                )}
                                {item.isRepost && (
                                    <span
                                        className="binge-pack-card-repost-badge"
                                        aria-label="Reposted"
                                    >
                                        <RepostIcon />
                                    </span>
                                )}
                            </span>
                        </PerformerHoverCard>
                        <PerformerHoverCard
                            name={primary.name}
                            image={primary.imagePath}
                            gender={null}
                            birthDate={null}
                            inLibrary
                            favorite={primary.favorite}
                            onOpenProfile={() => openProfile(primary.id)}
                        >
                            <button
                                type="button"
                                className="binge-feed-card-name-btn"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openProfile(primary.id);
                                }}
                                aria-label={primary.name}
                            >
                                <span className="binge-feed-card-name">
                                    {primary.name}
                                    <span
                                        className={
                                            "binge-feed-card-verified" +
                                            (primary.favorite
                                                ? " is-favorite"
                                                : "")
                                        }
                                        aria-label={
                                            primary.favorite
                                                ? "Favourited"
                                                : "In library"
                                        }
                                    >
                                        <VerifiedIcon />
                                    </span>
                                </span>
                                <span className="binge-pack-card-sub">
                                    {item.isRepost
                                        ? `reposted ${item.sceneCount} scenes`
                                        : `added ${item.sceneCount} new scenes`}
                                </span>
                            </button>
                        </PerformerHoverCard>
                    </div>
                    <span className="binge-feed-card-time">
                        {timeAgo(item.effectiveAt)}
                    </span>
                </header>
                <PackMosaic item={item} onOpen={() => setSheetOpen(true)} />
            </article>
            {sheetOpen && (
                <PackDetailSheet
                    pack={item}
                    onClose={() => setSheetOpen(false)}
                />
            )}
        </>
    );
}

// A batch with nobody linked in Stash. It is grouped and titled by where
// it came from — the studio when there is one, otherwise the folder it
// was imported into — which is a guess about the file layout, not a
// claim about who is in it. So: no story ring, no hover card, no profile
// link, and an "unidentified" mark in place of the in-library tick.
// Tapping anywhere opens the same sheet, which is where the scenes are.
function UnattributedPackCard({
    item,
    sheetOpen,
    setSheetOpen,
}: PackCardProps) {
    const cover = item.scenes.find((s) => s.screenshot)?.screenshot ?? null;
    return (
        <>
            <article className="binge-feed-card binge-pack-card">
                <header className="binge-feed-card-header">
                    <div className="binge-feed-card-author">
                        <span className="binge-pack-card-avatar-wrap">
                            <button
                                type="button"
                                className="binge-pack-card-avatar binge-pack-card-avatar-unattributed"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSheetOpen(true);
                                }}
                                aria-label={`${item.label} — open batch`}
                                style={
                                    cover
                                        ? { backgroundImage: `url(${cover})` }
                                        : undefined
                                }
                            >
                                {!cover && (
                                    <span className="binge-pack-card-avatar-initial">
                                        {item.label.charAt(0).toUpperCase()}
                                    </span>
                                )}
                            </button>
                            {item.isRepost && (
                                <span
                                    className="binge-pack-card-repost-badge"
                                    aria-label="Reposted"
                                >
                                    <RepostIcon />
                                </span>
                            )}
                        </span>
                        <button
                            type="button"
                            className="binge-feed-card-name-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                setSheetOpen(true);
                            }}
                            aria-label={`${item.label} — open batch`}
                        >
                            <span className="binge-feed-card-name">
                                {item.label}
                                <span
                                    className="binge-feed-card-verified is-unidentified"
                                    aria-label="No performer linked"
                                    title="No performer linked"
                                >
                                    <UnidentifiedIcon />
                                </span>
                            </span>
                            <span className="binge-pack-card-sub">
                                {item.isRepost
                                    ? `reposted ${item.sceneCount} scenes`
                                    : `added ${item.sceneCount} new scenes`}
                            </span>
                        </button>
                    </div>
                    <span className="binge-feed-card-time">
                        {timeAgo(item.effectiveAt)}
                    </span>
                </header>
                <PackMosaic item={item} onOpen={() => setSheetOpen(true)} />
            </article>
            {sheetOpen && (
                <PackDetailSheet
                    pack={item}
                    onClose={() => setSheetOpen(false)}
                />
            )}
        </>
    );
}

function PackMosaic({
    item,
    onOpen,
}: {
    item: PackFeedItem;
    onOpen: () => void;
}) {
    const tiles = item.scenes.slice(0, MOSAIC_TILES);
    const overflow = item.sceneCount - tiles.length;
    return (
        <div
            className="binge-pack-card-mosaic"
            role="button"
            tabIndex={0}
            aria-label={`Open pack — ${item.sceneCount} scenes`}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen();
                }
            }}
        >
            {tiles.map((s, i) => (
                <div
                    key={s.sceneId}
                    className="binge-pack-card-mosaic-tile"
                    style={
                        s.screenshot
                            ? { backgroundImage: `url(${s.screenshot})` }
                            : undefined
                    }
                >
                    {i === MOSAIC_TILES - 1 && overflow > 0 && (
                        <span className="binge-pack-card-mosaic-overflow">
                            +{overflow}
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FeedPerformer, PackFeedItem } from "./useFeed";
import { VerifiedIcon } from "../performer/PerformerProfile";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { PerformerHoverCard } from "./PerformerHoverCard";
import { useSharedStories } from "./StoriesContext";
import { useStoryViewer } from "./StoryViewerContext";
import { timeAgo } from "./timeAgo";
import { PackDetailSheet } from "./PackDetailSheet";
import { openPackAtScene } from "./packHandoff";
import { useTab } from "../tabs/TabContext";
import { RepostIcon } from "../components/ActionStack";
import { SceneCardMenu } from "./SceneCardMenu";

// Number of cover tiles rendered in the 4×2 mosaic. The pack may
// hold dozens or hundreds of scenes; the tile grid surfaces only
// the first 8 (newest-first) and the "+N more" badge counts the
// remainder so the card stays compact.
const MOSAIC_TILES = 8;

// Bulk-import card. Renders as a single feed entry when binge
// detects many scenes from the same performer added in one batch
// (e.g. a 221-scene OnlyFans pack). The cover is a 4×2 mosaic of
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
    const { t } = useTranslation();
    const tab = useTab();
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
                                        aria-label={t("status.reposted")}
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
                                                ? t("status.favorite")
                                                : t("status.in_library")
                                        }
                                    >
                                        <VerifiedIcon />
                                    </span>
                                </span>
                                <span className="binge-pack-card-sub">
                                    {item.isRepost
                                        ? t("status.reposted_count", { count: item.sceneCount })
                                        : t("status.added_count", { count: item.sceneCount })}
                                </span>
                            </button>
                        </PerformerHoverCard>
                    </div>
                    <span className="binge-feed-card-time">
                        {timeAgo(item.effectiveAt)}
                    </span>
                </header>
                <PackMosaic
                    item={item}
                    onOpen={() => setSheetOpen(true)}
                    onPickScene={(sceneId) => {
                        openPackAtScene(tab, item, sceneId);
                    }}
                />
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
    const { t } = useTranslation();
    const tab = useTab();
    // A StashDB match means there IS a face for this batch, it just is
    // not in the library. Prefer it over a scene still, and say "not in
    // your library" rather than "no performer linked", which would be
    // untrue: the performer is known, they are simply not added.
    const matched = item.matchedPerformer;
    const cover =
        matched?.image ??
        item.scenes.find((s) => s.screenshot)?.screenshot ??
        null;
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
                                aria-label={t("action.open_batch_aria", {
                                    name: item.label,
                                })}
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
                                    aria-label={t("status.reposted")}
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
                            // No aria-label: the button's own text is
                            // the name plus the scene count, which says
                            // more than a label would, and repeating the
                            // avatar's label here would announce the
                            // same control twice.
                        >
                            <span className="binge-feed-card-name">
                                {item.label}
                            </span>
                            <span className="binge-pack-card-sub">
                                {item.isRepost
                                    ? t("status.reposted_count", {
                                          count: item.sceneCount,
                                      })
                                    : t("status.added_count", {
                                          count: item.sceneCount,
                                      })}
                            </span>
                        </button>
                    </div>
                    <span className="binge-feed-card-time">
                        {timeAgo(item.effectiveAt)}
                    </span>
                    <SceneCardMenu
                        items={[
                            {
                                label: t("action.find_in_stash"),
                                // Attaching a performer is Stash's job,
                                // and its scene list can do the whole
                                // batch at once, which matters when the
                                // batch runs to hundreds of scenes.
                                sub: t("action.find_in_stash_sub"),
                                onClick: () =>
                                    window.open(
                                        `/scenes?q=${encodeURIComponent(item.label)}`,
                                        "_blank",
                                        "noopener,noreferrer",
                                    ),
                            },
                        ]}
                    />
                </header>
                <PackMosaic
                    item={item}
                    onOpen={() => setSheetOpen(true)}
                    onPickScene={(sceneId) => {
                        openPackAtScene(tab, item, sceneId);
                    }}
                />
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
    onPickScene,
}: {
    item: PackFeedItem;
    onOpen: () => void;
    onPickScene: (sceneId: string) => void;
}) {
    const { t } = useTranslation();
    const tiles = item.scenes.slice(0, MOSAIC_TILES);
    const overflow = item.sceneCount - tiles.length;
    return (
        // The tiles are the buttons, not the grid.
        //
        // One onClick sat on this container, so every tile opened the
        // sheet - tapping the fifth cover did not take you to the fifth
        // scene, and the mosaic's per-tile art was decoration rather
        // than a target. The iOS twin passes the tile actually tapped
        // and carries a comment saying it fixed exactly this, so the
        // two clients disagreed about what the same nine covers do.
        <div className="binge-pack-card-mosaic">
            {tiles.map((s, i) => {
                // Keyed on the LAST TILE, not on slot nine. The two
                // are the same while sceneCount equals scenes.length,
                // which useFeed currently guarantees - but this file
                // should not depend on an invariant enforced in
                // another one, and the iOS twin already keys it this
                // way.
                const isOverflow = i === tiles.length - 1 && overflow > 0;
                return (
                    <button
                        type="button"
                        key={s.sceneId}
                        className="binge-pack-card-mosaic-tile"
                        // The last tile stands for everything that did
                        // not fit, so it still opens the sheet.
                        aria-label={
                            isOverflow
                                ? t("action.open_pack_aria", {
                                      count: item.sceneCount,
                                  })
                                : t("action.play_scene_aria", {
                                      title: s.title ?? t("common.scene"),
                                  })
                        }
                        onClick={() =>
                            isOverflow ? onOpen() : onPickScene(s.sceneId)
                        }
                        style={
                            s.screenshot
                                ? { backgroundImage: `url(${s.screenshot})` }
                                : undefined
                        }
                    >
                        {isOverflow && (
                            <span className="binge-pack-card-mosaic-overflow">
                                +{overflow}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

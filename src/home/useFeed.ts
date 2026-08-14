import { useEffect, useState } from "react";
import {
    findImagesByGallery,
    type PerformerImageCard,
    type RecentSceneRow,
    type RecentGalleryRow,
} from "../api/queries";
import {
    getRecentScenes,
    getScenesByDate,
    getRecentGalleries,
    getGalleriesByDate,
} from "./recentScenesCache";
import {
    useShowGalleries,
    useLookbackDays,
    useIncludeStashDB,
    useLibraryFolderNames,
    useGalleryIgnoreFolders,
} from "./pluginSettings";
import {
    fetchDiscoveryFeedItems,
    type DiscoveryFeedItem,
} from "./discoveryFeed";
import { buildSourceResolver } from "./impliedSource";
import { buildGalleryNoiseMatcher } from "./galleryNoise";

// Performer summary inside a feed item. Multiple performers per item are
// kept so the card can show their names and route taps to the correct
// profile.
export interface FeedPerformer {
    id: string;
    name: string;
    imagePath: string | null;
    /// True when the performer is marked Favourite in Stash. The
    /// feed card uses this to swap the verified-mark colour next
    /// to the primary performer's name (pink = favourite, blue =
    /// in library but not favourited). Every feed performer is by
    /// definition in the library, so the badge always renders.
    favorite: boolean;
}

export interface FeedTag {
    id: string;
    name: string;
}

// One scene-as-post in the feed.
export interface SceneFeedItem {
    kind: "scene";
    key: string;
    sceneId: string;
    title: string | null;
    details: string | null;
    preview: string | null;
    screenshot: string | null;
    createdAt: string;
    date: string | null;
    effectiveAt: string;
    width: number | null;
    height: number | null;
    performers: FeedPerformer[];
    tags: FeedTag[];
    /// True when this is back-catalog you just re-added rather than
    /// genuinely new content — its scraped release date is older than
    /// your configured recent window, so it only reached the feed via
    /// the recent-`created_at` query. The card surfaces it by import
    /// time (not the old date) and shows a "reposted" mark.
    isRepost: boolean;
    /// For a scene with NO performers linked: what it appears to belong
    /// to, from its studio or the folder it was imported into. Used to
    /// group and label it, never written back to Stash. Null when the
    /// scene has performers, or when nothing could be derived.
    impliedSource: string | null;
}

// One gallery-as-post. `images` is the first MAX_GALLERY_IMAGES of the
// gallery; the carousel pads a "View gallery →" panel at the end so the
// user can jump into the full ImageLightbox.
export interface GalleryFeedItem {
    kind: "gallery";
    key: string;
    galleryId: string;
    title: string | null;
    coverPath: string | null;
    imageCount: number;
    images: PerformerImageCard[];
    createdAt: string;
    date: string | null;
    effectiveAt: string;
    performers: FeedPerformer[];
    // Folder/file paths — used for the temporary debug strip on the
    // gallery card (and for the in-app noise-pattern filter).
    paths: string[];
}

// StashDB discovery card — a scene featuring at least one performer
// the user hasn't added to their library, with a Follow CTA that
// creates that performer locally (scrape + create). Same `key` +
// `effectiveAt` shape as the other variants so the merged feed sort
// stays homogeneous.
export interface DiscoveryFeedItemWrapped extends DiscoveryFeedItem {
    kind: "discovery";
}

/// Bulk-import card — represents many scenes added to the same
/// performer within a short window (e.g. a 221-scene OnlyFans
/// pack imported in one go). Without this, every scene gets its
/// own card and dominates the feed; collapsing into one item
/// preserves the "this is new" signal without burying everything
/// else. Tap opens a sheet with the full scene list.
export interface PackFeedItem {
    kind: "pack";
    key: string;
    /// The performer the whole batch shares, or null when the batch is
    /// unattributed and was grouped by where it came from instead.
    primaryPerformer: FeedPerformer | null;
    /// What the card is titled with: the performer's name, or the
    /// implied source for an unattributed batch. Always non-empty, so
    /// the card never has to invent a heading.
    label: string;
    scenes: SceneFeedItem[];
    sceneCount: number;
    /// Newest createdAt in the batch — used for "added X ago"
    /// labels. ISO string.
    createdAt: string;
    /// Drives the merged feed sort. Set to the newest createdAt
    /// (import time), NOT the scraped release date, so a freshly
    /// imported batch of old-dated back-catalog still surfaces at
    /// the top of the feed.
    effectiveAt: string;
    /// True when this is back-catalog you just re-added rather than
    /// genuinely new content — i.e. even the newest scene's scraped
    /// release date falls outside your configured recent window. The
    /// card swaps its "added N new scenes" label for "reposted" and
    /// shows a repost glyph on the avatar.
    isRepost: boolean;
}

export type FeedItem =
    SceneFeedItem | GalleryFeedItem | DiscoveryFeedItemWrapped | PackFeedItem;

export type FeedState =
    | { kind: "loading" }
    | { kind: "ready"; items: FeedItem[] }
    | { kind: "error"; message: string };

// The feed shows a single FIXED window — the user's configured recent
// window (useLookbackDays, capped at 90 days). No infinite-scroll
// widening: "how far back" is the setting, and the whole window is
// fetched at once (the virtualizer only renders the cards on screen, so
// a long list is cheap to display). To see further back, raise the
// setting. Bulk imports from one performer collapse into a single pack
// card; everyone else's recent scenes all show (no per-performer cap).

// Galleries DO keep a fixed cap, because each gallery card triggers its
// own image round-trips — uncapped, a gallery-heavy window would fan out
// into hundreds of parallel fetches. Galleries past this don't surface.
const MAX_GALLERY_CARDS = 100;

/// Minimum cluster size to qualify as a "pack" (batch import).
/// 8 is large enough that two-or-three scenes added together
/// don't get treated as a pack.
const PACK_MIN_SIZE = 8;
/// All scenes in a pack must share createdAt values within this
/// window — captures the "imported in one go" signal. A full week
/// rather than a day: large imports (hundreds of files, hashing +
/// preview generation) and staggered scans of the same performer
/// can spread scene-record creation across several days; a tighter
/// window would fragment one logical import into several sub-packs
/// (or drop each below PACK_MIN_SIZE entirely).
const PACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// What a scene groups under, or null when it groups under nothing and
// can only appear as its own card. The prefixes keep the two namespaces
// apart, so a performer whose id is "12" cannot collide with a folder
// named "12".
function packGroupKey(s: SceneFeedItem): string | null {
    const performerId = s.performers[0]?.id;
    if (performerId) return `p:${performerId}`;
    return s.impliedSource ? `s:${s.impliedSource}` : null;
}

function assemblePacks(
    scenes: SceneFeedItem[],
    repostCutoff: string,
): FeedItem[] {
    // `repostCutoff` (YYYY-MM-DD) is computed by the caller from the
    // configured recent window — not the grown infinite-scroll window —
    // so a pack's repost status doesn't flip as the user scrolls. A
    // pack is a "repost" when even its newest scene's scraped release
    // date is older than that cutoff.

    // Group by primary performer, or, for scenes with nobody linked, by
    // where they came from. An unidentified bulk import is still a bulk
    // import: without this, 500 loose scenes from one pack folder would
    // each get a card and bury everything else on Home.
    const byPrimary = new Map<string, SceneFeedItem[]>();
    for (const s of scenes) {
        const key = packGroupKey(s);
        if (!key) continue;
        const list = byPrimary.get(key);
        if (list) list.push(s);
        else byPrimary.set(key, [s]);
    }

    // For each performer, look at how many of their scenes were
    // created within a tight window of their most recent one.
    // If that count exceeds PACK_MIN_SIZE → batch import.
    const packedKeys = new Set<string>();
    const out: FeedItem[] = [];
    for (const [groupKey, list] of byPrimary) {
        const sortedByCreated = [...list].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
        );
        const newest = new Date(sortedByCreated[0].createdAt).getTime();
        const inWindow = sortedByCreated.filter(
            (s) => newest - new Date(s.createdAt).getTime() <= PACK_WINDOW_MS,
        );
        if (inWindow.length < PACK_MIN_SIZE) continue;
        const newestScene = sortedByCreated[0];
        const primary = newestScene.performers[0] ?? null;
        // Grouped scenes share whichever of the two produced the key, so
        // reading it off the newest is safe.
        const label = primary?.name ?? newestScene.impliedSource;
        // Unreachable: a group only forms when one of these exists.
        if (!label) continue;
        // Newest scraped release date across the batch. If even that
        // is older than the recent-window cutoff, the whole pack is
        // back-catalog → "reposted". Scenes with no date don't count
        // as evidence either way.
        let newestDate: string | null = null;
        for (const s of inWindow) {
            if (s.date && (newestDate === null || s.date > newestDate)) {
                newestDate = s.date;
            }
        }
        const isRepost = newestDate !== null && newestDate < repostCutoff;
        out.push({
            kind: "pack",
            key: `pack:${groupKey}:${sortedByCreated[0].createdAt}`,
            primaryPerformer: primary,
            label,
            scenes: inWindow,
            sceneCount: inWindow.length,
            createdAt: sortedByCreated[0].createdAt,
            // Sort by IMPORT time, not scraped release date. A pack
            // is "a batch you just added," so back-catalog with old
            // scraped dates must still surface at the top of the feed
            // (and the card's "X ago" label must read the add time,
            // not the years-old release date).
            effectiveAt: sortedByCreated[0].createdAt,
            isRepost,
        });
        packedKeys.add(groupKey);
    }

    // A group that formed a pack is represented by that pack card, so
    // skip its loose individual scenes — otherwise a bulk import would
    // flood the feed with a pack AND dozens of cards. Everything else
    // shows all its scenes in the window (no cap), including scenes
    // with neither a performer nor a derivable source, which can only
    // ever appear on their own.
    for (const s of scenes) {
        const key = packGroupKey(s);
        if (!key) {
            out.push(s);
            continue;
        }
        if (packedKeys.has(key)) continue;
        out.push(s);
    }
    return out;
}
// Max images per gallery in the carousel — the rest live behind the
// "View gallery →" panel and open in the existing ImageLightbox.
const MAX_GALLERY_IMAGES = 10;

export interface FeedHookResult {
    state: FeedState;
    /// Re-run the load. Exposed so a failed feed can offer a retry
    /// instead of stranding the user on an error with no way forward
    /// short of reloading the whole plugin.
    retry: () => void;
}

export function useFeed(): FeedHookResult {
    const lookbackDays = useLookbackDays();
    const [state, setState] = useState<FeedState>({ kind: "loading" });
    const showGalleries = useShowGalleries();
    const includeStashDB = useIncludeStashDB();
    const libraryFolderNames = useLibraryFolderNames();
    // Joined so the effect re-runs when the list CONTENTS change; the
    // hook returns a fresh array each read, and depending on the array
    // itself would refetch the whole feed on every render.
    const libraryFolderKey = libraryFolderNames.join(",");
    const galleryIgnoreFolders = useGalleryIgnoreFolders();
    const galleryIgnoreKey = galleryIgnoreFolders.join(",");
    // Bumped by retry() to force the effect below to re-run.
    const [reloadTick, setReloadTick] = useState(0);

    useEffect(() => {
        let alive = true;
        const sinceIso = new Date(
            Date.now() - lookbackDays * 24 * 3600 * 1000,
        ).toISOString();

        // Stash's date fields are YYYY-MM-DD strings (DateCriterionInput),
        // distinct from the full-precision ISO timestamps used for
        // created_at (TimestampCriterionInput). Need both shapes. This
        // is also the boundary used for repost classification (a scene
        // dated before it reached the feed via the created_at query, so
        // it's back-catalog) and for the discovery window.
        const sinceDate = sinceIso.slice(0, 10);

        (async () => {
            try {
                // 4 parallel fetches: two filters × two content types.
                // - "byCreated" catches recently-added items
                // - "byDate" catches items with recent release dates
                //   even if they've been in the library for years
                // We then dedupe each type by id before merging. Both
                // use the shared cache so subsequent Home visits reuse
                // the same Promises.
                const [
                    scenesByCreated,
                    scenesByDate,
                    galleriesByCreated,
                    galleriesByDate,
                    discoveryItems,
                ] = await Promise.all([
                    getRecentScenes(sinceIso),
                    getScenesByDate(sinceDate),
                    // Skip the gallery queries entirely when the user
                    // has turned them off — saves a round-trip and N
                    // per-gallery image fetches.
                    showGalleries
                        ? getRecentGalleries(sinceIso)
                        : Promise.resolve([] as RecentGalleryRow[]),
                    showGalleries
                        ? getGalleriesByDate(sinceDate)
                        : Promise.resolve([] as RecentGalleryRow[]),
                    // StashDB discovery — scenes featuring unfollowed
                    // performers. Same toggle as the stories-row
                    // StashDB integration; both surface or both
                    // hide together so the user has one switch.
                    // Failures swallowed inside fetchDiscoveryFeedItems
                    // so a StashDB outage never breaks the feed.
                    includeStashDB
                        ? fetchDiscoveryFeedItems(sinceDate)
                        : Promise.resolve([] as DiscoveryFeedItem[]),
                ]);
                if (!alive) return;

                // Dedupe rows by sceneId / galleryId — a scene might
                // appear in both query results when its created_at AND
                // date both fall inside the window.
                const sceneRows = dedupeSceneRows([
                    ...scenesByCreated,
                    ...scenesByDate,
                ]);
                const noiseMatcher = buildGalleryNoiseMatcher(
                    galleryIgnoreKey.split(",").filter(Boolean),
                );
                const galleryRows = dedupeGalleries([
                    ...galleriesByCreated,
                    ...galleriesByDate,
                ]).filter((g) => !noiseMatcher.isNoise(g.paths));

                // Collapse scene rows (one row per scene/performer pair)
                // into one item per scene; gather all matching performers.
                // Built from every path in this batch, because what the
                // paths share is the library root, and only what is below
                // it names a source. Has to be built before the collapse
                // below, which needs an answer per scene.
                const sources = buildSourceResolver(
                    sceneRows.map((r) => r.filePath),
                    libraryFolderKey.split(",").filter(Boolean),
                );

                const sceneItems = new Map<string, SceneFeedItem>();
                for (const r of sceneRows) {
                    let item = sceneItems.get(r.sceneId);
                    if (!item) {
                        // A scene with an old scraped date that's still
                        // in the feed must have come via the recent-
                        // created_at query → back-catalog re-add. Sort
                        // it by import time so it surfaces instead of
                        // sinking to its years-old release date.
                        const isRepost =
                            r.sceneDate !== null && r.sceneDate < sinceDate;
                        item = {
                            kind: "scene",
                            key: `scene:${r.sceneId}`,
                            sceneId: r.sceneId,
                            title: r.sceneTitle,
                            details: r.sceneDetails,
                            preview: r.scenePreview,
                            screenshot: r.sceneScreenshot,
                            createdAt: r.sceneCreatedAt,
                            date: r.sceneDate,
                            effectiveAt: isRepost
                                ? r.sceneCreatedAt
                                : (r.sceneDate ?? r.sceneCreatedAt),
                            width: r.sceneWidth,
                            height: r.sceneHeight,
                            performers: [],
                            tags: r.sceneTags,
                            isRepost,
                            // Scene-level, so it is the same on every
                            // row for this scene. Derived even when a
                            // performer IS linked so the value is
                            // consistent, but only ever read for the
                            // scenes that have nobody.
                            impliedSource: sources.resolve(
                                r.studioName,
                                r.filePath,
                            ),
                        };
                        sceneItems.set(r.sceneId, item);
                    }
                    // Null for a scene with nobody linked. That row
                    // exists precisely so the scene still reaches the
                    // feed, so it must not be dropped here.
                    if (r.performer) {
                        item.performers.push({
                            id: r.performer.id,
                            name: r.performer.name,
                            imagePath: r.performer.imagePath,
                            favorite: r.performer.favorite,
                        });
                    }
                }

                // Fetch the first N images for each gallery in
                // parallel. Capped at a fixed number to bound the
                // per-gallery image round-trips on gallery-heavy windows.
                const cappedGalleryRows = galleryRows.slice(
                    0,
                    MAX_GALLERY_CARDS,
                );
                const galleryImageLists = await Promise.all(
                    cappedGalleryRows.map((g) =>
                        findImagesByGallery(
                            g.galleryId,
                            MAX_GALLERY_IMAGES,
                        ).catch(() => [] as PerformerImageCard[]),
                    ),
                );
                if (!alive) return;

                const galleryItems: GalleryFeedItem[] = cappedGalleryRows.map(
                    (g, i) => ({
                        kind: "gallery",
                        key: `gallery:${g.galleryId}`,
                        galleryId: g.galleryId,
                        title: g.title,
                        coverPath: g.coverPath,
                        imageCount: g.imageCount,
                        images: galleryImageLists[i] ?? [],
                        createdAt: g.createdAt,
                        date: g.date,
                        effectiveAt: g.date ?? g.createdAt,
                        performers: g.performers.map((p) => ({
                            id: p.id,
                            name: p.name,
                            imagePath: p.image_path,
                            favorite: p.favorite,
                        })),
                        paths: g.paths,
                    }),
                );

                // Assemble packs (bulk imports → one pack card). No
                // total slice — the whole window is shown; the
                // virtualizer renders only what's on screen.
                const sceneList: FeedItem[] = assemblePacks(
                    Array.from(sceneItems.values()).sort((a, b) =>
                        b.effectiveAt.localeCompare(a.effectiveAt),
                    ),
                    sinceDate,
                );

                const wrappedDiscovery: DiscoveryFeedItemWrapped[] =
                    discoveryItems.map((d) => ({ kind: "discovery", ...d }));

                const all: FeedItem[] = [
                    ...sceneList,
                    ...galleryItems,
                    ...wrappedDiscovery,
                ].sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));

                setState({ kind: "ready", items: all });
            } catch (err) {
                if (!alive) return;
                setState({
                    kind: "error",
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        })();

        return () => {
            alive = false;
        };
        // libraryFolderKey rather than the array: the hook returns a
        // fresh array each render, so depending on it would refetch the
        // whole feed on every paint.
    }, [
        lookbackDays,
        showGalleries,
        includeStashDB,
        libraryFolderKey,
        galleryIgnoreKey,
        reloadTick,
    ]);

    return { state, retry: () => setReloadTick((t) => t + 1) };
}

// Dedupe scene rows by sceneId. Rows are scene/performer pairs, so a
// single scene with multiple performers contributes multiple rows; we
// must NOT collapse across performers, only across duplicate (sceneId,
// performerId) pairs introduced by merging the two query result sets.
function dedupeSceneRows(rows: RecentSceneRow[]): RecentSceneRow[] {
    const seen = new Set<string>();
    const out: RecentSceneRow[] = [];
    for (const r of rows) {
        const key = `${r.sceneId}:${r.performer?.id ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
    }
    return out;
}

function dedupeGalleries(rows: RecentGalleryRow[]): RecentGalleryRow[] {
    const seen = new Set<string>();
    const out: RecentGalleryRow[] = [];
    for (const r of rows) {
        if (seen.has(r.galleryId)) continue;
        seen.add(r.galleryId);
        out.push(r);
    }
    return out;
}

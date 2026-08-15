import { useEffect, useState } from "react";
import {
    countUnidentifiedScenes,
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
    useAllowedGenders,
    orderedGenders,
} from "./pluginSettings";
import {
    fetchDiscoveryFeedItems,
    type DiscoveryFeedItem,
} from "./discoveryFeed";
import { buildSourceResolver } from "./impliedSource";
import { buildGalleryNoiseMatcher } from "./galleryNoise";
import {
    getStashDBBox,
    getMatchedScenePerformers,
    STASHDB_ENDPOINT,
    type MatchedScenePerformer,
} from "../api/stashdb";

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
    /// For a scene with no LOCAL performers but a StashDB match: who
    /// StashDB says is in it. They are not in the library, so they have
    /// no profile to open and no local id — the card offers to add them
    /// instead. Empty when the scene has local performers, when StashDB
    /// is off, or when the lookup has not landed.
    matchedPerformers: MatchedScenePerformer[];
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
    /// Set when there is no local performer but StashDB knows who is in
    /// the batch. The card shows them as the poster and offers to add
    /// them to the library, since that is the missing step.
    matchedPerformer: MatchedScenePerformer | null;
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
    | {
          kind: "ready";
          items: FeedItem[];
          /// How many recent scenes were left out for having neither a
          /// performer nor a StashDB match. The empty state needs this:
          /// "nothing new in your recent window" is wrong and confusing
          /// on a freshly scanned library, where there IS plenty new and
          /// none of it is identified yet.
          unidentifiedCount: number;
          /// The same for galleries, which are held to the same bar but
          /// counted apart because the reason differs: a gallery cannot
          /// have a stash id, so a performer is its only way in.
          unidentifiedGalleryCount: number;
      }
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
    // A StashDB match is a real identity, so it beats the folder: two
    // scenes of the same performer belong together even when they were
    // imported into different directories.
    const matched = s.matchedPerformers[0]?.stashId;
    if (matched) return `m:${matched}`;
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
        const matched = newestScene.matchedPerformers[0] ?? null;
        // Grouped scenes share whichever of the three produced the key,
        // so reading it off the newest is safe.
        const label =
            primary?.name ?? matched?.name ?? newestScene.impliedSource;
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
            matchedPerformer: primary ? null : matched,
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
    // "Genders to surface" applies here too. A StashDB match tells us
    // who is in the scene, and if the user has hidden a gender, the card
    // must not put one of them on the front of it.
    const allowedGenders = useAllowedGenders();
    const allowedGenderKey = orderedGenders(allowedGenders).join(",");
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
                ]);

                // StashDB discovery is deliberately NOT awaited here.
                // It is the slowest thing on the page by a distance —
                // measured at 14.8s against 1.0s for the library's own
                // scenes — and it is an optional garnish on a feed that
                // is otherwise ready. Awaiting it alongside the queries
                // above held a finished feed back for fourteen seconds.
                // Started now so it runs alongside the work below, and
                // merged when it lands.
                const discoveryPromise: Promise<DiscoveryFeedItem[]> =
                    includeStashDB
                        ? fetchDiscoveryFeedItems(sinceDate).catch(() => [])
                        : Promise.resolve([]);
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
                const cleanGalleryRows = dedupeGalleries([
                    ...galleriesByCreated,
                    ...galleriesByDate,
                ]).filter((g) => !noiseMatcher.isNoise(g.paths));
                // Same bar as scenes: a gallery nobody is linked to is
                // an unidentified folder of images. Stash has no
                // stash_ids field on galleries at all, so unlike a scene
                // there is no second way for one to qualify — a
                // performer is the only evidence available.
                const galleryRows = cleanGalleryRows.filter(
                    (g) => (g.performers ?? []).length > 0,
                );
                const unidentifiedGalleryCount =
                    cleanGalleryRows.length - galleryRows.length;

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

                // StashDB scene match per scene, or null. Only scenes
                // with one may appear without a performer.
                const stashIdBySceneId = new Map<string, string | null>();
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
                            matchedPerformers: [],
                        };
                        stashIdBySceneId.set(
                            r.sceneId,
                            r.stashIds.find(
                                (x) => x.endpoint === STASHDB_ENDPOINT,
                            )?.stashId ?? null,
                        );
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

                // A scene with nobody linked earns its place only if it
                // has been identified against StashDB — typically by
                // forage, which matches on import. Then its performers
                // are knowable and the card has a poster, even though
                // they are not in this library. Without a match it is an
                // unidentified file with no title, no studio and no
                // cast, and a feed is the wrong place for it.
                //
                // The query already applies this rule, so the sweep
                // below normally deletes nothing. It stays because the
                // query can only ask whether SOME stashdb.org id exists
                // while the rule is about this scene's own id, and
                // because a rule this load-bearing should not live in
                // one place only.
                for (const [sceneId, item] of sceneItems) {
                    if (item.performers.length > 0) continue;
                    if (!stashIdBySceneId.get(sceneId)) {
                        sceneItems.delete(sceneId);
                    }
                }
                // Only counted when there is nothing to show, which is
                // the only place it is read. A normal load pays nothing
                // for it.
                let unidentifiedCount = 0;
                if (sceneItems.size === 0) {
                    try {
                        unidentifiedCount =
                            await countUnidentifiedScenes(sinceIso);
                    } catch {
                        // The empty state just says less.
                    }
                }

                // Who StashDB says is in the survivors. Cached across
                // loads, capped per load, and entirely optional: without
                // a StashDB key the scenes still show, titled by their
                // studio, just without a face on them.
                const needPerformers = [...sceneItems.entries()]
                    .filter(([, i]) => i.performers.length === 0)
                    .map(([id]) => stashIdBySceneId.get(id))
                    .filter((x): x is string => Boolean(x));
                if (needPerformers.length > 0 && includeStashDB) {
                    const box = await getStashDBBox();
                    if (box) {
                        const byStashId = await getMatchedScenePerformers(
                            needPerformers,
                            box.api_key,
                        );
                        if (!alive) return;
                        const allowed = new Set(
                            allowedGenderKey.split(",").filter(Boolean),
                        );
                        for (const [sceneId, item] of sceneItems) {
                            if (item.performers.length > 0) continue;
                            const sid = stashIdBySceneId.get(sceneId);
                            if (!sid) continue;
                            // Same rule the discovery feed uses: an
                            // unknown gender does not pass. Filtered
                            // before anything reads the list, so a
                            // hidden performer cannot title a card or
                            // become the key a batch groups under.
                            item.matchedPerformers = (
                                byStashId.get(sid) ?? []
                            ).filter(
                                (p) => !!p.gender && allowed.has(p.gender),
                            );
                        }
                    }
                }

                // Assemble packs (bulk imports → one pack card). No
                // total slice — the whole window is shown; the
                // virtualizer renders only what's on screen.
                const sceneList: FeedItem[] = assemblePacks(
                    Array.from(sceneItems.values()).sort((a, b) =>
                        b.effectiveAt.localeCompare(a.effectiveAt),
                    ),
                    sinceDate,
                );

                const local: FeedItem[] = [...sceneList, ...galleryItems].sort(
                    (a, b) => b.effectiveAt.localeCompare(a.effectiveAt),
                );

                // Show the library's own feed the moment it is ready.
                setState({
                    kind: "ready",
                    items: local,
                    unidentifiedCount,
                    unidentifiedGalleryCount,
                });

                // Then fold discovery in whenever it arrives. The cards
                // sort into the list by date, so a reader who has
                // scrolled will see it shift under them — which is the
                // price of not making everyone wait fourteen seconds for
                // a feed that was ready in one.
                void discoveryPromise.then((discoveryItems) => {
                    if (!alive || discoveryItems.length === 0) return;
                    const wrapped: DiscoveryFeedItemWrapped[] =
                        discoveryItems.map((d) => ({
                            kind: "discovery",
                            ...d,
                        }));
                    setState((prev) =>
                        prev.kind === "ready"
                            ? {
                                  ...prev,
                                  items: [...prev.items, ...wrapped].sort(
                                      (a, b) =>
                                          b.effectiveAt.localeCompare(
                                              a.effectiveAt,
                                          ),
                                  ),
                              }
                            : prev,
                    );
                });
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
        allowedGenderKey,
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

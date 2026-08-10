// Discovery feed: surfaces StashDB scenes whose primary performer
// ISN'T in the user's local Stash library yet. Each scene appears
// ONCE in the feed — picked from co-star + top-release seeds and
// deduped by scene_id. The "poster" (primary performer the card
// centres on) is chosen by:
//   1. A female performer on the scene who's already in the user's
//      library — they get the headline (no Follow needed for them).
//   2. Else, the most popular unfollowed female performer (highest
//      StashDB scene_count) — they get the headline with a Follow
//      CTA at the top-right.
//
// Either way, every unfollowed female co-performer on the scene
// remains followable via their @mention hover-card in the card body.

import {
    getStashDBBox,
    getLinkedPerformers,
    getOwnedStashDBSceneIds,
    getNewStashDBScenesForPerformers,
    getTrendingStashDBScenes,
    type StashDBScene,
    type StashDBScenePerformer,
} from "../api/stashdb";
import { readAllowedGenders } from "./pluginSettings";

// ── 12h cache for discovery seeds ───────────────────────────────────
//
// Without this, every cold load of Home fires both trending and co-star
// queries at stashdb.org. On networks where stashdb is slow or blocked
// that's minutes of wait per page open. Stories already caches its own
// stashdb pull (see stashdb.ts CACHE_KEY); this mirrors that for the
// Feed's discovery seeds. The cache is keyed by sinceIsoDate + which
// seeds were requested, so toggling "hide trending" or changing the
// lookback window correctly invalidates. The Home refresh button calls
// invalidateDiscoveryFeedCache() to force a fresh pull.

const DISCOVERY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DISCOVERY_CACHE_KEY = "binge.discovery.seeds.v1";

interface DiscoveryCacheEntry {
    sinceIsoDate: string;
    skipTrending: boolean;
    fetchedAt: number;
    trending: StashDBScene[];
    costar: StashDBScene[];
}

function readDiscoveryCache(
    sinceIsoDate: string,
    skipTrending: boolean
): DiscoveryCacheEntry | null {
    try {
        const raw = localStorage.getItem(DISCOVERY_CACHE_KEY);
        if (!raw) return null;
        const entry = JSON.parse(raw) as DiscoveryCacheEntry;
        if (entry.sinceIsoDate !== sinceIsoDate) return null;
        if (entry.skipTrending !== skipTrending) return null;
        if (Date.now() - entry.fetchedAt > DISCOVERY_CACHE_TTL_MS) return null;
        return entry;
    } catch {
        return null;
    }
}

function writeDiscoveryCache(entry: DiscoveryCacheEntry): void {
    try {
        localStorage.setItem(
            DISCOVERY_CACHE_KEY,
            JSON.stringify(entry)
        );
    } catch {
        /* quota — ignore */
    }
}

export function invalidateDiscoveryFeedCache(): void {
    try {
        localStorage.removeItem(DISCOVERY_CACHE_KEY);
    } catch {
        /* ignore */
    }
}

export interface DiscoveryFeedItem {
    key: string;
    sceneStashId: string;
    title: string | null;
    coverUrl: string | null;
    releaseDate: string | null;
    effectiveAt: string;
    stashboxUrl: string;
    stashBoxIndex: number;
    // The headline performer shown in the card's header. Either:
    //  - A library performer (primaryInLibrary === true, localId set,
    //    no Follow CTA at top-right), OR
    //  - The most popular unfollowed female performer (Follow CTA
    //    appears, localId === null).
    primaryPerformer: {
        stashId: string;
        name: string;
        image: string | null;
        gender: string | null;
        birthDate: string | null;
        localId: string | null; // null = not in library
        /// True when the linked library performer is marked
        /// Favourite. Used by the card header to swap the
        /// verified mark from blue (in-library) → pink
        /// (favourite). null when not in library.
        favorite: boolean;
    };
    primaryInLibrary: boolean;
    // All other performers on the scene EXCEPT the primary. Used by
    // the @mention row below the title. Each carries localId so the
    // hover card knows whether to show "Open profile" or "Follow".
    coPerformers: {
        stashId: string;
        name: string;
        image: string | null;
        gender: string | null;
        birthDate: string | null;
        localId: string | null;
        favorite: boolean;
    }[];
    source: "costar" | "trending";
}

// Gender filter — both the primary picker AND the co-performer
// list. Driven by `binge.allowedGenders` (Settings → Genders to
// surface). Performers whose gender isn't in the user's allowed
// set don't surface as discovery candidates. Read fresh per call
// so toggling the setting takes effect on the next discovery
// fetch without a reload.
function makeGenderFilter(): (gender: string | null) => boolean {
    const allowed = readAllowedGenders();
    return (gender) => !!gender && allowed.has(gender as never);
}

// Per-performer cap: an unfollowed performer with many recent
// scenes shouldn't get N cards. Limit how many TIMES a given
// person appears as the headline.
const MAX_SCENES_PER_PRIMARY = 2;

// How many trending scenes (Seed 2) to drop into the feed at most.
// Co-star scenes (Seed 1) are uncapped — they're the high-signal
// seed and naturally limited by the size of the user's library.
const MAX_TRENDING_ITEMS = 12;

export async function fetchDiscoveryFeedItems(
    sinceIsoDate: string,
    opts: { skipTrending?: boolean } = {}
): Promise<DiscoveryFeedItem[]> {
    const skipTrending = !!opts.skipTrending;
    const box = await getStashDBBox();
    if (!box) return [];

    const linkedPerformers = await getLinkedPerformers();
    const stashIdToLocal = new Map<
        string,
        { localId: string; name: string; favorite: boolean }
    >();
    for (const p of linkedPerformers) {
        stashIdToLocal.set(p.stashId, {
            localId: p.localId,
            name: p.name,
            favorite: p.favorite,
        });
    }

    const owned = await getOwnedStashDBSceneIds();

    // Cache the raw seed scenes (trending + costar) for 12h, keyed
    // by sinceIsoDate + skipTrending. The post-fetch build below is
    // cheap and depends on live library state, so we only cache the
    // raw stashdb pull — not the final items — so follow/unfollow
    // still takes effect immediately on the next build.
    let cached = readDiscoveryCache(sinceIsoDate, skipTrending);
    let trendingScenes: StashDBScene[] = [];
    let costarScenes: StashDBScene[] = [];

    if (cached) {
        trendingScenes = cached.trending;
        costarScenes = cached.costar;
    } else {
        // Fetch both seeds in PARALLEL. They're independent queries
        // (trending = global top-N, costar = by linked performers),
        // so running them together turns two 10s stashdb timeouts
        // into one on degraded networks. Each is independently
        // try-caught so a failure in one doesn't sink the other.
        const tasks: Promise<void>[] = [];
        let anyFetchAttempted = false;
        let anyFetchSucceeded = false;

        if (!skipTrending) {
            anyFetchAttempted = true;
            tasks.push(
                getTrendingStashDBScenes(box.api_key)
                    .then((s) => { trendingScenes = s; anyFetchSucceeded = true; })
                    .catch((err) => {
                        console.warn("[binge] discovery trending fetch failed", err);
                    })
            );
        }

        if (linkedPerformers.length > 0) {
            anyFetchAttempted = true;
            tasks.push(
                getNewStashDBScenesForPerformers(
                    linkedPerformers.map((p) => p.stashId),
                    sinceIsoDate,
                    box.api_key
                )
                    .then((s) => { costarScenes = s; anyFetchSucceeded = true; })
                    .catch((err) => {
                        console.warn("[binge] discovery co-star fetch failed", err);
                    })
            );
        }

        await Promise.all(tasks);

        // Only cache if at least one fetch actually ran and succeeded.
        // On a flaky network both seeds come back as [] (10s timeout
        // already swallowed above) — writing that empty result would
        // silently overwrite valid cached data with nothing. When no
        // fetch was attempted at all (skipTrending + no linked
        // performers), the empty result is legitimate and we skip
        // caching for a different reason: nothing worth storing.
        if (anyFetchAttempted && anyFetchSucceeded) {
            cached = {
                sinceIsoDate,
                skipTrending,
                fetchedAt: Date.now(),
                trending: trendingScenes,
                costar: costarScenes,
            };
            writeDiscoveryCache(cached);
        }
    }

    // Collect raw scenes from BOTH into a single pool keyed by
    // scene_id so we never emit the same scene twice.
    //
    // Trending is loaded FIRST so it wins the dedup — being in
    // StashDB's global top-N is a stronger signal than "features a
    // library performer" (which the user's library already covers
    // as baseline). Without this ordering, almost every trending
    // scene also matches the co-star fetch and the TRENDING pill
    // never surfaces in practice.
    const scenesById = new Map<
        string,
        { scene: StashDBScene; source: "costar" | "trending" }
    >();

    for (const s of trendingScenes.slice(0, MAX_TRENDING_ITEMS)) {
        if (owned.has(s.id)) continue;
        if (!scenesById.has(s.id)) {
            scenesById.set(s.id, { scene: s, source: "trending" });
        }
    }

    for (const s of costarScenes) {
        if (owned.has(s.id)) continue;
        // Trending was loaded first; don't overwrite the
        // stronger signal.
        if (!scenesById.has(s.id)) {
            scenesById.set(s.id, { scene: s, source: "costar" });
        }
    }

    // Build items: pick a poster per scene, attach co-performers.
    // Skip scenes where the headline pick would be a library
    // performer AND there are no unfollowed co-stars of an allowed
    // gender — those are "nothing to follow" so they'd just be noise.
    const items: DiscoveryFeedItem[] = [];
    const perfCounts = new Map<string, number>(); // headline cap
    const isAllowedGender = makeGenderFilter();

    for (const { scene, source } of scenesById.values()) {
        // Obey the recent window. The co-star query already filters
        // server-side by date, but the trending query (sort: TRENDING)
        // returns globally-hot scenes of ANY age — so an undated or
        // older-than-window scene must be dropped here, or trending
        // cards leak past the user's configured lookback.
        if (!scene.releaseDate || scene.releaseDate < sinceIsoDate) {
            continue;
        }

        const candidates = (scene.performers ?? []).filter((p) =>
            isAllowedGender(p.gender)
        );
        if (candidates.length === 0) continue;

        const libraryPerformer = candidates.find((p) =>
            stashIdToLocal.has(p.id)
        );
        // Most popular unfollowed candidate (highest scene_count;
        // ties broken by alphabetical name for determinism).
        const unfollowed = candidates
            .filter((p) => !stashIdToLocal.has(p.id))
            .slice()
            .sort((a, b) => {
                if (a.sceneCount !== b.sceneCount) {
                    return b.sceneCount - a.sceneCount;
                }
                return a.name.localeCompare(b.name);
            });

        // No-one to feature OR follow → skip the scene.
        if (!libraryPerformer && unfollowed.length === 0) continue;
        // Costar-source only: headline is a library performer but
        // no unfollowed co-stars to follow either → skip (no
        // actionable signal). Trending bypasses this gate — an
        // all-library trending scene still carries information
        // value (it's what StashDB is surfacing right now), and
        // dropping it makes the TRENDING pill all but invisible
        // for users with substantial libraries.
        if (
            source === "costar" &&
            libraryPerformer &&
            unfollowed.length === 0
        ) {
            continue;
        }

        const poster: StashDBScenePerformer | undefined =
            libraryPerformer ?? unfollowed[0];
        if (!poster) continue;

        // Apply per-performer headline cap.
        const seen = perfCounts.get(poster.id) ?? 0;
        if (seen >= MAX_SCENES_PER_PRIMARY) continue;
        perfCounts.set(poster.id, seen + 1);

        const posterLocal = stashIdToLocal.get(poster.id) ?? null;
        const coPerformers = (scene.performers ?? [])
            .filter((p) => p.id !== poster.id)
            .filter((p) => isAllowedGender(p.gender))
            .map((p) => {
                const local = stashIdToLocal.get(p.id);
                return {
                    stashId: p.id,
                    name: p.name,
                    image: p.image,
                    gender: p.gender,
                    birthDate: p.birthDate,
                    localId: local?.localId ?? null,
                    favorite: local?.favorite ?? false,
                };
            });

        items.push({
            key: `discovery:${scene.id}`,
            sceneStashId: scene.id,
            title: scene.title,
            coverUrl: scene.coverUrl,
            releaseDate: scene.releaseDate,
            effectiveAt:
                scene.releaseDate ??
                new Date().toISOString().slice(0, 10),
            stashboxUrl: `https://stashdb.org/scenes/${scene.id}`,
            stashBoxIndex: box.index,
            primaryPerformer: {
                stashId: poster.id,
                name: poster.name,
                image: poster.image,
                gender: poster.gender,
                birthDate: poster.birthDate,
                localId: posterLocal?.localId ?? null,
                favorite: posterLocal?.favorite ?? false,
            },
            primaryInLibrary: !!posterLocal,
            coPerformers,
            source,
        });
    }

    return items;
}

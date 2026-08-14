// StashDB integration — surfaces "new releases" for performers in
// the local library that have a linked StashDB stash_id but aren't
// yet imported. Cribbed from `ordureconnoisseur/stash-new-scene-discovery`.
//
// Flow:
//   1. Pull StashDB endpoint + api_key from Stash's config
//      (configuration.general.stashBoxes).
//   2. List local performers that have a stash_id pointing at
//      stashdb.org/graphql.
//   3. List stash_ids of scenes ALREADY in the library, so we can
//      filter them out of the "new" results.
//   4. Batched POST to stashdb.org/graphql with
//      `queryScenes(input: { date: { value, modifier: GREATER_THAN },
//                            performers: { value: [batch], modifier: INCLUDES } })`.
//   5. Return scenes the user doesn't already own, grouped by performer.
//
// Caching: 12h TTL in localStorage. StashDB doesn't add new content
// minute-by-minute, and the StashDB GraphQL endpoint is rate-sensitive.

import { gql } from "./graphql";

export const STASHDB_ENDPOINT = "https://stashdb.org/graphql";

export interface StashBoxConfig {
    endpoint: string;
    api_key: string;
    // Position of this entry in Stash's configured stashboxes list.
    // Required by `scrapeSinglePerformer(source: { stash_box_index })`
    // when we follow a discovery suggestion.
    index: number;
}

export interface LinkedPerformer {
    localId: string;
    stashId: string;
    name: string;
    favorite: boolean;
    imagePath: string | null;
}

export interface StashDBScenePerformer {
    id: string;
    name: string;
    image: string | null;
    // StashDB gender enum: FEMALE / MALE / TRANSGENDER_FEMALE /
    // TRANSGENDER_MALE / INTERSEX / NON_BINARY (or null when
    // unknown). Used to filter discovery candidates to female +
    // trans female.
    gender: string | null;
    // ISO YYYY-MM-DD birthdate from StashDB (null when not set on
    // the performer record). Drives age rendering on the hover
    // mini-profile card.
    birthDate: string | null;
    // Total scenes on StashDB. Drives the "most popular performer"
    // tiebreaker when picking the poster for a discovery card.
    sceneCount: number;
}

export interface StashDBScene {
    id: string;
    title: string | null;
    releaseDate: string | null;
    coverUrl: string | null;
    // Full per-scene performer detail — needed for the "discover &
    // follow" feature so we can surface unfollowed co-stars with their
    // name + image, not just an id.
    performers: StashDBScenePerformer[];
}

// ── Local Stash config + linked-performer queries ────────────────────

const FIND_STASHBOX_CONFIG = /* GraphQL */ `
    query Configuration {
        configuration {
            general {
                stashBoxes {
                    endpoint
                    api_key
                    name
                }
            }
        }
    }
`;

export async function getStashDBBox(): Promise<StashBoxConfig | null> {
    const data = await gql<{
        configuration: {
            general: {
                stashBoxes: { endpoint: string; api_key: string }[];
            };
        };
    }>(FIND_STASHBOX_CONFIG);
    const boxes = data.configuration.general.stashBoxes;
    const index = boxes.findIndex((b) => b.endpoint === STASHDB_ENDPOINT);
    if (index < 0) return null;
    const box = boxes[index];
    if (!box.api_key) return null;
    return { endpoint: box.endpoint, api_key: box.api_key, index };
}

const FIND_LINKED_PERFORMERS = /* GraphQL */ `
    query LinkedPerformers {
        findPerformers(filter: { per_page: -1 }) {
            performers {
                id
                name
                favorite
                image_path
                stash_ids {
                    endpoint
                    stash_id
                }
            }
        }
    }
`;

export async function getLinkedPerformers(): Promise<LinkedPerformer[]> {
    const data = await gql<{
        findPerformers: {
            performers: {
                id: string;
                name: string;
                favorite: boolean;
                image_path: string | null;
                stash_ids: { endpoint: string; stash_id: string }[];
            }[];
        };
    }>(FIND_LINKED_PERFORMERS);
    const out: LinkedPerformer[] = [];
    for (const p of data.findPerformers.performers) {
        const link = p.stash_ids.find((s) => s.endpoint === STASHDB_ENDPOINT);
        if (!link) continue;
        out.push({
            localId: p.id,
            stashId: link.stash_id,
            name: p.name,
            favorite: p.favorite,
            imagePath: p.image_path,
        });
    }
    return out;
}

// Filtered to scenes that HAVE a stash id. Without the filter Stash
// serialises an empty array for every other scene in the library, which
// on a 131k-scene library is 4.47 MB and 12.0s against 2.64 MB and 1.19s
// for the same answer.
const FIND_OWNED_STASH_IDS = /* GraphQL */ `
    query OwnedStashIds {
        findScenes(
            scene_filter: { stash_id_endpoint: { modifier: NOT_NULL } }
            filter: { per_page: -1 }
        ) {
            scenes {
                stash_ids {
                    endpoint
                    stash_id
                }
            }
        }
    }
`;

// Shared across callers for the lifetime of a page load. Both the
// discovery feed and the stories row need this, and they used to ask
// independently — two of the single most expensive requests binge makes,
// in flight at the same time, for identical answers.
let ownedIdsPromise: Promise<Set<string>> | null = null;

export function invalidateOwnedStashDBSceneIds(): void {
    ownedIdsPromise = null;
}

export function getOwnedStashDBSceneIds(): Promise<Set<string>> {
    if (!ownedIdsPromise) {
        ownedIdsPromise = fetchOwnedStashDBSceneIds().catch((err) => {
            // Never cache a failure: the next caller should retry.
            ownedIdsPromise = null;
            throw err;
        });
    }
    return ownedIdsPromise;
}

async function fetchOwnedStashDBSceneIds(): Promise<Set<string>> {
    const data = await gql<{
        findScenes: {
            scenes: {
                stash_ids: { endpoint: string; stash_id: string }[];
            }[];
        };
    }>(FIND_OWNED_STASH_IDS);
    const owned = new Set<string>();
    for (const s of data.findScenes.scenes) {
        for (const sid of s.stash_ids) {
            if (sid.endpoint === STASHDB_ENDPOINT) owned.add(sid.stash_id);
        }
    }
    return owned;
}

// ── StashDB query ────────────────────────────────────────────────────

const PERFORMER_BATCH_SIZE = 100;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

async function postStashDB<T>(
    apiKey: string,
    query: string,
    variables: Record<string, unknown>,
): Promise<T | null> {
    try {
        const res = await fetch(STASHDB_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ApiKey: apiKey,
            },
            body: JSON.stringify({ query, variables }),
        });
        if (!res.ok) {
            console.warn(
                "[binge] stashdb http error",
                res.status,
                res.statusText,
            );
            return null;
        }
        const body = (await res.json()) as {
            data?: T;
            errors?: { message: string }[];
        };
        if (body.errors?.length) {
            // Surface validation errors so query-shape bugs don't
            // silently swallow themselves.
            console.warn(
                "[binge] stashdb graphql errors",
                body.errors.map((e) => e.message).join("; "),
            );
            return null;
        }
        return body.data ?? null;
    } catch (err) {
        console.warn("[binge] stashdb fetch failed", err);
        return null;
    }
}

const QUERY_SCENES = /* GraphQL */ `
    query QueryScenes($input: SceneQueryInput!) {
        queryScenes(input: $input) {
            count
            scenes {
                id
                title
                release_date
                images {
                    url
                }
                performers {
                    performer {
                        id
                        name
                        gender
                        birth_date
                        scene_count
                        images {
                            url
                        }
                    }
                }
            }
        }
    }
`;

// Trending StashDB scenes — same query stashdb.org's homepage
// "Trending scenes" section uses. `sort: TRENDING` ranks by
// recent activity (favourites, edits, views) rather than release
// date, so a 2-year-old scene with current buzz still surfaces.
// No date filter — trending is its own signal. Capped tight
// because StashDB rate-limits and we don't want to flood the feed.
const QUERY_TRENDING_SCENES = /* GraphQL */ `
    query QueryTrendingScenes($input: SceneQueryInput!) {
        queryScenes(input: $input) {
            scenes {
                id
                title
                release_date
                images {
                    url
                }
                performers {
                    performer {
                        id
                        name
                        gender
                        birth_date
                        scene_count
                        images {
                            url
                        }
                    }
                }
            }
        }
    }
`;

interface RawStashDBScene {
    id: string;
    title: string | null;
    release_date: string | null;
    images: { url: string }[];
    performers: {
        performer: {
            id: string;
            name: string;
            gender: string | null;
            birth_date: string | null;
            scene_count: number | null;
            images: { url: string }[];
        };
    }[];
}

function shapeScene(s: RawStashDBScene): StashDBScene {
    // Defensive defaults — StashDB occasionally returns scenes whose
    // `performers` array is null (orphaned/edited records); without
    // this, the discovery merge crashes with "scene.performers is
    // undefined" when iterating.
    return {
        id: s.id,
        title: s.title,
        releaseDate: s.release_date,
        coverUrl: s.images?.[0]?.url ?? null,
        performers: (s.performers ?? [])
            .filter((x) => x && x.performer)
            .map((x) => ({
                id: x.performer.id,
                name: x.performer.name,
                image: x.performer.images?.[0]?.url ?? null,
                gender: x.performer.gender ?? null,
                birthDate: x.performer.birth_date ?? null,
                sceneCount: x.performer.scene_count ?? 0,
            })),
    };
}

// Fetch new StashDB scenes for the given performer batch, dated after
// `sinceIsoDate` (YYYY-MM-DD). Paginated. Returns flat list.
async function fetchStashDBScenesBatch(
    apiKey: string,
    performerStashIds: string[],
    sinceIsoDate: string,
): Promise<StashDBScene[]> {
    const out: StashDBScene[] = [];
    let page = 1;
    while (page <= MAX_PAGES) {
        const data = await postStashDB<{
            queryScenes: { count: number; scenes: RawStashDBScene[] };
        }>(apiKey, QUERY_SCENES, {
            input: {
                date: { value: sinceIsoDate, modifier: "GREATER_THAN" },
                performers: {
                    value: performerStashIds,
                    modifier: "INCLUDES",
                },
                sort: "DATE",
                direction: "DESC",
                page,
                per_page: PAGE_SIZE,
            },
        });
        if (!data?.queryScenes?.scenes) break;
        for (const s of data.queryScenes.scenes) out.push(shapeScene(s));
        if (data.queryScenes.scenes.length < PAGE_SIZE) break;
        page++;
    }
    return out;
}

// ── StashDB single-performer fetch ──────────────────────────────────
//
// Stash's built-in `scrapeSinglePerformer` mutation expects a search
// query, not a stash_id, and its input schema doesn't accept the
// direct-by-id shape we tried before. Hitting StashDB's own GraphQL
// is more reliable + gives us the full image array (for the photo
// carousel in FollowPerformerModal) which the scraper path didn't.
//
// We pull every field Stash's PerformerCreateInput cares about,
// plus images[] (carousel) and scene_count (display).

const QUERY_PERFORMER = /* GraphQL */ `
    query QueryPerformer($id: ID!) {
        findPerformer(id: $id) {
            id
            name
            disambiguation
            gender
            birth_date
            career_start_year
            career_end_year
            height
            hair_color
            eye_color
            ethnicity
            country
            breast_type
            cup_size
            band_size
            waist_size
            hip_size
            aliases
            scene_count
            images {
                url
            }
            urls {
                url
                site {
                    name
                }
            }
            tattoos {
                location
                description
            }
            piercings {
                location
                description
            }
        }
    }
`;

export interface StashDBPerformerDetail {
    id: string;
    name: string;
    disambiguation: string | null;
    gender: string | null;
    birthDate: string | null;
    careerStartYear: number | null;
    careerEndYear: number | null;
    height: number | null;
    hairColor: string | null;
    eyeColor: string | null;
    ethnicity: string | null;
    country: string | null;
    breastType: string | null;
    aliases: string[];
    sceneCount: number;
    measurements: string | null;
    images: { url: string }[];
    urls: { url: string; site: string }[];
    tattoos: { location: string; description: string | null }[];
    piercings: { location: string; description: string | null }[];
}

export async function getStashDBPerformer(
    stashId: string,
    apiKey: string,
): Promise<StashDBPerformerDetail | null> {
    const data = await postStashDB<{
        findPerformer: {
            id: string;
            name: string;
            disambiguation: string | null;
            gender: string | null;
            birth_date: string | null;
            career_start_year: number | null;
            career_end_year: number | null;
            height: number | null;
            hair_color: string | null;
            eye_color: string | null;
            ethnicity: string | null;
            country: string | null;
            breast_type: string | null;
            cup_size: string | null;
            band_size: number | null;
            waist_size: number | null;
            hip_size: number | null;
            aliases: string[] | null;
            scene_count: number;
            images: { url: string }[];
            urls: { url: string; site: { name: string } }[];
            tattoos: { location: string; description: string | null }[];
            piercings: {
                location: string;
                description: string | null;
            }[];
        } | null;
    }>(apiKey, QUERY_PERFORMER, { id: stashId });
    if (!data?.findPerformer) return null;
    const p = data.findPerformer;
    return {
        id: p.id,
        name: p.name,
        disambiguation: p.disambiguation,
        gender: p.gender,
        birthDate: p.birth_date,
        careerStartYear: p.career_start_year,
        careerEndYear: p.career_end_year,
        height: p.height,
        hairColor: p.hair_color,
        eyeColor: p.eye_color,
        ethnicity: p.ethnicity,
        country: p.country,
        breastType: p.breast_type,
        aliases: p.aliases ?? [],
        sceneCount: p.scene_count,
        measurements: formatMeasurements(
            p.band_size,
            p.cup_size,
            p.waist_size,
            p.hip_size,
        ),
        images: p.images ?? [],
        urls: (p.urls ?? []).map((u) => ({
            url: u.url,
            // site can be null on a StashDB URL — guard the deref so
            // one site-less URL doesn't throw the whole record mapping.
            site: u.site?.name ?? "",
        })),
        tattoos: p.tattoos ?? [],
        piercings: p.piercings ?? [],
    };
}

function formatMeasurements(
    band: number | null,
    cup: string | null,
    waist: number | null,
    hip: number | null,
): string | null {
    const top = band && cup ? `${band}${cup}` : null;
    const parts = [top, waist?.toString(), hip?.toString()].filter(Boolean);
    return parts.length ? parts.join("-") : null;
}

// ── StashDB single-scene fetch ──────────────────────────────────────
//
// Used by AddSceneModal to pre-fill the form when "Add scene to
// Stash" is tapped from a DiscoveryFeedCard. Pulls the full StashDB
// scene record: title, details, urls, release date, code, director,
// duration, plus studio + per-performer detail + images for the
// carousel.

const QUERY_SCENE = /* GraphQL */ `
    query QueryScene($id: ID!) {
        findScene(id: $id) {
            id
            title
            details
            release_date
            production_date
            code
            director
            duration
            urls {
                url
                site {
                    name
                }
            }
            studio {
                id
                name
            }
            performers {
                performer {
                    id
                    name
                    gender
                    images {
                        url
                    }
                }
                as
            }
            tags {
                id
                name
            }
            images {
                url
            }
        }
    }
`;

export interface StashDBSceneDetail {
    id: string;
    title: string | null;
    details: string | null;
    releaseDate: string | null;
    productionDate: string | null;
    code: string | null;
    director: string | null;
    duration: number | null;
    urls: { url: string; site: string }[];
    studio: { stashId: string; name: string } | null;
    performers: {
        stashId: string;
        name: string;
        gender: string | null;
        image: string | null;
        as: string | null;
    }[];
    tags: { stashId: string; name: string }[];
    images: { url: string }[];
}

export async function getStashDBScene(
    sceneId: string,
    apiKey: string,
): Promise<StashDBSceneDetail | null> {
    const data = await postStashDB<{
        findScene: {
            id: string;
            title: string | null;
            details: string | null;
            release_date: string | null;
            production_date: string | null;
            code: string | null;
            director: string | null;
            duration: number | null;
            urls: { url: string; site: { name: string } }[];
            studio: { id: string; name: string } | null;
            performers: {
                performer: {
                    id: string;
                    name: string;
                    gender: string | null;
                    images: { url: string }[];
                };
                as: string | null;
            }[];
            tags: { id: string; name: string }[];
            images: { url: string }[];
        } | null;
    }>(apiKey, QUERY_SCENE, { id: sceneId });
    if (!data?.findScene) return null;
    const s = data.findScene;
    return {
        id: s.id,
        title: s.title,
        details: s.details,
        releaseDate: s.release_date,
        productionDate: s.production_date,
        code: s.code,
        director: s.director,
        duration: s.duration,
        urls: (s.urls ?? []).map((u) => ({
            url: u.url,
            site: u.site?.name ?? "",
        })),
        studio: s.studio ? { stashId: s.studio.id, name: s.studio.name } : null,
        performers: (s.performers ?? []).map((pa) => ({
            stashId: pa.performer.id,
            name: pa.performer.name,
            gender: pa.performer.gender,
            image: pa.performer.images?.[0]?.url ?? null,
            as: pa.as,
        })),
        tags: (s.tags ?? []).map((t) => ({
            stashId: t.id,
            name: t.name,
        })),
        images: s.images ?? [],
    };
}

// Currently-trending StashDB scenes — second discovery seed.
// `sort: TRENDING` is the same query stashdb.org's homepage
// "Trending scenes" section uses; ranks by recent activity
// (favourites, edits, views). No date filter — trending is its
// own signal, and a much-favourited older scene still counts.
const TRENDING_DISCOVERY_PER_PAGE = 30;

// Fetch every StashDB scene for a single performer (paginated).
// Used by:
//   - StashDB-only profile (scenes panel for a performer the user
//     hasn't added to their library yet — there's no local data,
//     so this is the only source).
//   - Library profile mix-in (after fetching the user's library
//     scenes for the same performer, we pull their StashDB list,
//     subtract the owned set, and surface the rest as "Add to
//     library" cards alongside the library scenes).
// "Trending" / most-recently-active female performers — mirrors
// stashdb.org/performers?dir=desc&gender=female&sort=last_scene
// which is StashDB's recommendation surface for "who's making
// new content right now." Powers the Discover Performers bubble
// row at the top of Explore.
const QUERY_TRENDING_PERFORMERS = /* GraphQL */ `
    query QueryTrendingPerformers($input: PerformerQueryInput!) {
        queryPerformers(input: $input) {
            count
            performers {
                id
                name
                gender
                birth_date
                images {
                    url
                }
                scene_count
            }
        }
    }
`;

export interface StashDBTrendingPerformer {
    id: string;
    name: string;
    gender: string | null;
    birthDate: string | null;
    image: string | null;
    sceneCount: number;
}

export async function getTrendingStashDBPerformers(
    apiKey: string,
    perPage: number = 30,
    genders: ReadonlyArray<string> = ["FEMALE"],
): Promise<StashDBTrendingPerformer[]> {
    if (genders.length === 0) return [];
    // queryPerformers takes a single `gender` enum (or omitted for
    // all). Fire one request per selected gender in parallel and
    // dedupe by id. Interleave to keep early slots gender-balanced
    // rather than dumping one gender's entire page first — Explore's
    // Discover row reads better with mixed leading bubbles.
    const perGender = await Promise.all(
        genders.map(async (gender) => {
            try {
                const data = await postStashDB<{
                    queryPerformers: {
                        count: number;
                        performers: {
                            id: string;
                            name: string;
                            gender: string | null;
                            birth_date: string | null;
                            images: { url: string }[];
                            scene_count: number;
                        }[];
                    };
                }>(apiKey, QUERY_TRENDING_PERFORMERS, {
                    input: {
                        gender,
                        sort: "LAST_SCENE",
                        direction: "DESC",
                        page: 1,
                        per_page: perPage,
                    },
                });
                return data?.queryPerformers?.performers ?? [];
            } catch (err) {
                console.warn(
                    `[binge] trending performers fetch for ${gender} failed`,
                    err,
                );
                return [];
            }
        }),
    );
    const seen = new Set<string>();
    const merged: StashDBTrendingPerformer[] = [];
    // Round-robin across gender buckets so each gender gets a fair
    // shot at the front of the row. Stop once we've filled perPage.
    const maxLen = Math.max(...perGender.map((g) => g.length), 0);
    for (let i = 0; i < maxLen && merged.length < perPage; i++) {
        for (const bucket of perGender) {
            const p = bucket[i];
            if (!p || seen.has(p.id)) continue;
            seen.add(p.id);
            merged.push({
                id: p.id,
                name: p.name,
                gender: p.gender ?? null,
                birthDate: p.birth_date ?? null,
                image: p.images?.[0]?.url ?? null,
                sceneCount: p.scene_count,
            });
            if (merged.length >= perPage) break;
        }
    }
    return merged;
}

export async function getStashDBScenesForPerformer(
    performerStashId: string,
    apiKey: string,
    perPage: number = 100,
    maxPages: number = 5,
): Promise<StashDBScene[]> {
    const out: StashDBScene[] = [];
    let page = 1;
    while (page <= maxPages) {
        const data = await postStashDB<{
            queryScenes: { scenes: RawStashDBScene[] };
        }>(apiKey, QUERY_SCENES, {
            input: {
                performers: {
                    value: [performerStashId],
                    modifier: "INCLUDES",
                },
                sort: "DATE",
                direction: "DESC",
                page,
                per_page: perPage,
            },
        });
        if (!data?.queryScenes?.scenes) break;
        for (const s of data.queryScenes.scenes) out.push(shapeScene(s));
        if (data.queryScenes.scenes.length < perPage) break;
        page++;
    }
    return out;
}

export async function getTrendingStashDBScenes(
    apiKey: string,
): Promise<StashDBScene[]> {
    const data = await postStashDB<{
        queryScenes: { scenes: RawStashDBScene[] };
    }>(apiKey, QUERY_TRENDING_SCENES, {
        input: {
            sort: "TRENDING",
            direction: "DESC",
            page: 1,
            per_page: TRENDING_DISCOVERY_PER_PAGE,
        },
    });
    if (!data?.queryScenes?.scenes) return [];
    return data.queryScenes.scenes.map(shapeScene);
}

export async function getNewStashDBScenesForPerformers(
    performerStashIds: string[],
    sinceIsoDate: string,
    apiKey: string,
): Promise<StashDBScene[]> {
    if (performerStashIds.length === 0) return [];
    const merged: StashDBScene[] = [];
    for (let i = 0; i < performerStashIds.length; i += PERFORMER_BATCH_SIZE) {
        const batch = performerStashIds.slice(i, i + PERFORMER_BATCH_SIZE);
        const scenes = await fetchStashDBScenesBatch(
            apiKey,
            batch,
            sinceIsoDate,
        );
        merged.push(...scenes);
    }
    // Dedupe by id (a scene with two of our performers shows up in two
    // batches).
    const seen = new Set<string>();
    return merged.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
    });
}

// ── 12h cache ───────────────────────────────────────────────────────

// v4: performers now include scene_count for the "most popular"
// poster fallback. Old v3 entries lack the field, so reads should
// return null and force a refetch.
const CACHE_PREFIX = "binge.stashdb.newScenes.";
const CACHE_KEY = CACHE_PREFIX + "v4";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

interface CacheEntry {
    sinceIsoDate: string;
    fetchedAt: number;
    scenes: StashDBScene[];
}

export function readStashDBCache(sinceIsoDate: string): StashDBScene[] | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const entry = JSON.parse(raw) as CacheEntry;
        if (entry.sinceIsoDate !== sinceIsoDate) return null;
        // Valid JSON is not the same as our JSON. A truncated or
        // hand-edited entry parses fine and then hands the caller
        // something it iterates, so the stories row dies with a
        // TypeError until the cache happens to be invalidated.
        if (!Array.isArray(entry.scenes)) return null;
        const age = Date.now() - entry.fetchedAt;
        // Negative age means the entry claims to be from the future,
        // which happens when the clock moves backwards. Treat it as
        // stale rather than valid until the clock catches up.
        if (age < 0 || age > CACHE_TTL_MS) return null;
        return entry.scenes;
    } catch {
        return null;
    }
}

// Drop entries written by older versions of this cache. The version
// lives in the key, so a bumped version silently orphans the previous
// payload instead of replacing it: those are hundreds of KB of scenes
// each, they are never read again, and they count against the origin's
// quota. Once that quota is reached the write below fails, and it fails
// silently, so the cache simply stops working.
function pruneOldCacheVersions(): void {
    try {
        const stale: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(CACHE_PREFIX) && key !== CACHE_KEY) {
                stale.push(key);
            }
        }
        for (const key of stale) localStorage.removeItem(key);
    } catch {
        /* storage unavailable — nothing to prune */
    }
}

export function writeStashDBCache(
    sinceIsoDate: string,
    scenes: StashDBScene[],
): void {
    pruneOldCacheVersions();
    try {
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                sinceIsoDate,
                fetchedAt: Date.now(),
                scenes,
            } satisfies CacheEntry),
        );
    } catch {
        /* quota etc — ignore */
    }
}

export function invalidateStashDBCache(): void {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch {
        /* ignore */
    }
    // The owned-ids memo is part of the same picture: a refresh that
    // left it in place would keep hiding scenes the user has since
    // added, or keep offering ones they have.
    invalidateOwnedStashDBSceneIds();
}

// ── Performers for already-matched scenes ───────────────────────────
//
// A scene in the library with a StashDB stash_id but no performers
// linked locally still has knowable performers: StashDB has them, they
// just are not in this library. This is how such a scene gets a poster
// instead of being an anonymous file.
//
// Batched with GraphQL aliases (one request per BATCH_SIZE ids) because
// the feed can ask about hundreds at once, and cached in localStorage
// because a StashDB scene's cast does not change. Home is already slow
// to first paint; this must not add a round-trip per card.

export interface MatchedScenePerformer {
    stashId: string;
    name: string;
    gender: string | null;
    image: string | null;
}

const SCENE_PERFORMERS_CACHE_KEY = "binge.stashdb.scenePerformers.v1";
// Ids per request. StashDB is a shared community service, so this
// trades a slightly larger document for far fewer requests.
const SCENE_PERFORMERS_BATCH = 20;
// Ceiling per feed load. Set at 200 when the batches ran one after
// another and every one of them was on the critical path; that left 426
// of this library's 626 matched scenes falling back to a studio name on
// a cold cache, which is the wrong answer for a card whose whole purpose
// is to say who is in it. The batches now run together, so the ceiling
// only has to stop a runaway, not pay for latency.
const SCENE_PERFORMERS_MAX_FETCH = 1500;

type PerformerCache = Record<string, MatchedScenePerformer[]>;

function readScenePerformerCache(): PerformerCache {
    try {
        const raw = localStorage.getItem(SCENE_PERFORMERS_CACHE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return parsed as PerformerCache;
    } catch {
        return {};
    }
}

function writeScenePerformerCache(cache: PerformerCache): void {
    try {
        localStorage.setItem(SCENE_PERFORMERS_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // Quota. The lookups still worked for this session; they will
        // just be repeated next time.
    }
}

// A stash id is a UUID, but it arrives from Stash's database rather
// than from us, so it is checked before being spliced into a GraphQL
// document as an alias.
const STASH_ID_SHAPE = /^[0-9a-f-]{8,64}$/i;

export async function getMatchedScenePerformers(
    sceneStashIds: readonly string[],
    apiKey: string,
): Promise<Map<string, MatchedScenePerformer[]>> {
    const cache = readScenePerformerCache();
    const out = new Map<string, MatchedScenePerformer[]>();
    const missing: string[] = [];
    for (const id of sceneStashIds) {
        if (!STASH_ID_SHAPE.test(id)) continue;
        const hit = cache[id];
        if (hit) out.set(id, hit);
        else if (!missing.includes(id)) missing.push(id);
    }
    if (missing.length === 0) return out;

    const toFetch = missing.slice(0, SCENE_PERFORMERS_MAX_FETCH);
    const chunks: string[][] = [];
    for (let i = 0; i < toFetch.length; i += SCENE_PERFORMERS_BATCH) {
        chunks.push(toFetch.slice(i, i + SCENE_PERFORMERS_BATCH));
    }
    let changed = false;
    // Together rather than one after another. The browser caps how many
    // reach StashDB at once anyway, and sequentially this was the
    // difference between a fraction of a second and several.
    await Promise.all(
        chunks.map(async (chunk) => {
            const query = `query BatchScenePerformers {
${chunk
    .map(
        (id, n) => `  s${n}: findScene(id: "${id}") {
    performers { performer { id name gender images { url } } }
  }`,
    )
    .join("\n")}
}`;
            const data = await postStashDB<
                Record<
                    string,
                    {
                        performers: {
                            performer: {
                                id: string;
                                name: string;
                                gender: string | null;
                                images: { url: string }[];
                            };
                        }[];
                    } | null
                >
            >(apiKey, query, {});
            // An outage leaves whatever is cached in place and this
            // chunk unanswered; the next load retries it.
            if (!data) return;
            chunk.forEach((id, n) => {
                const scene = data[`s${n}`];
                // A null scene means StashDB no longer has it. Cached as an
                // empty list so it is not asked for again every load.
                const performers = (scene?.performers ?? []).map((pa) => ({
                    stashId: pa.performer.id,
                    name: pa.performer.name,
                    gender: pa.performer.gender,
                    image: pa.performer.images?.[0]?.url ?? null,
                }));
                cache[id] = performers;
                out.set(id, performers);
                changed = true;
            });
        }),
    );
    if (changed) writeScenePerformerCache(cache);
    return out;
}

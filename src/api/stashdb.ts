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
        const p: Promise<Set<string>> = fetchOwnedStashDBSceneIds().catch(
            (err) => {
                // Never cache a failure: the next caller should retry.
                // Only clear the slot if it still holds THIS promise -
                // clearing unconditionally let a slow failure discard a
                // newer in-flight fetch that had already replaced it,
                // so one answer cost three runs of the most expensive
                // query binge makes.
                if (ownedIdsPromise === p) ownedIdsPromise = null;
                throw err;
            },
        );
        ownedIdsPromise = p;
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
            // fetch strips Authorization and Cookie across an origin
            // change but re-sends a custom header, and the key rides on
            // one. A 30x from stashdb.org - a CDN move, an operator
            // slip, a hijacked record - would deliver the user's StashDB
            // key to wherever it pointed. There is no legitimate
            // redirect on this endpoint.
            redirect: "error",
            // A request with no deadline can leave a caller waiting
            // forever, and one of them renders a loading skeleton while
            // it does. StashDB is a third party on the open internet;
            // it does not owe us a reply. 25s is well past its slowest
            // observed answer and well short of a user giving up.
            signal: AbortSignal.timeout(25_000),
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
            // But keep the data when there is any.
            //
            // GraphQL partial success is ordinary, and the batched cast
            // document asks for twenty scenes in one request under
            // aliases. Discarding the whole response because one alias
            // errored threw away the nineteen good answers beside it -
            // and since nothing was then cached, the same request was
            // reissued and rediscarded on every feed load, forever. One
            // bad stash_id in the library was enough. Per-alias nulls
            // are already handled downstream.
            if (body.data == null) return null;
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
// null means the fetch failed, [] means StashDB genuinely has nothing
// new. The caller writes this into a 12-hour cache, so confusing the two
// pins an outage in place: one 502, or one answer slower than the 25s
// abort, and the stories row reports no new releases for half a day.
// The cache reads [] back as a valid hit, so reloading does not help
// either - only the explicit refresh button clears it.
async function fetchStashDBScenesBatch(
    apiKey: string,
    performerStashIds: string[],
    sinceIsoDate: string,
): Promise<StashDBScene[] | null> {
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
        // Distinguishes "no more pages" from "we never got an answer".
        // postStashDB returns null for a non-2xx, a GraphQL error, a
        // parse failure or the abort, and this used to break out of the
        // loop and hand back whatever it had - which for a failure on
        // page one is an empty list.
        if (data == null) return null;
        if (!data.queryScenes?.scenes) break;
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
        // Filtered, like shapeScene and getMatchedScenePerformers. This
        // was the third copy of the same shape and the only one still
        // unguarded: StashDB returns appearances orphaned by an edit,
        // where the join row exists with no performer on it. The throw
        // is caught by the Add Scene modal, which then proceeds with a
        // null detail and silently creates a bare stub in Stash - no
        // performers, no studio, no date, no urls.
        performers: (s.performers ?? [])
            .filter((pa) => pa && pa.performer)
            .map((pa) => ({
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
    // Ask once, without a gender, and sort the answer out here.
    //
    // queryPerformers takes a single gender enum, so this used to fire
    // one request per selected gender. That is up to six, and the
    // gender filter is the expensive part of this query on StashDB's
    // side: measured against the live endpoint, a filtered page takes
    // between 6 and 19 seconds while the same query without one takes
    // about 1.5. Since the row cannot render until the slowest of them
    // lands, the whole thing sat on skeletons for twenty seconds and
    // people reasonably concluded it was broken.
    //
    // One unfiltered page, filtered here, is the same answer an order
    // of magnitude faster. Ask for more rows than we need so there is
    // something left after filtering.
    const wide = await postStashDB<{
        queryPerformers: {
            performers: TrendingRow[];
        };
    }>(apiKey, QUERY_TRENDING_PERFORMERS, {
        input: {
            sort: "LAST_SCENE",
            direction: "DESC",
            page: 1,
            per_page: Math.max(perPage * 3, 90),
        },
    });
    const allowed = new Set(genders);
    const wideRows = (wide?.queryPerformers?.performers ?? []).filter(
        (r) => r.gender != null && allowed.has(r.gender),
    );
    // Enough to work with, which is the usual case. A narrow gender
    // selection can come up short here, because an unfiltered page is
    // mostly the commonest gender, and only then is it worth paying
    // for the per-gender queries below.
    if (wideRows.length >= Math.min(perPage, 12)) {
        return interleaveByGender(wideRows, genders, perPage);
    }
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
    return interleaveRows(perGender, perPage);
}

/// One row as StashDB returns it.
interface TrendingRow {
    id: string;
    name: string;
    gender: string | null;
    birth_date: string | null;
    images: { url: string }[];
    scene_count: number;
}

/// Split a mixed list into per-gender buckets, then interleave. Keeps
/// the front of the row mixed instead of leading with a run of the
/// commonest gender, which is what an unfiltered page arrives as.
function interleaveByGender(
    rows: TrendingRow[],
    genders: ReadonlyArray<string>,
    perPage: number,
): StashDBTrendingPerformer[] {
    const buckets = genders.map((g) => rows.filter((r) => r.gender === g));
    return interleaveRows(buckets, perPage);
}

/// Round-robin across buckets so each gender gets a fair shot at the
/// front of the row. Stops once perPage is filled.
function interleaveRows(
    buckets: TrendingRow[][],
    perPage: number,
): StashDBTrendingPerformer[] {
    const seen = new Set<string>();
    const merged: StashDBTrendingPerformer[] = [];
    const maxLen = Math.max(...buckets.map((g) => g.length), 0);
    for (let i = 0; i < maxLen && merged.length < perPage; i++) {
        for (const bucket of buckets) {
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

// null when any batch failed, so the caller can decline to cache a
// partial or empty answer as if it were the whole truth.
export async function getNewStashDBScenesForPerformers(
    performerStashIds: string[],
    sinceIsoDate: string,
    apiKey: string,
): Promise<StashDBScene[] | null> {
    if (performerStashIds.length === 0) return [];
    const merged: StashDBScene[] = [];
    for (let i = 0; i < performerStashIds.length; i += PERFORMER_BATCH_SIZE) {
        const batch = performerStashIds.slice(i, i + PERFORMER_BATCH_SIZE);
        const scenes = await fetchStashDBScenesBatch(
            apiKey,
            batch,
            sinceIsoDate,
        );
        // One failed batch makes the whole answer partial. Caching a
        // partial as complete is what pins an outage in place.
        if (scenes == null) return null;
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
        // The elements too, not just the array. The comment above is
        // right about the danger and stops one level short: a scene
        // whose performers field is not iterable throws in the story
        // builder exactly the same way, and the row then stays broken
        // for the whole TTL.
        if (
            !entry.scenes.every(
                (sc) =>
                    !!sc &&
                    typeof sc === "object" &&
                    typeof (sc as { id?: unknown }).id === "string" &&
                    (sc.performers === undefined ||
                        (Array.isArray(sc.performers) &&
                            // And the elements of THAT array. Checking
                            // only the array left performers: [null]
                            // valid, which throws in the story builder
                            // the moment it reads sp.id - the same
                            // failure one level deeper, and it stayed
                            // broken for the whole TTL.
                            // `id`, which is the field the story
                            // builder reads and shapeScene writes.
                            // Asking for `stashId` - a field this type
                            // does not have - meant EVERY cached entry
                            // holding a scene with a performer failed
                            // validation and was thrown away, so the
                            // 12-hour cache never hit once: a full
                            // batched StashDB fetch on every mount,
                            // settings toggle and lookback change. The
                            // tests could not see it because every
                            // fixture is `[{ id: "a" }]` with no
                            // performers, which short-circuits above.
                            sc.performers.every(
                                (sp) =>
                                    !!sp &&
                                    typeof sp === "object" &&
                                    typeof (sp as { id?: unknown }).id ===
                                        "string",
                            ))),
            )
        ) {
            return null;
        }
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
    // And the matched-cast cache.
    //
    // It has no TTL, and an empty result is recorded so the scene is not
    // asked for again - which is right for a scene StashDB has really
    // dropped, and permanent for one that merely failed to resolve
    // during a reindex or a merge. Nothing anywhere cleared this key, so
    // a card fell back to its studio name forever and no user action
    // short of clearing site data could recover it. Refresh is exactly
    // the action that should.
    try {
        localStorage.removeItem(SCENE_PERFORMERS_CACHE_KEY);
    } catch {
        /* ignore */
    }
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

// Entries as well as the container.
//
// Checking only the shape of the top level and casting the values let a
// single bad entry, from a co-resident plugin or a hand edit, throw
// inside the feed builder. That error is caught and shown as a failed
// Home feed, and because this cache had no version key, no TTL and no
// invalidator anywhere, reloading read the same value back: the feed
// stayed broken until the user cleared site data by hand. A cache is
// only worth having if a bad entry costs a refetch rather than the
// feature.
function isPerformerList(v: unknown): v is MatchedScenePerformer[] {
    return (
        Array.isArray(v) &&
        v.every(
            (p) =>
                !!p &&
                typeof p === "object" &&
                // stashId, not id. MatchedScenePerformer has no `id`
                // field, so checking for one rejected every real entry
                // and made the cache write-only: the batches it exists
                // to avoid ran on every single load.
                typeof (p as { stashId?: unknown }).stashId === "string" &&
                typeof (p as { name?: unknown }).name === "string",
        )
    );
}

function readScenePerformerCache(): PerformerCache {
    try {
        const raw = localStorage.getItem(SCENE_PERFORMERS_CACHE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        const out: PerformerCache = {};
        for (const [id, value] of Object.entries(parsed)) {
            if (isPerformerList(value)) out[id] = value;
        }
        return out;
    } catch {
        return {};
    }
}

// Cast so the cache cannot grow until the origin's storage quota is
// gone. Up to SCENE_PERFORMERS_MAX_FETCH entries could be added per
// feed load with nothing ever removed, and once the quota filled, every
// other setItem on Stash's origin began failing: this plugin's other
// caches, its interaction ring, and Stash's own keys. All of those
// swallow the error, so the symptom was several unrelated features
// quietly ceasing to persist anything.
const SCENE_PERFORMERS_CACHE_MAX = 4000;

function writeScenePerformerCache(cache: PerformerCache): void {
    try {
        let toStore = cache;
        const ids = Object.keys(cache);
        if (ids.length > SCENE_PERFORMERS_CACHE_MAX) {
            // Object key order is insertion order for string keys, so
            // the oldest entries are at the front. Nothing here records
            // access times, and inventing one to evict more cleverly is
            // not worth a localStorage cache: keeping the most recent
            // window is enough.
            toStore = {};
            for (const id of ids.slice(
                ids.length - SCENE_PERFORMERS_CACHE_MAX,
            )) {
                toStore[id] = cache[id];
            }
        }
        localStorage.setItem(
            SCENE_PERFORMERS_CACHE_KEY,
            JSON.stringify(toStore),
        );
    } catch {
        // Quota, despite the cap. Drop the cache rather than leaving a
        // full one that can never be written to again; the lookups
        // still worked for this session.
        try {
            localStorage.removeItem(SCENE_PERFORMERS_CACHE_KEY);
        } catch {
            /* nothing further to try */
        }
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
    // A few at a time rather than all of them.
    //
    // This was Promise.all over every chunk, and the comment claimed the
    // browser caps how many reach StashDB at once - over HTTP/2 to one
    // origin the cap is around a hundred streams, so it did not bind
    // here. A cold cache on a large library meant 1500 ids in 75 chunks
    // hitting a shared community service in one burst, from a browser.
    // Throttled answers come back as nulls, nothing is cached, and the
    // identical burst repeats on the next load.
    const CHUNK_CONCURRENCY = 5;
    const runChunk = async (chunk: string[]) => {
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
            // Filtered the way shapeScene does a few hundred lines
            // up, and for the reason its comment gives: StashDB
            // returns scenes whose performer appearances have been
            // orphaned by an edit, so the join row exists with no
            // performer on it. Unguarded, one such record threw
            // inside this Promise.all, which is on the Home feed's
            // critical path with no catch of its own - the whole
            // feed showed an error, and because the throw happened
            // before the cache write, every reload fetched the same
            // record and threw again.
            const performers = (scene?.performers ?? [])
                .filter((pa) => pa && pa.performer)
                .map((pa) => ({
                    stashId: pa.performer.id,
                    name: pa.performer.name,
                    gender: pa.performer.gender,
                    image: pa.performer.images?.[0]?.url ?? null,
                }));
            cache[id] = performers;
            out.set(id, performers);
            changed = true;
        });
    };
    let nextChunk = 0;
    await Promise.all(
        Array.from(
            { length: Math.min(CHUNK_CONCURRENCY, chunks.length) },
            async () => {
                for (;;) {
                    const i = nextChunk++;
                    if (i >= chunks.length) return;
                    await runChunk(chunks[i]);
                }
            },
        ),
    );
    if (changed) writeScenePerformerCache(cache);
    return out;
}

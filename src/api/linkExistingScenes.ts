import { gql } from "./graphql";
import { getStashDBScenesForPerformer, getStashDBBox } from "./stashdb";

// Attaching a newly-followed performer to the scenes you already have.
//
// Following someone creates a local performer in Stash with a stash_ids
// link back to StashDB, and nothing else. Scenes already in the library
// that feature her are not touched, so her brand new profile reports
// zero scenes even when the library holds several - which reads as the
// follow having failed.
//
// The link that makes this possible is the one binge already relies on
// everywhere else: a scene matched to StashDB carries a stashdb.org
// entry in its own stash_ids. So the question "which of my scenes are
// hers" has an exact answer - the intersection of her StashDB scenes
// with the StashDB scenes this library owns - and needs no name
// matching or guessing.
//
// Deliberately additive. Every write appends her to the scene's existing
// performers and never removes anyone, and the list it appends to is
// read immediately before the write rather than taken from the scan
// below, because sceneUpdate replaces the whole performer_ids array and
// a scan is a snapshot.

const STASHDB_ENDPOINT = "https://stashdb.org/graphql";

// Local scenes carrying a stashdb.org stash_id, with the ids themselves.
// The sibling scan in stashdb.ts selects only the stash_ids because all
// it needs is a membership set; this one needs the local id to write to.
const FIND_LOCAL_STASHDB_SCENES = /* GraphQL */ `
    query FindLocalStashDBScenes {
        findScenes(
            scene_filter: {
                stash_id_endpoint: {
                    endpoint: "https://stashdb.org/graphql"
                    modifier: NOT_NULL
                }
            }
            filter: { page: 1, per_page: -1 }
        ) {
            scenes {
                id
                stash_ids {
                    endpoint
                    stash_id
                }
            }
        }
    }
`;

// ADD, not SET, and one request for the whole set.
//
// This used to read each scene's performers and write the list back with
// her appended. That is correct within one pass and wrong across two:
// following one performer and then a co-star a moment later put two
// loops in flight, the second read a scene before the first's write
// landed, and its whole-array write removed the first performer again -
// from every scene the two share, silently, with both passes reporting
// success.
//
// bulkSceneUpdate with mode ADD is resolved by Stash against the row it
// is updating, so there is no read to be stale, no array to overwrite,
// and nothing to serialise. Verified against the live schema:
// BulkUpdateIds { ids, mode } with modes SET, ADD, REMOVE.
const SCENES_ADD_PERFORMER = /* GraphQL */ `
    mutation ScenesAddPerformer($ids: [ID!], $performerId: ID!) {
        bulkSceneUpdate(
            input: {
                ids: $ids
                performer_ids: { ids: [$performerId], mode: ADD }
            }
        ) {
            id
        }
    }
`;

export interface LinkExistingScenesResult {
    /// How many of the library's StashDB-matched scenes are hers.
    matched: number;
    /// How many the update covered. Equal to `matched` on success,
    /// since ADD is idempotent - a scene that already lists her is
    /// unchanged rather than counted separately.
    linked: number;
    /// True when the update itself failed, so nothing was written.
    /// Distinct from `matched: 0`, which means she has no scenes here.
    failed: boolean;
    /// True when StashDB could not be reached, so the candidate set is
    /// unknown rather than empty.
    lookupFailed: boolean;
}

/// Attach a just-followed performer to the scenes the library already
/// holds for her. Never removes anyone from anything.
export async function linkExistingScenesToPerformer(args: {
    localPerformerId: string;
    stashDBPerformerId: string;
}): Promise<LinkExistingScenesResult> {
    const empty: LinkExistingScenesResult = {
        matched: 0,
        linked: 0,
        failed: false,
        lookupFailed: false,
    };

    const box = await getStashDBBox();
    if (!box) return { ...empty, lookupFailed: true };

    // Her scenes, as StashDB knows them.
    let hers;
    try {
        hers = await getStashDBScenesForPerformer(
            args.stashDBPerformerId,
            box.api_key,
        );
    } catch {
        return { ...empty, lookupFailed: true };
    }
    // An empty answer here is ambiguous: getStashDBScenesForPerformer
    // breaks out of its pager on a failed request and returns what it
    // has, so nothing distinguishes "she has none" from "StashDB was
    // unreachable". Reported as a lookup failure so the caller does not
    // tell the user she has no scenes when nobody knows.
    if (hers.length === 0) return { ...empty, lookupFailed: true };
    const hersById = new Set(hers.map((s) => s.id));

    // The library's StashDB-matched scenes.
    let local;
    try {
        local = await gql<{
            findScenes: {
                scenes: {
                    id: string;
                    stash_ids: { endpoint: string; stash_id: string }[];
                }[];
            };
        }>(FIND_LOCAL_STASHDB_SCENES);
    } catch {
        return { ...empty, lookupFailed: true };
    }

    const candidates: string[] = [];
    for (const sc of local.findScenes.scenes) {
        const isHers = sc.stash_ids.some(
            (sid) =>
                sid.endpoint === STASHDB_ENDPOINT && hersById.has(sid.stash_id),
        );
        if (isHers) candidates.push(sc.id);
    }
    if (candidates.length === 0) return empty;

    try {
        await gql(SCENES_ADD_PERFORMER, {
            ids: candidates,
            performerId: args.localPerformerId,
        });
    } catch (err) {
        // Logged, because a silent count of zero is exactly what made
        // this invisible before.
        console.warn("[binge] linking existing scenes failed", err);
        return {
            matched: candidates.length,
            linked: 0,
            failed: true,
            lookupFailed: false,
        };
    }
    return {
        matched: candidates.length,
        linked: candidates.length,
        failed: false,
        lookupFailed: false,
    };
}

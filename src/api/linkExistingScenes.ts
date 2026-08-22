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

const FIND_SCENE_PERFORMERS = /* GraphQL */ `
    query FindScenePerformers($id: ID!) {
        findScene(id: $id) {
            id
            performers {
                id
            }
        }
    }
`;

const SCENE_SET_PERFORMERS = /* GraphQL */ `
    mutation SceneSetPerformers($id: ID!, $performer_ids: [ID!]) {
        sceneUpdate(input: { id: $id, performer_ids: $performer_ids }) {
            id
        }
    }
`;

export interface LinkExistingScenesResult {
    /// How many of the library's StashDB-matched scenes are hers.
    matched: number;
    /// How many this run attached her to.
    linked: number;
    /// How many already had her, so needed nothing.
    alreadyLinked: number;
    /// Scenes that could not be read or written; left untouched.
    failed: number;
}

// One at a time. These are whole-array writes against scenes that may
// also be open in another tab or on the phone, and the whole point of
// this pass is that it is unattended - a burst is not worth the risk of
// racing something else the user is doing.
async function attach(
    sceneId: string,
    performerId: string,
): Promise<"linked" | "already" | "failed"> {
    try {
        // Read now, not from the scan. sceneUpdate replaces the whole
        // performer_ids array, so anything added since the scan would
        // be erased by writing a list built from it.
        const live = await gql<{
            findScene: { id: string; performers: { id: string }[] } | null;
        }>(FIND_SCENE_PERFORMERS, { id: sceneId });
        const scene = live.findScene;
        // Fail closed: a scene we cannot read is one we must not write.
        // Treating a missing scene as one with no performers would
        // replace its cast with just her.
        if (!scene) return "failed";
        const existing = scene.performers.map((p) => p.id);
        if (existing.includes(performerId)) return "already";
        await gql(SCENE_SET_PERFORMERS, {
            id: sceneId,
            performer_ids: [...existing, performerId],
        });
        return "linked";
    } catch {
        return "failed";
    }
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
        alreadyLinked: 0,
        failed: 0,
    };

    const box = await getStashDBBox();
    if (!box?.api_key) return empty;

    // Her scenes, as StashDB knows them.
    const hers = await getStashDBScenesForPerformer(
        args.stashDBPerformerId,
        box.api_key,
    );
    if (hers.length === 0) return empty;
    const hersById = new Set(hers.map((s) => s.id));

    // The library's StashDB-matched scenes.
    const local = await gql<{
        findScenes: {
            scenes: {
                id: string;
                stash_ids: { endpoint: string; stash_id: string }[];
            }[];
        };
    }>(FIND_LOCAL_STASHDB_SCENES);

    const candidates: string[] = [];
    for (const s of local.findScenes.scenes) {
        const isHers = s.stash_ids.some(
            (sid) =>
                sid.endpoint === STASHDB_ENDPOINT && hersById.has(sid.stash_id),
        );
        if (isHers) candidates.push(s.id);
    }

    const out: LinkExistingScenesResult = {
        matched: candidates.length,
        linked: 0,
        alreadyLinked: 0,
        failed: 0,
    };
    for (const sceneId of candidates) {
        const r = await attach(sceneId, args.localPerformerId);
        if (r === "linked") out.linked++;
        else if (r === "already") out.alreadyLinked++;
        else out.failed++;
    }
    return out;
}

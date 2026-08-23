import type { PackFeedItem } from "./useFeed";

/// Hand a pack off to the reel, starting at one scene.
///
/// Shared so the card's mosaic and this sheet cannot drift: the mosaic
/// used to put ONE onClick on the whole grid, so tapping tile five
/// opened the sheet rather than scene five - while the iOS twin passed
/// the tile actually tapped and left a comment saying it had fixed
/// exactly this. Two clients showing the same nine covers should not
/// disagree about what tapping one does.
export function openPackAtScene(
    tab: {
        setTab: (t: "foryou") => void;
        setPinFirstSceneId: (id: string | null) => void;
        setPinnedQueue: (q: { ids: string[]; startIndex: number }) => void;
    },
    pack: PackFeedItem,
    sceneId: string,
) {
    // Same handoff pattern Home's "Watch full scene" uses - pin the
    // tapped scene as slot N of the queued list, so the reel starts at
    // the tap target and walks the rest of the pack in order.
    const ids = pack.scenes.map((s) => s.sceneId);
    const startIndex = Math.max(0, ids.indexOf(sceneId));
    // Clear any stale single-scene pin - the reel consumes the queue
    // here, and a leftover pin would otherwise resurface in chained
    // mode. Mirrors SceneFeedCard's "Watch full scene" handoff.
    tab.setPinFirstSceneId(null);
    tab.setPinnedQueue({ ids, startIndex });
    tab.setTab("foryou");
}

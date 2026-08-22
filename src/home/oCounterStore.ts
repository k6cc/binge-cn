// Session memory for o-counts the user has changed.
//
// The feed is virtualized, so a card that scrolls a few rows away is
// unmounted and its state destroyed. Seeding from the scene row fixes
// the empty-heart-on-a-scene-that-has-twelve case, but not this one: the
// row carries the count as it was when the feed was FETCHED, so a like
// made since is forgotten on the next remount and the heart shows the
// old number. Tapping again then increments the scene a second time.
//
// Only server-confirmed values are recorded here - the number Stash
// returned from the increment, never the optimistic guess - so a failed
// write leaves nothing behind.
//
// Deliberately module-level rather than context: the reel and the feed
// are both mounted at once (the tab panes use display:none, not
// unmount), and they must not disagree about the same scene.

const counts = new Map<string, number>();

export function rememberOCount(sceneId: string, value: number): void {
    counts.set(sceneId, value);
}

/// The count to show: what the user has done this session if anything,
/// otherwise what the library said when the feed was fetched.
export function currentOCount(sceneId: string, fromLibrary: number): number {
    return counts.get(sceneId) ?? fromLibrary;
}

export function forgetOCounts(): void {
    counts.clear();
}

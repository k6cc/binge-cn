// Matching for the settings filter box, and the rule that decides which
// descriptions are too long to show in full.
//
// Kept out of the component so both can be tested without a DOM, and so
// the "is this long" threshold is one number in one place rather than a
// judgement made per row.

// Above this many characters a description is folded behind "More".
//
// Measured against the copy that exists: at 430px, the phone width binge
// is mostly used at, a description of this length runs to about three
// lines. Two thirds of the page's descriptions are longer than that, and
// several run past fifty words, which is what turned a list of twenty
// settings into six screens of grey prose.
export const LONG_DESCRIPTION_CHARS = 150;

export function isLongDescription(description: string): boolean {
    return description.length > LONG_DESCRIPTION_CHARS;
}

/// Does this setting match what was typed?
///
/// Every whitespace-separated term has to appear somewhere in the
/// haystack, so "blur screen" finds the privacy setting whether the
/// words are typed in that order or not. Case and surrounding
/// punctuation are ignored.
export function matchesSettingQuery(haystack: string, query: string): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const hay = haystack.toLowerCase();
    return terms.every((t) => hay.includes(t));
}

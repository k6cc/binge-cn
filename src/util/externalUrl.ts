// The one rule for opening a URL that came from somewhere else.
//
// `javascript:` and `data:` URLs run in the origin that opens them, and
// binge runs inside Stash with the user's session, so a link out of a
// performer's website field or a daemon response is not something to
// hand to `window.open` as given. The performer-links strip has done
// this correctly since it was written; this is the same rule, extracted
// so the other callers can share it rather than each remembering.
//
// `noopener` happens to stop `javascript:` in current browsers, because
// the new context gets an opaque origin. That is a property of the
// browser rather than a decision made here, and it disappears the
// moment a call site moves to an anchor or drops the flag.

/// The URL to open, or null if it should not be opened at all.
export function safeExternalUrl(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Parse rather than pattern-match, so that a scheme hidden behind
    // whitespace, control characters or case is still seen for what it
    // is. A relative URL resolves against the page, which is Stash's
    // own origin and therefore fine.
    let parsed: URL;
    try {
        parsed = new URL(trimmed, window.location.href);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
    }
    return parsed.href;
}

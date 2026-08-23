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
    // Parse rather than pattern-match, so a scheme hidden behind
    // whitespace, control characters or case is still seen for what it
    // is. Parsed WITHOUT a base, so a relative value is rejected rather
    // than quietly resolved against Stash's own origin: these are links
    // out to another site, and a daemon handing back "/settings" should
    // not become a link that acts on the user's Stash.
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
    }
    return parsed.href;
}

// The daemon only knows how to fetch PornHub watch pages, so anything
// else reaching the downloader is a scrape that went wrong rather than
// something to act on.
export function isPornhubHost(raw: string): boolean {
    try {
        const h = new URL(raw).hostname.toLowerCase();
        return h === "pornhub.com" || h.endsWith(".pornhub.com");
    } catch {
        return false;
    }
}

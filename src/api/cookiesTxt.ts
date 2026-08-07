// Netscape cookies.txt parsing, so the cookie step can be a file drop
// instead of a devtools expedition.
//
// binge cannot read these cookies itself: it runs on the Stash origin and
// browsers isolate cookies per origin, so reddit.com's are unreachable —
// and `reddit_session` is httpOnly, so even a bookmarklet on reddit.com
// couldn't see it. Exporting to a file is the user's side of that wall.
//
// Parsing happens in the browser and only the extracted values are sent,
// through the same /config call the manual paste already uses. The file
// itself never goes anywhere, which matters: a cookies.txt exported from a
// browser session usually carries logins for every site you've visited.

export interface ParsedCookies {
    redditSessionCookie?: string;
    xAuthToken?: string;
    xCt0?: string;
    /// Cookies present in the file that binge knows what to do with —
    /// drives the "found X, Y" confirmation.
    found: string[];
    /// Domains seen, for the "we read your file and found nothing useful"
    /// case, which is otherwise indistinguishable from a broken parser.
    domainCount: number;
}

interface Row {
    domain: string;
    name: string;
    value: string;
}

/// Netscape format is tab-separated:
///   domain  includeSubdomains  path  secure  expiry  name  value
/// Lines starting with `#` are comments, EXCEPT the `#HttpOnly_` prefix
/// some exporters put on the domain field — which is exactly the prefix
/// that lands on the cookies we care about, so stripping it is required
/// rather than cosmetic.
function parseRows(text: string): Row[] {
    const rows: Row[] = [];
    for (const raw of text.split(/\r?\n/)) {
        let line = raw.trim();
        if (!line) continue;
        if (line.startsWith("#HttpOnly_")) {
            line = line.slice("#HttpOnly_".length);
        } else if (line.startsWith("#")) {
            continue;
        }
        // Tab-separated by spec; some exporters emit runs of spaces.
        const parts = line.split(/\t+/);
        const fields = parts.length >= 7 ? parts : line.split(/\s{1,}/);
        if (fields.length < 7) continue;
        const domain = fields[0].replace(/^\./, "").toLowerCase();
        const name = fields[5];
        // Values can legitimately contain whitespace-free junk only, but
        // rejoin the tail defensively in case a value held a separator.
        const value = fields.slice(6).join("");
        if (!domain || !name || !value) continue;
        rows.push({ domain, name, value });
    }
    return rows;
}

function hostMatches(domain: string, suffixes: string[]): boolean {
    return suffixes.some((s) => domain === s || domain.endsWith("." + s));
}

export function parseCookiesTxt(text: string): ParsedCookies {
    const rows = parseRows(text);
    const out: ParsedCookies = { found: [], domainCount: 0 };
    out.domainCount = new Set(rows.map((r) => r.domain)).size;

    for (const r of rows) {
        if (
            r.name === "reddit_session" &&
            hostMatches(r.domain, ["reddit.com"])
        ) {
            // The daemon wants a Cookie-header value, not a bare token.
            out.redditSessionCookie = `reddit_session=${r.value}`;
            out.found.push("Reddit session");
        }
        if (hostMatches(r.domain, ["x.com", "twitter.com"])) {
            if (r.name === "auth_token") out.xAuthToken = r.value;
            if (r.name === "ct0") out.xCt0 = r.value;
        }
    }

    // auth_token is useless without ct0, so report the pair or neither
    // rather than half-configuring X and letting it fail later.
    if (out.xAuthToken && out.xCt0) {
        out.found.push("X login");
    } else {
        out.xAuthToken = undefined;
        out.xCt0 = undefined;
    }
    return out;
}

/// Human summary for the UI. Kept here so the copy stays with the rules
/// it describes (notably the auth_token/ct0 pairing).
export function describeParse(p: ParsedCookies): string {
    if (p.found.length > 0) return `Found ${p.found.join(" and ")}.`;
    if (p.domainCount === 0) {
        return "That doesn't look like a cookies.txt file — no cookies found in it.";
    }
    return (
        `Read ${p.domainCount} domain${p.domainCount === 1 ? "" : "s"}, but ` +
        "no Reddit or X login in there. Export while signed in to those " +
        "sites — and for X, both auth_token and ct0 are needed."
    );
}

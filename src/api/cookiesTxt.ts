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
// itself never goes anywhere, which matters: a cookies.txt exported from
// a browser session usually carries logins for every site you've visited.

import i18n from "../i18n/config";

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
        // Tab-separated by spec, one tab per field boundary. Splitting
        // on /\t+/ instead collapses an EMPTY field into its neighbour
        // and shifts every field after it left by one, which drops the
        // line for falling under seven fields. Session cookies hit this
        // every time: they carry no expiry, so field five is empty, and
        // `reddit_session` is usually a session cookie. The import then
        // reported finding nothing while the cookie sat in the file.
        let fields = line.split("\t");
        let sep = "\t";
        if (fields.length < 7) {
            // Not tab-separated at all: some exporters use spaces. Only
            // reached once the tab reading has failed, so an empty field
            // in a genuine tab file is never re-split this way.
            fields = line.split(/\s+/);
            sep = " ";
        }
        if (fields.length < 7) continue;
        const domain = fields[0].replace(/^\./, "").toLowerCase();
        const name = fields[5];
        // Rejoin the tail with the separator it was split on, so a value
        // that happened to contain one survives intact.
        const value = fields.slice(6).join(sep);
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
            // Named once however many rows carry it. A per-host exporter
            // writes reddit_session for both .reddit.com and
            // www.reddit.com, which read back as
            // "Found Reddit session and Reddit session."
            if (!out.found.includes("Reddit session")) {
                out.found.push("Reddit session");
            }
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
// User-facing labels for the entries `found` can hold. The array itself
// keeps the English markers so this module stays testable without i18n;
// only the rendering goes through the translator.
const FOUND_LABEL_KEYS: Record<string, string> = {
    "Reddit session": "settings.server_config.found_reddit",
    "X login": "settings.server_config.found_x",
};

export function describeParse(p: ParsedCookies): string {
    if (p.found.length > 0) {
        const names = p.found
            .map((f) => i18n.t(FOUND_LABEL_KEYS[f] ?? f))
            .join(i18n.t("settings.server_config.found_joiner"));
        return i18n.t("settings.server_config.cookies_found", { names });
    }
    if (p.domainCount === 0) {
        return i18n.t("settings.server_config.cookies_not_a_file");
    }
    return i18n.t("settings.server_config.cookies_no_login", {
        count: p.domainCount,
    });
}

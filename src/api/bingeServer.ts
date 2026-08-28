import { fetchStashApiKey } from "./queries";
import {
    confirmedDaemonOrigins,
    readBingeServerUrl,
    ensureBingeServerUrlSeeded,
} from "../home/pluginSettings";

// Client for the binge-server Go daemon (handles Reddit polling +
// future social sources). Never throws — daemon-down should degrade
// gracefully so the existing stories row keeps rendering.
//
// Response shapes mirror internal/api/router.go 1:1.

export interface RedditStoryDigest {
    performerStashId: number;
    performerName: string;
    performerImagePath: string;
    performerFavorite: boolean;
    latestCreatedUtc: number;
    postCount: number;
    // Inline posts (up to 25 per performer) so Home renders the full
    // stories row in one round trip.
    posts: RedditPost[];
}

export interface RedditPost {
    id: string; // "t3_<base36>"
    kind: "image" | "video" | "text" | "link";
    title: string | null;
    body: string | null;
    mediaUrl: string | null;
    linkUrl: string | null;
    thumbUrl: string | null;
    permalink: string;
    domain: string | null;
    isNsfw: boolean;
    createdUtc: number;
}

export interface BingeServerHealth {
    ok: boolean;
    // New in v0.2.1 — the daemon's build version. Absent on older
    // daemons, so treat it as "unknown" rather than "not running".
    version?: string;
    // New in v0.2 — present when the daemon reports its config state.
    // false → Stash creds or Reddit cookie not yet set.
    configured?: boolean;
    lastPerformerSync: string;
    lastPoll: string;
    performerCount: number;
    postCount: number;
}

export interface BingeServerConfigState {
    // The stash URL the daemon will use (visible — not a secret).
    stashUrl: string;
    // Whether each secret has been persisted. Booleans only — the
    // daemon never returns the secret values themselves.
    stashApiKeySet: boolean;
    redditCookieSet: boolean;
    // RFC3339 time the daemon first found the Reddit cookie rejected,
    // absent while it works. Cookies expire every few months and the
    // only other symptom is stories quietly stopping, so this is what
    // turns "binge is broken" into "paste a new cookie".
    // Added in binge-server v0.3 — older daemons never send it, which
    // reads correctly as "not expired".
    redditCookieExpiredAt?: string;
    // X (Twitter) auth_token + ct0 pair — true once both are stored.
    xCookiesSet?: boolean;
    // Social "save to Stash" library roots (not secret) + whether both set.
    socialWriteRoot?: string;
    socialStashRoot?: string;
    socialSaveConfigured?: boolean;
}

// A request to download + add a social post to Stash. Mirrors
// internal/social/saver.go SaveRequest.
export interface SaveToStashRequest {
    performerStashId: string;
    source: "x" | "reddit" | "redgifs" | "instagram" | "pornhub";
    handle?: string;
    id?: string;
    mediaUrl: string;
    kind: "image" | "video";
    sourceUrl?: string;
    text?: string;
    createdUtc?: number;
}

export interface SaveToStashResult {
    stashType: "scene" | "image";
    stashId: string;
    path: string;
    handle: string;
}

export interface BingeServerConfigPayload {
    stashUrl?: string;
    stashApiKey?: string;
    redditSessionCookie?: string;
    // X cookies must be sent together (auth_token is useless without ct0).
    xAuthToken?: string;
    xCt0?: string;
    // Social library roots.
    socialWriteRoot?: string;
    socialStashRoot?: string;
}

// One media file from a performer's X media tab. Mirrors
// internal/twitter/client.go's Media. Discriminated by `kind`.
export interface XMedia {
    tweetId: string;
    tweetUrl: string;
    kind: "image" | "video";
    mediaUrl: string;
    text?: string;
    authorHandle?: string;
    authorNick?: string;
    width?: number;
    height?: number;
    sensitive: boolean;
    favoriteCount?: number;
    viewCount?: number;
    createdUtc: number;
}

export interface XFeedResponse {
    handle: string;
    count: number;
    media: XMedia[];
}

// Loopback, unique-local (fc00::/7) and link-local (fe80::/10) only.
// Anything else, including an address with an embedded IPv4 part, is
// treated as public. The URL parser has already lowercased and compressed
// the address by the time this sees it.
function isPrivateIPv6(addr: string): boolean {
    if (addr === "::1") return true;
    const firstHextet = addr.split(":")[0];
    if (!firstHextet) return false; // leading "::", i.e. not one of ours
    if (firstHextet.startsWith("fc") || firstHextet.startsWith("fd"))
        return true;
    return /^fe[89ab]/.test(firstHextet);
}

// Whether it's safe to transmit credentials (Stash API key / Reddit
// cookie) to this binge-server URL. https is always fine; plain http is
// allowed only to loopback / private / tailnet hosts (a self-hosted
// daemon reached over an encrypted tailnet or trusted LAN) — never to a
// public host, which would put the secrets on the open internet in
// cleartext. Also stops an attacker who can rewrite the daemon-URL
// setting (another same-origin plugin, an XSS) from redirecting creds.
export function isTrustedDaemonUrl(raw: string): boolean {
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();

    // Local, private and tailnet hosts are trusted on either scheme. This
    // block used to sit behind an `https -> return true` short circuit, so
    // it only ever ran for http, and every https host was trusted
    // outright no matter whose it was.
    if (host === "localhost" || host === "127.0.0.1" || host === "::1")
        return true;
    if (host.endsWith(".local") || host.endsWith(".internal")) return true;
    // A tailnet name is trusted only when it is the SAME tailnet as the
    // page, not because it ends in .ts.net.
    //
    // This used to sit in the blanket above, which returned before the
    // https requirement, before the same-domain rule and before the
    // confirmation list - so any stranger's tailnet was trusted with the
    // Stash key, on either scheme, from any page. SHARED_SUFFIXES has
    // carried "ts.net" all along with a comment explaining exactly why
    // (Funnel makes these publicly resolvable, so two of them share a
    // landlord rather than an owner), but isSharedSuffix is only reached
    // from sharesRegistrableDomain, which this early return skipped. The
    // entry could never fire for a daemon host.
    //
    // Same-tailnet is the last three labels: <machine>.<tailnet>.ts.net.
    if (host.endsWith(".ts.net")) {
        const tailnetOf = (h: string) => h.split(".").slice(-3).join(".");
        const page = pageHostname();
        if (page.endsWith(".ts.net") && tailnetOf(host) === tailnetOf(page)) {
            return true;
        }
        // Otherwise fall through: https + confirmed, like any other
        // public host.
    }
    // IPv6 literal, which the URL parser hands back in brackets. Settled
    // BEFORE the bare-hostname rule: an IPv6 address contains no dots, so
    // "no dot means LAN name" would wave a public address like
    // [2001:4860:4860::8888] straight through.
    if (host.startsWith("[") && host.endsWith("]")) {
        return isPrivateIPv6(host.slice(1, -1));
    }
    // Bare hostname (no dot) is a LAN/tailnet machine name, not public.
    if (!host.includes(".")) return true;
    // RFC1918 private + Tailscale CGNAT (100.64/10) IPv4 literals.
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (a === 10) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT / tailnet
        return false;
    }

    // A public hostname. Cleartext to one is never acceptable.
    if (u.protocol !== "https:") return false;
    // A daemon under the same registrable domain as the Stash page is the
    // ordinary reverse-proxy deployment (Stash at stash.example.com, the
    // daemon at binge.example.com), so it needs no confirmation.
    if (sharesRegistrableDomain(host, pageHostname())) return true;
    // Anything else: only if this origin was set deliberately. Typing it
    // into Settings and seeding it from Stash's plugin config both record
    // it, so this costs no setup step. It is the check for an address
    // that appeared without either.
    return confirmedDaemonOrigins().includes(u.origin);
}

/// Could the daemon use this address to reach Stash?
///
/// The daemon refuses to store a public Stash URL, and rightly: it is
/// the guard that stops a config write pointing the API key at someone
/// else's host. So sending the browser's own origin only works when that
/// origin is itself local. For Stash behind a public domain the honest
/// answer is that the browser does not know how the daemon reaches
/// Stash, and the daemon's own configured value (localhost by default,
/// which is correct when it runs beside Stash) is the better one.
export function daemonCanReachStashAt(raw: string): boolean {
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        return false;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    // Loopback is the daemon's own machine, so it only names this Stash
    // when the daemon runs beside it. The function never checked that
    // and returned true for loopback before anything else, which is the
    // one address a REMOTE daemon certainly cannot use: browsing Stash
    // at localhost while the daemon is on another box made Settings
    // offer localhost:9999, the daemon fail to find a Stash on its own
    // port 9999, and the whole config write be refused - so first-time
    // setup of a remote daemon could not complete, and the key never
    // landed.
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
        const daemon = (() => {
            try {
                return new URL(readBingeServerUrl()).hostname.toLowerCase();
            } catch {
                return "";
            }
        })();
        return (
            daemon === "localhost" ||
            daemon === "127.0.0.1" ||
            daemon === "[::1]"
        );
    }
    if (
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.endsWith(".ts.net")
    )
        return true;
    if (host.startsWith("[") && host.endsWith("]"))
        return isPrivateIPv6(host.slice(1, -1));
    if (!host.includes(".")) return true;
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
}

/// The host serving this page, or "" outside a browser.
function pageHostname(): string {
    try {
        return window.location.hostname.toLowerCase();
    } catch {
        return "";
    }
}

/// Do two hostnames belong to the same registered domain?
///
/// Compares the last two labels, which is not a public-suffix list: it
/// treats a.co.uk and b.co.uk as related when they are not. That errs
/// toward trusting a host, which here means "an existing setup keeps
/// working" rather than "a stranger gets the key" -- the value still has
/// to be an https host that someone put in the settings. A real PSL is a
/// large table for a check this small.
// Suffixes under which second-level names belong to different people.
// Two names sharing one of these share a landlord, not an owner, so the
// last two labels say nothing about whether the same person controls
// both. Self-hosted Stash lives under these constantly, which is
// exactly the population this check was meant to serve.
//
// Not a full public suffix list, which is a large table for a check
// this small; just the families a self-hoster actually lands on, plus
// the shape of the multi-part country domains.
const SHARED_SUFFIXES = [
    // Tailscale: every tailnet is a sibling under ts.net, and Funnel
    // makes those names publicly resolvable, so two of them share a
    // landlord in exactly the sense this list is about.
    "ts.net",
    "duckdns.org",
    "hopto.org",
    "zapto.org",
    "myftp.org",
    "dynu.net",
    "myds.me",
    "diskstation.me",
    "dscloud.me",
    "quickconnect.to",
    "nip.io",
    "sslip.io",
    "cloudflareaccess.com",
    "no-ip.org",
    "no-ip.com",
    "ddns.net",
    "synology.me",
    "myqnapcloud.com",
    "github.io",
    "ngrok-free.app",
    "ngrok.app",
    "ngrok.io",
    "trycloudflare.com",
    "netlify.app",
    "vercel.app",
    "pages.dev",
    "workers.dev",
];

function isSharedSuffix(host: string): boolean {
    if (SHARED_SUFFIXES.some((sfx) => host === sfx || host.endsWith("." + sfx)))
        return true;
    // co.uk, com.au, co.nz and the rest: a two-part suffix whose first
    // label is one of the usual second-level names.
    const parts = host.split(".");
    if (parts.length >= 3) {
        const second = parts[parts.length - 2];
        const tld = parts[parts.length - 1];
        if (
            tld.length === 2 &&
            ["co", "com", "net", "org", "ac", "gov", "edu"].includes(second)
        ) {
            return true;
        }
    }
    return false;
}

function sharesRegistrableDomain(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    // Under a shared suffix, only an exact host match means anything.
    // Comparing the last two labels made every duckdns.org name look
    // like every other one, so a daemon URL of <anything>.duckdns.org
    // was trusted with the Stash key by anyone whose Stash was also
    // there -- which is most of the people this rule exists for.
    if (isSharedSuffix(a) || isSharedSuffix(b)) return false;
    const tail = (h: string) => h.split(".").slice(-2).join(".");
    const ta = tail(a);
    return ta !== "" && ta === tail(b);
}

// xHandleFromUrls mirrors binge-server's HandleFromURLs — pulls the
// first twitter.com / x.com handle out of a performer's urls[], skipping
// reserved path segments. Used client-side only to decide whether to
// show the X tab (the actual fetch resolves the handle server-side).
const X_RESERVED = new Set([
    "home",
    "search",
    "explore",
    "notifications",
    "messages",
    "i",
    "intent",
    "share",
    "hashtag",
    "settings",
    "compose",
]);
export function xHandleFromUrls(
    urls: string[] | null | undefined,
): string | null {
    if (!urls) return null;
    for (const u of urls) {
        const m = u.match(
            /(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i,
        );
        if (m && !X_RESERVED.has(m[1].toLowerCase())) return m[1];
    }
    return null;
}

// True when a performer's urls[] links a pornhub.com pornstar/model page
// — gates the on-demand PornHub feed fetch on their profile.
export function hasPornhubUrl(urls: string[] | null | undefined): boolean {
    if (!urls) return false;
    return urls.some((u) => /pornhub\.com\/(pornstar|model)\//i.test(u));
}

// The daemon authenticates with the Stash API key — the same secret binge
// already reads to talk to Stash, so this adds nothing for the user to
// configure. Fetched once and cached: every daemon call needs it, and the
// media URLs below need it synchronously.
//
// Empty string is a real answer, not a failure: a Stash with no API key
// (authentication off) has none to send, and the daemon matches Stash by
// serving private networks without one.
let stashKeyPromise: Promise<string> | null = null;
let cachedStashKey = "";

async function ensureStashKey(): Promise<string> {
    if (!stashKeyPromise) {
        stashKeyPromise = fetchStashApiKey()
            .then((k) => {
                cachedStashKey = k ?? "";
                return cachedStashKey;
            })
            .catch(() => "");
    }
    return stashKeyPromise;
}

// Warn once rather than per media URL, of which there are hundreds.
let warnedUntrusted = false;
function warnUntrusted(base: string): void {
    if (warnedUntrusted) return;
    warnedUntrusted = true;
    console.warn(
        "[binge] not sending the Stash API key to " +
            base +
            " — plain http to a public host would expose it. Use https, or a " +
            "local/tailnet address.",
    );
}

/// Appends the key as a query parameter. Needed for URLs handed to <img>
/// and <video>, which cannot carry headers — the same reason Stash accepts
/// `apikey` on its own media routes. Returns the URL untouched when no key
/// is configured, or when the daemon is not somewhere the key may go: a
/// query string is the worst place to put a secret, since it lands in
/// access logs, Referer headers and history.
function withKey(url: string): string {
    if (!cachedStashKey) return url;
    if (!isTrustedDaemonUrl(url)) {
        warnUntrusted(url);
        return url;
    }
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}apikey=${encodeURIComponent(cachedStashKey)}`;
}

async function fetchJSON<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = 8000,
): Promise<T | null> {
    await ensureBingeServerUrlSeeded();
    const key = await ensureStashKey();
    const base = readBingeServerUrl();
    // Same rule as the credential POST in setBingeServerConfig, applied
    // here because this is the path that actually carries the key most
    // often: every feed, story and health call. A daemon URL can be set
    // by the user, seeded from Stash's plugin config, or rewritten by
    // anything with same-origin access, so trust is checked per request
    // rather than assumed from wherever the value came from.
    const trusted = isTrustedDaemonUrl(base);
    if (!trusted) {
        // Not contacted at all, rather than contacted without the key.
        //
        // Withholding the header still left a request going out on every
        // Home load: a liveness and port probe from inside the user's
        // network, to an address they may never have chosen. The forage
        // client closed exactly this and called it a beacon that costs
        // nothing to close; this one was left open. It is also what let
        // the install card's poll reach a hostile host and come back
        // with the answer that confirmed it.
        warnUntrusted(base);
        return null;
    }
    try {
        const resp = await fetch(base + path, {
            ...init,
            headers: {
                ...(init?.headers ?? {}),
                ...(key ? { ApiKey: key } : {}),
            },
            // Tailscale Funnel + Mullvad NL adds latency vs a local
            // daemon. 8s is enough for the fast (DB-backed) endpoints;
            // callers that shell out server-side (X → gallery-dl) pass a
            // larger budget.
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) {
            // 4xx/5xx — log once but don't throw.
            console.warn(
                "[bingeServer] " +
                    resp.status +
                    " " +
                    resp.statusText +
                    " for " +
                    path,
            );
            return null;
        }
        return (await resp.json()) as T;
    } catch (err) {
        console.warn("[bingeServer] fetch failed for " + path + ":", err);
        return null;
    }
}

// Returns null on fetch failure (unreachable daemon, CORS, timeout, etc).
// Empty-but-successful response is an empty array. Callers should
// distinguish these — "daemon down" needs a different UI message than
// "daemon reachable but no posts".
export async function getRedditStories(
    sinceUtc: number,
): Promise<RedditStoryDigest[] | null> {
    return fetchJSON<RedditStoryDigest[]>(
        `/reddit/stories?sinceUtc=${sinceUtc}`,
    );
}

export async function getRedditFeed(
    stashId: number,
    limit = 25,
): Promise<RedditPost[] | null> {
    return fetchJSON<RedditPost[]>(`/reddit/feed/${stashId}?limit=${limit}`);
}

// getXFeed pulls a performer's X media tab on demand. Returns null on a
// daemon/fetch failure (same graceful-degrade contract as the reddit
// calls); a reachable daemon with no handle / no media returns an empty
// media array. `limit` caps how deep gallery-dl scrolls.
export async function getXFeed(
    stashId: number,
    limit = 40,
): Promise<XFeedResponse | null> {
    // A cold fetch shells out to gallery-dl + round-trips X through the
    // Mullvad funnel — well over the default 8s budget from a slow
    // network. Give it 25s (server-side cap is ~50s; cached hits are
    // instant).
    return fetchJSON<XFeedResponse>(
        `/x/feed/${stashId}?limit=${limit}`,
        undefined,
        25_000,
    );
}

// saveToStash asks the daemon to download a social post and add it to
// Stash (folder placement + studio/tag/performer/url/date/caption). The
// daemon returns immediately (pending:true) and applies the metadata in
// the background once Stash finishes scanning. Returns the error string
// on failure (daemon down, not configured, upstream block) so the UI can
// surface it.
export async function saveToStash(
    req: SaveToStashRequest,
): Promise<
    { ok: true; result: SaveToStashResult } | { ok: false; error: string }
> {
    // Seeded first, like fetchJSON. Without this a save on a cold page
    // posts to the derived default rather than the configured daemon.
    await ensureBingeServerUrlSeeded();
    const base = readBingeServerUrl();
    // Refused outright, not merely sent without the key.
    //
    // fetchJSON was closed for this and saveToStash was not, so an
    // address nobody chose still received a POST carrying library
    // metadata - the performer id, the media URL, the source URL and the
    // caption. Worse, a PornHub item's mediaUrl is itself a daemon proxy
    // URL with the Stash key in its query string, so if the daemon
    // setting changed between the story being built and Save being
    // pressed, the key went to the new host in the body.
    if (!isTrustedDaemonUrl(base)) {
        warnUntrusted(base);
        return {
            ok: false,
            error: "That daemon address is not one binge has been told to use. Confirm it in Settings first.",
        };
    }
    try {
        const key = await ensureStashKey();
        const resp = await fetch(base + "/save", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(key ? { ApiKey: key } : {}),
            },
            body: JSON.stringify(req),
            signal: AbortSignal.timeout(30_000),
        });
        const body = (await resp.json().catch(() => ({}))) as
            SaveToStashResult | { error?: string };
        if (!resp.ok) {
            return {
                ok: false,
                error: (body as { error?: string }).error || resp.statusText,
            };
        }
        return { ok: true, result: body as SaveToStashResult };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ── PornHub pillar ──────────────────────────────────────────────────

// One cached PornHub video (metadata only; media is fetched via the
// stream/preview proxies on demand). Mirrors internal/api/pornhub.go.
export interface PornhubVideo {
    id: string; // viewkey
    title: string | null;
    sourceUrl: string; // pornhub watch page
    thumbUrl: string | null; // raw phncdn (rewrite via pornhubThumbUrl)
    duration: number;
    viewCount: number;
    uploadDate: string | null;
    createdUtc: number;
}

export interface PornhubStoryDigest {
    performerStashId: number;
    performerName: string;
    performerImagePath: string;
    performerFavorite: boolean;
    latestCreatedUtc: number;
    videoCount: number;
    videos: PornhubVideo[];
}

// The daemon's answers are cast, not parsed, and this one reaches a
// synchronous render path in the performer grid - so a body that is not
// the shape the type claims throws during render, and with the only
// error boundary at the app root that replaces the whole of binge with
// the error screen. It does not recover on reload either: the profile
// hash survives, so the reload lands on the same performer and fetches
// the same body again.
//
// Shapes actually reachable: Go marshalling a nil element gives [null];
// an error object gives {"error": "..."} where .map is not a function;
// and any field can arrive as the wrong type. isoFromEpochSeconds
// hardened the timestamp VALUE for exactly this reason - this hardens
// the container and the elements around it.
function sanitisePornhubVideos(raw: unknown): PornhubVideo[] {
    if (!Array.isArray(raw)) return [];
    const str = (v: unknown): string | null =>
        typeof v === "string" ? v : null;
    return raw.flatMap((v): PornhubVideo[] => {
        if (typeof v !== "object" || v === null) return [];
        const o = v as Record<string, unknown>;
        const id = str(o.id);
        const sourceUrl = str(o.sourceUrl);
        // Both are required to do anything with the video - it cannot be
        // opened, played or saved without them - so an entry missing
        // either is dropped rather than given a made-up value.
        if (!id || !sourceUrl) return [];
        const num = (v: unknown): number =>
            typeof v === "number" && Number.isFinite(v) ? v : 0;
        return [
            {
                id,
                sourceUrl,
                title: str(o.title),
                thumbUrl: str(o.thumbUrl),
                uploadDate: str(o.uploadDate),
                duration: num(o.duration),
                viewCount: num(o.viewCount),
                createdUtc: num(o.createdUtc),
            },
        ];
    });
}

export async function getPornhubFeed(
    stashId: number,
    limit = 60,
): Promise<PornhubVideo[] | null> {
    const raw = await fetchJSON<unknown>(
        `/pornhub/feed/${stashId}?limit=${limit}`,
    );
    if (raw == null) return null;
    return sanitisePornhubVideos(raw);
}

export async function getPornhubStories(
    sinceUtc: number,
): Promise<PornhubStoryDigest[] | null> {
    // Same treatment as the feed above: the digest's videos reach the
    // story viewer's render path.
    const raw = await fetchJSON<unknown>(
        `/pornhub/stories?sinceUtc=${sinceUtc}`,
    );
    if (raw == null) return null;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((d): PornhubStoryDigest[] => {
        if (typeof d !== "object" || d === null) return [];
        const o = d as Record<string, unknown>;
        return [
            {
                ...(o as unknown as PornhubStoryDigest),
                videos: sanitisePornhubVideos(o.videos),
            },
        ];
    });
}

// Proxy-URL builders. PornHub stream/preview/thumbnail URLs are time/IP-
// locked and on adult CDNs (UK-blocked), so they all route through
// binge-server, which extracts + relays them from its Mullvad exit.
export function pornhubStreamUrl(videoId: string): string {
    return withKey(
        `${readBingeServerUrl()}/pornhub/stream/${encodeURIComponent(videoId)}`,
    );
}
export function pornhubPreviewUrl(videoId: string): string {
    return withKey(
        `${readBingeServerUrl()}/pornhub/preview/${encodeURIComponent(videoId)}`,
    );
}
export function pornhubThumbUrl(raw: string | null): string | null {
    if (!raw) return raw;
    return withKey(
        `${readBingeServerUrl()}/pornhub/thumb?url=${encodeURIComponent(raw)}`,
    );
}

export async function getBingeServerHealth(): Promise<BingeServerHealth | null> {
    return fetchJSON<BingeServerHealth>("/healthz");
}

export async function getBingeServerConfig(): Promise<BingeServerConfigState | null> {
    return fetchJSON<BingeServerConfigState>("/config");
}

// setBingeServerConfig POSTs the given subset of credentials to the
// daemon. The daemon validates each non-empty field against the live
// service (Reddit /api/me.json + Stash GraphQL) before persisting.
// On validation failure the daemon returns 400 with {error:"…"}; we
// surface that to the caller so the UI can render an inline message.
export async function setBingeServerConfig(
    payload: BingeServerConfigPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const base = readBingeServerUrl();
    // Never send the Stash API key / Reddit cookie over cleartext to a
    // remote host. https or a local/tailnet daemon only.
    if (!isTrustedDaemonUrl(base)) {
        return {
            ok: false,
            error: "Won't send credentials to an untrusted binge-server URL — use https:// or a local/tailnet address.",
        };
    }
    try {
        const key = await ensureStashKey();
        const resp = await fetch(base + "/config", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(key ? { ApiKey: key } : {}),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15_000),
        });
        const body = (await resp.json().catch(() => ({}))) as {
            error?: string;
        };
        if (!resp.ok) {
            return { ok: false, error: body.error || resp.statusText };
        }
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// Strip the host from a Stash-rooted URL (image_path / preview / etc.)
// returned by binge-server. The daemon queries Stash with whatever
// STASH_URL it was configured with, so paths can come back fully
// qualified to a different origin than the browser knows (e.g. the
// daemon ran with `STASH_URL=http://10.0.0.42:9999` but the browser
// loaded binge from `http://localhost:9999`). That cross-origin
// mismatch means the Stash session cookie doesn't apply and Stash
// 302s the browser to its login page. Rewriting to a path-relative
// URL lets the browser hit Stash on its own origin with cookies
// attached.
const STASH_PATH_PREFIXES = ["/performer/", "/scene/", "/image/", "/files/"];
export function rewriteStashAssetUrl(url: string | null): string | null {
    if (!url) return url;
    try {
        const u = new URL(url);
        const path = u.pathname + u.search;
        if (STASH_PATH_PREFIXES.some((p) => u.pathname.startsWith(p))) {
            return path;
        }
        return url;
    } catch {
        return url;
    }
}

// Rewrite redgifs CDN URLs to go through binge-server's /redgifs/proxy
// endpoint. Reasons we proxy:
//   - redgifs 403s any request whose Referer isn't their own origin,
//     and we can't reliably override referrerpolicy on a <video>
//   - UK uni network may block adult-content CDNs at the firewall;
//     binge-server has a Mullvad NL exit so it can fetch upstream
// For non-redgifs URLs returns the input unchanged.
export function rewriteRedgifsMediaUrl(url: string | null): string | null {
    if (!url) return url;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    if (!parsed.host.toLowerCase().endsWith(".redgifs.com")) {
        return url;
    }
    const base = readBingeServerUrl();
    return withKey(`${base}/redgifs/proxy?url=${encodeURIComponent(url)}`);
}

// Rewrite Reddit-hosted image/video URLs (i.redd.it / preview.redd.it /
// external-preview.redd.it / v.redd.it) through binge-server's
// /reddit/proxy. Same hotlink/referrer/firewall reasons as redgifs —
// gallery preview URLs in particular get 403'd by Reddit's CDN when
// requested from a non-reddit origin. Returns input unchanged for
// non-Reddit hosts.
export function rewriteRedditMediaUrl(url: string | null): string | null {
    if (!url) return url;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    const host = parsed.host.toLowerCase();
    if (!(host.endsWith(".redd.it") || host.endsWith(".redditmedia.com"))) {
        return url;
    }
    const base = readBingeServerUrl();
    return withKey(`${base}/reddit/proxy?url=${encodeURIComponent(url)}`);
}

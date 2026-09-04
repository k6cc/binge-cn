import {
    ensureForageUrlSeeded,
    readForageUrl,
    readForageWatchTarget,
    type ForageWatchTarget,
} from "../home/pluginSettings";
import { isTrustedDaemonUrl } from "./bingeServer";
import { fetchStashApiKey } from "./queries";
import { getActiveSource } from "./source";

// Client for the forage daemon (github.com/ordureconnoisseur/forager).
// binge only uses ONE forage endpoint: POST /watches, which adds a
// StashDB scene to forage's watchlist so the daemon tracks it and
// notifies the user (with a one-click grab) when a release at the
// target quality appears. forage never auto-grabs from a watch — the
// safe "send this to my downloader's radar" action.
//
// Auth: binge authenticates by sending the Stash instance's own API key
// as a Bearer token — read live from Stash via GraphQL under the user's
// session (never stored here). The forage daemon accepts it because it
// already holds that key to act on Stash's behalf, so there's no
// separate token to paste or persist. Cross-origin works as long as the
// user sets forage's allowed-origin to binge's origin (or "*") in forage
// Settings → Security.

export function isForageConfigured(): boolean {
    return readForageUrl().trim() !== "";
}

// The Stash API key, cached after the first GraphQL read so we don't
// re-query Stash on every forage call.
let stashKeyPromise: Promise<string> | null = null;
function stashApiKey(): Promise<string> {
    if (!stashKeyPromise) {
        stashKeyPromise = fetchStashApiKey().catch(() => "");
    }
    return stashKeyPromise;
}

async function authHeaders(): Promise<Record<string, string>> {
    const key = await stashApiKey();
    return key ? { Authorization: `Bearer ${key}` } : {};
}

// True when binge was loaded over HTTPS but the forage URL is plain
// HTTP — the browser blocks every such fetch silently, so we surface a
// useful message instead of an opaque "NetworkError".
function mixedContentBlocked(base: string): boolean {
    return (
        typeof location !== "undefined" &&
        location.protocol === "https:" &&
        base.startsWith("http:")
    );
}

// Subset of forage's /healthz payload we care about for the Settings
// status dot. The endpoint is public (no token required).
export interface ForageHealth {
    ok: boolean;
    version?: string;
    unconfigured?: boolean;
    prowlarrConfigured?: boolean;
    adminAuthRequired?: boolean;
}

// Returns null on any failure (unreachable, mixed-content block, CORS,
// timeout). Never throws — the Settings dot just shows "unreachable".
export async function getForageHealth(): Promise<ForageHealth | null> {
    // Pick up a server-side configured URL before resolving it (no-op
    // once seeded, and when the user has set their own).
    await ensureForageUrlSeeded();
    const base = readForageUrl();
    if (!base) return null;
    if (mixedContentBlocked(base)) return null;
    // The same gate the write path applies, after the seed so a
    // server-configured URL is still probed. Without it this reached
    // whatever origin the setting names, on every Settings render and
    // on a timer: a liveness probe of any host and port an attacker
    // chooses, reduced to a status dot. No credential rides on it, so
    // this is not a key leak; it is a beacon that costs nothing to
    // close.
    if (!isTrustedDaemonUrl(base)) return null;
    try {
        const resp = await fetch(base + "/healthz", {
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) return null;
        return (await resp.json()) as ForageHealth;
    } catch (err) {
        console.warn("[forage] healthz fetch failed:", err);
        return null;
    }
}

// ── Availability probe ───────────────────────────────────────────────
// "Send to forage" only appears when the daemon actually answers
// /healthz, so the feature stays invisible for anyone who doesn't run
// forage. The probe is cached per-URL so the dozens of discovery cards
// on screen share a single network request, not one each.
let probeUrl: string | null = null;
let probePromise: Promise<boolean> | null = null;

export function forageAvailable(): Promise<boolean> {
    // forage 的 watch 语义绑定 stashdb.org 的 scene id——其他 stash-box
    // 实例（javstash 等）的 id 在 forage 侧查无此物，watch 会静默失效。
    // 活动数据源非默认源时直接禁用入口（不 probe）；配置读取失败时
    // 按默认源放行（与全代码的回退规则一致）。
    return getActiveSource()
        .then((src) => (src.isDefault ? probeForageUrl() : false))
        .catch(() => probeForageUrl());
}

function probeForageUrl(): Promise<boolean> {
    // Can't read the URL synchronously any more — it may still be
    // arriving from Stash's plugin config. Seed first, then probe.
    if (!probePromise) {
        probePromise = ensureForageUrlSeeded()
            .then(() => {
                const url = readForageUrl();
                probeUrl = url;
                if (!url) return false;
                return getForageHealth().then((h) => !!(h && h.ok));
            })
            .catch(() => false);
    } else if (readForageUrl() !== probeUrl) {
        // User changed it in Settings — re-probe against the new host.
        probeUrl = readForageUrl();
        probePromise = probeUrl
            ? getForageHealth()
                  .then((h) => !!(h && h.ok))
                  .catch(() => false)
            : Promise.resolve(false);
    }
    return probePromise;
}

export interface ForageWatchRequest {
    stashdb_id: string;
    title: string;
    date?: string;
    studio?: string;
    image_url?: string;
    performer_name?: string;
    // Local Stash performer id, when the scene's headline performer is
    // already in the library. Omitted for unfollowed performers.
    performer_id?: string;
    // Defaults to the user's configured watch quality when omitted.
    target?: ForageWatchTarget;
}

export type ForageWatchResult =
    { ok: true; target: string } | { ok: false; error: string };

// addForageWatch POSTs a discovery scene to forage's watchlist. Mirrors
// the forage plugin's own addWatch payload 1:1. Never throws — returns a
// tagged result the card renders inline.
export async function addForageWatch(
    req: ForageWatchRequest,
): Promise<ForageWatchResult> {
    await ensureForageUrlSeeded();
    const base = readForageUrl();
    if (!base) {
        return {
            ok: false,
            error: "请先在设置中添加 forage 服务器 URL。",
        };
    }
    if (mixedContentBlocked(base)) {
        return {
            ok: false,
            error: "forage URL 为 http:// 但 binge 通过 https 加载——浏览器会阻止此请求。请使用 https://（或 tailnet）的 forage URL。",
        };
    }
    // We send the Stash API key as the Bearer credential — a powerful
    // secret. Never transmit it in cleartext to a public host (an
    // attacker who can rewrite the URL setting could otherwise harvest
    // it). https or a local/tailnet daemon only.
    if (!isTrustedDaemonUrl(base)) {
        return {
            ok: false,
            error: "不会将 Stash API 密钥发送到不受信任的 URL——请使用 https:// 或本地/tailnet 地址。",
        };
    }

    const target: ForageWatchTarget = req.target ?? readForageWatchTarget();
    try {
        const resp = await fetch(base + "/watches", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(await authHeaders()),
            },
            body: JSON.stringify({ ...req, target }),
            signal: AbortSignal.timeout(15_000),
        });
        const body = (await resp.json().catch(() => ({}))) as {
            error?: string;
            target?: string;
        };
        if (!resp.ok) {
            if (resp.status === 401) {
                return {
                    ok: false,
                    error: "forage 拒绝了请求（401）——forage 使用你的 Stash API 密钥认证，请检查 binge 是否已配置该密钥。",
                };
            }
            return {
                ok: false,
                error: body.error || resp.statusText || `HTTP ${resp.status}`,
            };
        }
        return { ok: true, target: body.target || target };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

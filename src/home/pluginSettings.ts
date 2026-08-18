import { useEffect, useState } from "react";
import { gql } from "../api/graphql";
import { DEFAULT_LIBRARY_FOLDER_NAMES } from "./impliedSource";
import { DEFAULT_GALLERY_IGNORE_FOLDERS } from "./galleryNoise";

// Plugin-settings the reel SPA shares with the Stash settings panel
// injected by binge.entry.js. Storage is plain localStorage keyed under
// `binge.*`; same-origin between the settings page (Stash SPA) and the
// reel page (this SPA), so values written from one are readable from
// the other.
//
// Live updates: the browser fires `storage` events in OTHER tabs when
// localStorage changes — so flipping a toggle in the Stash settings
// tab live-updates the open binge tab without a reload.

const ALLOWED_GENDERS_KEY = "binge.allowedGenders";
const SHOW_GALLERIES_KEY = "binge.showGalleries";
const SHOW_DEBUG_KEY = "binge.showDebug";
const INCLUDE_STASHDB_KEY = "binge.includeStashDB";
const INCLUDE_STASHDB_IN_PROFILE_KEY = "binge.includeStashDBInProfile";
const INCLUDE_REDDIT_KEY = "binge.includeReddit";
const INCLUDE_X_KEY = "binge.includeX";
const INCLUDE_PORNHUB_KEY = "binge.includePornhub";
const AUTO_SCROLL_KEY = "binge.autoScroll";
const REFRACT_INTEGRATION_KEY = "binge.refractIntegration";
const SHOWCASE_BLUR_KEY = "binge.showcaseBlur";
const BINGE_SERVER_URL_KEY = "binge.bingeServerUrl";
const LOOKBACK_DAYS_KEY = "binge.lookbackDays";
// binge-server runs alongside Stash — every install path here sets it up
// that way — so the host serving this page is the host running the daemon.
//
// Derived rather than hardcoded, because "localhost" is only correct when
// you browse FROM the machine Stash runs on. The common Docker setup is
// Stash on a NAS or server with a browser on a laptop, where localhost
// pointed at the wrong machine entirely and every user had to work out
// and type the address themselves.
//
// Stays http even when Stash is https: the daemon isn't behind the same
// reverse proxy, so an https guess would fail the TLS handshake. Those
// users need a proxied endpoint and must set it in Settings — mixed
// content blocks the fetch either way, so this is no worse than before,
// and getBingeServerHealth surfaces that case explicitly.
function defaultBingeServerUrl(): string {
    try {
        const host = window.location.hostname;
        if (host) return `http://${host}:7878`;
    } catch {
        /* no window (tests / SSR) — fall through */
    }
    return "http://localhost:7878";
}
// Stream-type key matches src/config.ts (legacy reader still used in
// imperative call sites like SceneSlide). Kept in sync via the same
// localStorage entry.
const TRANSCODE_KEY = "binge.transcodeType";
export type TranscodeType = "auto" | "direct" | "mp4" | "webm" | "hls";
export const ALLOWED_TRANSCODE: ReadonlyArray<TranscodeType> = [
    "auto",
    "direct",
    "mp4",
    "webm",
    "hls",
];

// Allowed lookback window values (in days). Rendered by the
// SettingsPage lookback dropdown. Capped at 90: the Home feed fetches
// the whole window at once (no infinite-scroll widening), so the
// window size bounds the fetch.
export const ALLOWED_LOOKBACK_DAYS: ReadonlyArray<number> = [7, 14, 30, 60, 90];
const DEFAULT_LOOKBACK_DAYS = 30;

function readBool(key: string, defaultValue: boolean): boolean {
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? defaultValue : stored === "1";
    } catch {
        return defaultValue;
    }
}

function readNumber(
    key: string,
    defaultValue: number,
    allowed?: ReadonlyArray<number>,
): number {
    try {
        const stored = localStorage.getItem(key);
        if (stored === null) return defaultValue;
        const parsed = parseInt(stored, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
        if (allowed && !allowed.includes(parsed)) return defaultValue;
        return parsed;
    } catch {
        return defaultValue;
    }
}

function readString<T extends string>(
    key: string,
    defaultValue: T,
    allowed: ReadonlyArray<T>,
): T {
    try {
        const stored = localStorage.getItem(key);
        if (stored && (allowed as ReadonlyArray<string>).includes(stored)) {
            return stored as T;
        }
    } catch {
        /* fall through */
    }
    return defaultValue;
}

function writeNumber(key: string, value: number): void {
    try {
        localStorage.setItem(key, String(value));
    } catch (err) {
        // Likely incognito / quota — value stays in React state but
        // won't survive a reload. Surface in DevTools so the issue is
        // debuggable.
        console.warn("[binge] localStorage write failed", key, err);
    }
    notify(key);
}

function writeString(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch (err) {
        console.warn("[binge] localStorage write failed", key, err);
    }
    notify(key);
}

// Tiny in-memory pubsub. The browser's `storage` event fires only in
// OTHER tabs/windows — not in the same tab that wrote the value. We
// need same-tab notification for the keyboard-toggle hotkey path
// (write + re-read happen in the same tab). The pubsub handles that;
// `storage` still handles cross-tab.
type Listener = (key: string) => void;
const listeners = new Set<Listener>();
function notify(key: string): void {
    for (const l of listeners) l(key);
}

function writeBool(key: string, value: boolean): void {
    try {
        localStorage.setItem(key, value ? "1" : "0");
    } catch (err) {
        console.warn("[binge] localStorage write failed", key, err);
    }
    notify(key);
}

function useStoredBool(key: string, defaultValue: boolean): boolean {
    const [value, setValue] = useState<boolean>(() =>
        readBool(key, defaultValue),
    );
    useEffect(() => {
        const update = () => setValue(readBool(key, defaultValue));
        const localHandler = (changedKey: string) => {
            if (changedKey === key) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === key) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, [key, defaultValue]);
    return value;
}

function useStoredNumber(
    key: string,
    defaultValue: number,
    allowed?: ReadonlyArray<number>,
): number {
    const [value, setValue] = useState<number>(() =>
        readNumber(key, defaultValue, allowed),
    );
    useEffect(() => {
        const update = () => setValue(readNumber(key, defaultValue, allowed));
        const localHandler = (changedKey: string) => {
            if (changedKey === key) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === key) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, [key, defaultValue, allowed]);
    return value;
}

function useStoredString<T extends string>(
    key: string,
    defaultValue: T,
    allowed: ReadonlyArray<T>,
): T {
    const [value, setValue] = useState<T>(() =>
        readString(key, defaultValue, allowed),
    );
    useEffect(() => {
        const update = () => setValue(readString(key, defaultValue, allowed));
        const localHandler = (changedKey: string) => {
            if (changedKey === key) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === key) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, [key, defaultValue, allowed]);
    return value;
}

// Free-form string reader/hook (no allowed-list). Used for the
// binge-server URL — any user-typed URL must round-trip verbatim.
function readFreeString(key: string, defaultValue: string): string {
    try {
        const stored = localStorage.getItem(key);
        if (stored !== null && stored.length > 0) return stored;
    } catch {
        /* fall through */
    }
    return defaultValue;
}

function useStoredFreeString(key: string, defaultValue: string): string {
    const [value, setValue] = useState<string>(() =>
        readFreeString(key, defaultValue),
    );
    useEffect(() => {
        const update = () => setValue(readFreeString(key, defaultValue));
        const localHandler = (changedKey: string) => {
            if (changedKey === key) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === key) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, [key, defaultValue]);
    return value;
}

// StashDB gender enum subset surfaced as a user-pickable filter on
// the home discovery feed + Explore's Discover Performers bar. The
// 5 user-facing values; INTERSEX is dropped from the picker since
// stashdb tags it rarely and most users don't want it as a primary
// surface filter (still reachable via Stash itself).
export type Gender =
    | "FEMALE"
    | "MALE"
    | "TRANSGENDER_FEMALE"
    | "TRANSGENDER_MALE"
    | "NON_BINARY";
export const ALL_GENDERS: ReadonlyArray<Gender> = [
    "FEMALE",
    "MALE",
    "TRANSGENDER_FEMALE",
    "TRANSGENDER_MALE",
    "NON_BINARY",
];
// Default = all genders (neutral out of the box). Users narrow it in
// Settings → Genders to surface to taste.
const DEFAULT_ALLOWED_GENDERS: ReadonlySet<Gender> = new Set(ALL_GENDERS);

// The user's allowed genders in canonical order. The "Genders to surface"
// setting is the only gate — no gender is silently hidden, and no tag-based
// exclusion runs alongside it.
export function orderedGenders(genders: ReadonlySet<Gender>): Gender[] {
    return ALL_GENDERS.filter((g) => genders.has(g));
}

function readGenderSet(): Set<Gender> {
    try {
        const stored = localStorage.getItem(ALLOWED_GENDERS_KEY);
        if (stored === null) return new Set(DEFAULT_ALLOWED_GENDERS);
        const parts = stored
            .split(",")
            .map((s) => s.trim())
            .filter((s): s is Gender =>
                (ALL_GENDERS as ReadonlyArray<string>).includes(s),
            );
        // Empty stored value is a real user choice ("show nothing").
        // Don't fall through to the default — respect the user's
        // intent, even if it leaves the discovery surfaces empty.
        return new Set(parts);
    } catch {
        return new Set(DEFAULT_ALLOWED_GENDERS);
    }
}

function useStoredGenderSet(): ReadonlySet<Gender> {
    const [value, setValue] = useState<Set<Gender>>(() => readGenderSet());
    useEffect(() => {
        const update = () => setValue(readGenderSet());
        const localHandler = (changedKey: string) => {
            if (changedKey === ALLOWED_GENDERS_KEY) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === ALLOWED_GENDERS_KEY) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, []);
    return value;
}

export function useAllowedGenders(): ReadonlySet<Gender> {
    return useStoredGenderSet();
}

export function readAllowedGenders(): ReadonlySet<Gender> {
    return readGenderSet();
}

export function setAllowedGenders(values: ReadonlySet<Gender>): void {
    // Preserve ALL_GENDERS canonical order on serialisation so the
    // stored value is stable across writes (helps diff tools and
    // anyone inspecting localStorage).
    const ordered = ALL_GENDERS.filter((g) => values.has(g));
    writeString(ALLOWED_GENDERS_KEY, ordered.join(","));
}

// ── Home-feed category filter ───────────────────────────────────────
// Lets the user hide whole categories of Home-feed cards via the filter
// menu next to the "Home" title. Stored as a comma-separated list of
// HIDDEN categories (empty = show everything, the default). Galleries
// are intentionally NOT a category here — they have their own
// "Show galleries" toggle.
// "unidentified" is scenes and batches with no performer linked. They
// are their own category rather than part of posts/reposts because
// there can be a great many of them (most of what an untidy library
// imports) and whether they belong on Home is a matter of taste.
export type FeedCategory =
    "discover" | "trending" | "posts" | "reposts" | "unidentified";
export const ALL_FEED_CATEGORIES: ReadonlyArray<FeedCategory> = [
    "discover",
    "trending",
    "posts",
    "reposts",
    "unidentified",
];
const FEED_HIDDEN_KEY = "binge.feedHidden";

function readFeedHidden(): Set<FeedCategory> {
    try {
        const stored = localStorage.getItem(FEED_HIDDEN_KEY);
        if (!stored) return new Set();
        const parts = stored
            .split(",")
            .map((s) => s.trim())
            .filter((s): s is FeedCategory =>
                (ALL_FEED_CATEGORIES as ReadonlyArray<string>).includes(s),
            );
        return new Set(parts);
    } catch {
        return new Set();
    }
}

export function useHiddenFeedCategories(): ReadonlySet<FeedCategory> {
    const [value, setValue] = useState<Set<FeedCategory>>(() =>
        readFeedHidden(),
    );
    useEffect(() => {
        const update = () => setValue(readFeedHidden());
        const localHandler = (changedKey: string) => {
            if (changedKey === FEED_HIDDEN_KEY) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === FEED_HIDDEN_KEY) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, []);
    return value;
}

export function setHiddenFeedCategories(
    values: ReadonlySet<FeedCategory>,
): void {
    // Preserve canonical order so the stored value is stable.
    const ordered = ALL_FEED_CATEGORIES.filter((c) => values.has(c));
    writeString(FEED_HIDDEN_KEY, ordered.join(","));
}

// ── Library folder names ────────────────────────────────────────────
// Folder names that describe a library rather than a source, used when
// naming a scene that has no performer linked. binge measures the shared
// root of the library from the paths themselves, so this only has to
// catch a bucket that some scenes sit in and others do not ("Unfiled",
// "New"). Every layout is different, so the list is the user's, with
// DEFAULT_LIBRARY_FOLDER_NAMES as a starting point rather than a rule.
// Stored comma-separated; an empty stored value means "none", which is
// distinct from never having set one.
const LIBRARY_FOLDER_NAMES_KEY = "binge.libraryFolderNames";

export function readLibraryFolderNames(): string[] {
    try {
        const stored = localStorage.getItem(LIBRARY_FOLDER_NAMES_KEY);
        if (stored === null) return [...DEFAULT_LIBRARY_FOLDER_NAMES];
        return stored
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    } catch {
        return [...DEFAULT_LIBRARY_FOLDER_NAMES];
    }
}

export function useLibraryFolderNames(): string[] {
    const [value, setValue] = useState<string[]>(() =>
        readLibraryFolderNames(),
    );
    useEffect(() => {
        const update = () => setValue(readLibraryFolderNames());
        const localHandler = (changedKey: string) => {
            if (changedKey === LIBRARY_FOLDER_NAMES_KEY) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === LIBRARY_FOLDER_NAMES_KEY) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, []);
    return value;
}

export function setLibraryFolderNames(values: readonly string[]): void {
    writeString(
        LIBRARY_FOLDER_NAMES_KEY,
        values
            .map((s) => s.trim())
            .filter(Boolean)
            .join(", "),
    );
}

// ── Gallery folders to ignore ───────────────────────────────────────
// Folder names whose galleries are artwork rather than photo sets
// (screenshot sheets, cover art). Whole-segment match, "*" suffix for a
// prefix match. Which names those are is a property of one person's
// disk, so the list is theirs; DEFAULT_GALLERY_IGNORE_FOLDERS is only a
// starting point. An empty stored value means "hide nothing", which is
// distinct from never having set one.
const GALLERY_IGNORE_FOLDERS_KEY = "binge.galleryIgnoreFolders";

export function readGalleryIgnoreFolders(): string[] {
    try {
        const stored = localStorage.getItem(GALLERY_IGNORE_FOLDERS_KEY);
        if (stored === null) return [...DEFAULT_GALLERY_IGNORE_FOLDERS];
        return stored
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    } catch {
        return [...DEFAULT_GALLERY_IGNORE_FOLDERS];
    }
}

export function useGalleryIgnoreFolders(): string[] {
    const [value, setValue] = useState<string[]>(() =>
        readGalleryIgnoreFolders(),
    );
    useEffect(() => {
        const update = () => setValue(readGalleryIgnoreFolders());
        const localHandler = (changedKey: string) => {
            if (changedKey === GALLERY_IGNORE_FOLDERS_KEY) update();
        };
        const storageHandler = (e: StorageEvent) => {
            if (e.key === GALLERY_IGNORE_FOLDERS_KEY) update();
        };
        listeners.add(localHandler);
        window.addEventListener("storage", storageHandler);
        return () => {
            listeners.delete(localHandler);
            window.removeEventListener("storage", storageHandler);
        };
    }, []);
    return value;
}

export function setGalleryIgnoreFolders(values: readonly string[]): void {
    writeString(
        GALLERY_IGNORE_FOLDERS_KEY,
        values
            .map((s) => s.trim())
            .filter(Boolean)
            .join(", "),
    );
}

export function useShowGalleries(): boolean {
    return useStoredBool(SHOW_GALLERIES_KEY, true);
}

export function useShowDebug(): boolean {
    return useStoredBool(SHOW_DEBUG_KEY, false);
}

// StashDB integration. On by default; if the user hasn't configured a
// StashDB API key in Stash's stashbox config, the merge silently
// does nothing (getStashDBBox returns null). No-op cost is one
// configuration GraphQL query.
export function useIncludeStashDB(): boolean {
    return useStoredBool(INCLUDE_STASHDB_KEY, true);
}

// Mixes StashDB-only scenes (those you don't own yet) into the
// scene grid on a library performer's profile, alongside their
// library scenes. Separate toggle from the stories integration so
// users can enable one without the other.
// Off by default — when looking at a single performer, most users
// want their library scenes front-and-center and only flip this on
// when they want to compare against the StashDB catalog.
export function useIncludeStashDBInProfile(): boolean {
    return useStoredBool(INCLUDE_STASHDB_IN_PROFILE_KEY, false);
}

// Reddit integration. On by default; if binge-server is unreachable
// the merge silently no-ops (network fetch returns []), so leaving
// this on with no daemon running just costs one failed fetch per
// Home mount.
export function useIncludeReddit(): boolean {
    return useStoredBool(INCLUDE_REDDIT_KEY, true);
}

// X (Twitter) integration. On by default; the performer-profile X tab
// fetches on demand, so leaving this on with no daemon (or no X cookies)
// configured just costs one failed fetch when the tab is opened.
export function useIncludeX(): boolean {
    return useStoredBool(INCLUDE_X_KEY, true);
}

// PornHub integration. On by default; folds a performer's PornHub videos
// into their scenes grid + stories. Off / daemon-down cleanly no-ops.
export function useIncludePornhub(): boolean {
    return useStoredBool(INCLUDE_PORNHUB_KEY, true);
}

// Auto-scroll the reel — when on, the active video plays once (loop
// off) and the slide advances to the next scene on its `ended` event.
// User can still manually swipe at any time.
export function useAutoScroll(): boolean {
    return useStoredBool(AUTO_SCROLL_KEY, false);
}
export function setAutoScroll(value: boolean): void {
    writeBool(AUTO_SCROLL_KEY, value);
}

// Refract integration — when on, the app reads refract's accent vars
// from localStorage and applies them as inline CSS variables so binge
// follows the user's refract palette. When off (default), binge uses
// its own bundled tokens. Off by default so users without refract or
// who prefer binge's native palette get a clean experience.
export function useRefractIntegration(): boolean {
    return useStoredBool(REFRACT_INTEGRATION_KEY, false);
}
export function setRefractIntegration(value: boolean): void {
    writeBool(REFRACT_INTEGRATION_KEY, value);
}

// Showcase mode — blurs ALL media (images, video, and the inline
// background-image avatars) app-wide so the UI chrome can be captured
// for docs/streaming without exposing library content. Useful for
// README screenshots (GitHub's content policy bars explicit media) and
// as a privacy guard when screen-sharing. Pure CSS: App.tsx toggles a
// `binge-showcase-blur` class on <html> when this is on; the blur rule
// lives in styles/global.css. Off by default.
export function useShowcaseBlur(): boolean {
    return useStoredBool(SHOWCASE_BLUR_KEY, false);
}
export function setShowcaseBlur(value: boolean): void {
    writeBool(SHOWCASE_BLUR_KEY, value);
}
// Imperative toggle for the global `|` (Shift+\) capture hotkey in App.tsx.
export function toggleShowcaseBlur(): void {
    writeBool(SHOWCASE_BLUR_KEY, !readBool(SHOWCASE_BLUR_KEY, false));
}

// binge-server URL. Read both as a React hook and via the imperative
// reader below (used by src/api/bingeServer.ts inside async fetches).
export function useBingeServerUrl(): string {
    return useStoredFreeString(BINGE_SERVER_URL_KEY, defaultBingeServerUrl());
}
export function readBingeServerUrl(): string {
    return readFreeString(BINGE_SERVER_URL_KEY, defaultBingeServerUrl());
}

// One-time seed of the binge-server URL from Stash's server-side plugin
// config (`configuration.plugins.binge.serverUrl`). Lets a deployment be
// configured once in Stash (Plugins settings or the API) and have every
// browser pick it up — without baking a deployment-specific URL into the
// shipped bundle. Only writes localStorage when the user hasn't set their
// own value. Memoized; binge-server fetches await it (see bingeServer.ts)
// so there's no first-load race.
// One seed per storage key, memoised for the page's lifetime.
const seedPromises = new Map<string, Promise<void>>();
function ensureSeededFromPluginConfig(
    storageKey: string,
    field: string,
    write: (value: string) => void,
): Promise<void> {
    let pending = seedPromises.get(storageKey);
    if (!pending) {
        pending = (async () => {
            if (readFreeString(storageKey, "")) return; // user set it
            try {
                const data = await gql<{
                    configuration?: {
                        plugins?: Record<
                            string,
                            Record<string, unknown> | null
                        >;
                    };
                }>(`query { configuration { plugins } }`);
                const value = data.configuration?.plugins?.["binge"]?.[field];
                if (typeof value === "string" && value.trim()) {
                    write(value.trim());
                }
            } catch {
                // Stash unreachable / no config — keep the default.
            }
        })();
        seedPromises.set(storageKey, pending);
    }
    return pending;
}

export function ensureBingeServerUrlSeeded(): Promise<void> {
    return ensureSeededFromPluginConfig(
        BINGE_SERVER_URL_KEY,
        "serverUrl",
        setBingeServerUrl,
    );
}

// ── forage integration ──────────────────────────────────────────────
// "Send to forage" on a discovery card POSTs the StashDB scene to the
// forage daemon's watchlist. Needs the daemon's base URL and (when the
// daemon has auth enabled) an API token. Empty URL = feature disabled
// (the menu item nudges the user to Settings). Read both as hooks (for
// the Settings UI) and imperatively from src/api/forageServer.ts.
const FORAGE_URL_KEY = "binge.forageUrl";
const FORAGE_WATCH_TARGET_KEY = "binge.forageWatchTarget";
// EMPTY by default — no deployment-specific host is baked into the
// shipped bundle. (It used to default to the maintainer's own Tailscale
// URL, which meant every install probed a stranger's daemon.) Empty
// disables the feature outright: isForageConfigured() is false, the
// health probe short-circuits, and "Send to forage" stays hidden until
// the user sets a URL in Settings — or until one arrives from Stash's
// plugin config, see ensureForageUrlSeeded below.
//
// Use https if binge itself is served over https; a plain-http daemon URL
// is blocked as mixed content and the probe fails closed.
const DEFAULT_FORAGE_URL = "";

// Quality the watch waits for. Mirrors forage's WatchTarget enum minus
// 480p (no one watches for a 480p copy). "any" = grab-ready as soon as
// any release appears.
export type ForageWatchTarget = "any" | "720p" | "1080p" | "4k";
export const ALLOWED_FORAGE_TARGETS: ReadonlyArray<ForageWatchTarget> = [
    "any",
    "720p",
    "1080p",
    "4k",
];
const DEFAULT_FORAGE_TARGET: ForageWatchTarget = "any";

export function useForageUrl(): string {
    return useStoredFreeString(FORAGE_URL_KEY, DEFAULT_FORAGE_URL);
}
export function readForageUrl(): string {
    return readFreeString(FORAGE_URL_KEY, DEFAULT_FORAGE_URL);
}
export function setForageUrl(value: string): void {
    // Strip trailing slash so path concatenation stays predictable.
    writeString(FORAGE_URL_KEY, value.trim().replace(/\/+$/, ""));
}

// One-time seed of the forage URL from Stash's plugin config
// (`configuration.plugins.binge.forageUrl`), so a deployment can be
// configured once server-side instead of per browser. Same rules as the
// binge-server seed: a value the user typed always wins, and this runs at
// most once per page. forageServer.ts awaits it before the health probe
// so a cold load can't race the seed.
export function ensureForageUrlSeeded(): Promise<void> {
    return ensureSeededFromPluginConfig(
        FORAGE_URL_KEY,
        "forageUrl",
        setForageUrl,
    );
}

export function useForageWatchTarget(): ForageWatchTarget {
    return useStoredString(
        FORAGE_WATCH_TARGET_KEY,
        DEFAULT_FORAGE_TARGET,
        ALLOWED_FORAGE_TARGETS,
    );
}
export function readForageWatchTarget(): ForageWatchTarget {
    return readString(
        FORAGE_WATCH_TARGET_KEY,
        DEFAULT_FORAGE_TARGET,
        ALLOWED_FORAGE_TARGETS,
    );
}
export function setForageWatchTarget(value: ForageWatchTarget): void {
    if (!ALLOWED_FORAGE_TARGETS.includes(value)) return;
    writeString(FORAGE_WATCH_TARGET_KEY, value);
}

// Imperative toggle — used by the global `\` hotkey in App.tsx so the
// debug overlay can be flipped without leaving the reel tab.
export function toggleShowDebug(): void {
    writeBool(SHOW_DEBUG_KEY, !readBool(SHOW_DEBUG_KEY, false));
}

// Lookback window for "new" content surfaced on Home. Drives both the
// stories row (library + StashDB) and the Feed's initial fetch window.
// Default 30 days. User-configurable via the plugin settings dropdown.
export function useLookbackDays(): number {
    return useStoredNumber(
        LOOKBACK_DAYS_KEY,
        DEFAULT_LOOKBACK_DAYS,
        ALLOWED_LOOKBACK_DAYS,
    );
}

// Stream type (transcode preference) for the reel's video element.
// Imperative reader lives in src/config.ts; this hook exposes it to
// React components (e.g. the SettingsPage).
export function useTranscodeType(): TranscodeType {
    return useStoredString(TRANSCODE_KEY, "auto", ALLOWED_TRANSCODE);
}

// ── Public setters (used by the in-app SettingsPage) ────────────────
// Each writes to localStorage AND fires the pubsub so all open
// SceneSlides / hooks reflect the change instantly.

export function setShowGalleries(value: boolean): void {
    writeBool(SHOW_GALLERIES_KEY, value);
}
export function setShowDebug(value: boolean): void {
    writeBool(SHOW_DEBUG_KEY, value);
}
export function setIncludeStashDB(value: boolean): void {
    writeBool(INCLUDE_STASHDB_KEY, value);
}
export function setIncludeStashDBInProfile(value: boolean): void {
    writeBool(INCLUDE_STASHDB_IN_PROFILE_KEY, value);
}
export function setIncludeReddit(value: boolean): void {
    writeBool(INCLUDE_REDDIT_KEY, value);
}
export function setIncludeX(value: boolean): void {
    writeBool(INCLUDE_X_KEY, value);
}
export function setIncludePornhub(value: boolean): void {
    writeBool(INCLUDE_PORNHUB_KEY, value);
}
export function setBingeServerUrl(value: string): void {
    // Strip trailing slash so concatenations are predictable.
    const trimmed = value.trim().replace(/\/+$/, "");
    writeString(BINGE_SERVER_URL_KEY, trimmed);
    // Setting the URL IS the confirmation. Both routes here are
    // deliberate acts: someone typed it into binge's Settings, or an
    // admin put it in Stash's plugin config and it was seeded. Recording
    // it here is what keeps this change free of extra setup steps -- the
    // banner in Settings then only appears for a URL that arrived
    // without either, which is the case worth looking at.
    confirmDaemonOrigin(trimmed);
}

// ── daemon origins the user has effectively vouched for ─────────────
//
// Only consulted for a PUBLIC https daemon host that is unrelated to the
// Stash origin. Local, private, tailnet and same-domain hosts never
// reach this, so the list stays empty for almost everyone.
//
// Not a security boundary: anything that can write the URL key can write
// this one too. Its job is that a daemon address which appeared without
// you setting it does not silently receive your credentials.
const DAEMON_OK_KEY = "binge.daemonOriginsOk";
const DAEMON_OK_MIGRATED_KEY = "binge.daemonOriginsMigrated";

function originOf(raw: string): string {
    try {
        return new URL(raw).origin;
    } catch {
        return "";
    }
}

export function confirmedDaemonOrigins(): string[] {
    try {
        // One-time grandfather: a URL already configured before this
        // existed was set deliberately by someone, so carry it over
        // rather than interrupting a working install to re-confirm it.
        if (localStorage.getItem(DAEMON_OK_MIGRATED_KEY) === null) {
            localStorage.setItem(DAEMON_OK_MIGRATED_KEY, "1");
            const existing = originOf(
                localStorage.getItem(BINGE_SERVER_URL_KEY) ?? "",
            );
            if (existing) {
                localStorage.setItem(DAEMON_OK_KEY, JSON.stringify([existing]));
                return [existing];
            }
        }
        const raw = localStorage.getItem(DAEMON_OK_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((v): v is string => typeof v === "string")
            : [];
    } catch {
        return [];
    }
}

export function confirmDaemonOrigin(raw: string): void {
    const origin = originOf(raw);
    if (!origin) return;
    try {
        const list = confirmedDaemonOrigins();
        if (list.includes(origin)) return;
        list.push(origin);
        localStorage.setItem(DAEMON_OK_KEY, JSON.stringify(list));
    } catch {
        /* storage unavailable; the gate just stays closed */
    }
}
export function setLookbackDays(value: number): void {
    if (!ALLOWED_LOOKBACK_DAYS.includes(value)) return;
    writeNumber(LOOKBACK_DAYS_KEY, value);
}
export function setTranscodeType(value: TranscodeType): void {
    if (!ALLOWED_TRANSCODE.includes(value)) return;
    writeString(TRANSCODE_KEY, value);
}

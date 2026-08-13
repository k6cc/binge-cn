import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTab } from "./TabContext";
import { useAutoHideTabBar } from "../hooks/useAutoHideTabBar";
import {
    ALLOWED_FORAGE_TARGETS,
    ALLOWED_LOOKBACK_DAYS,
    ALLOWED_TRANSCODE,
    setAllowedGenders,
    setBingeServerUrl,
    setForageUrl,
    setForageWatchTarget,
    setIncludeReddit,
    setIncludeX,
    setIncludePornhub,
    setIncludeStashDB,
    setIncludeStashDBInProfile,
    setLookbackDays,
    setRefractIntegration,
    setShowDebug,
    setShowGalleries,
    setShowcaseBlur,
    setTranscodeType,
    useAllowedGenders,
    useBingeServerUrl,
    useForageUrl,
    useForageWatchTarget,
    useIncludeReddit,
    useIncludeX,
    useIncludePornhub,
    useIncludeStashDB,
    useIncludeStashDBInProfile,
    useLookbackDays,
    useRefractIntegration,
    useShowDebug,
    useShowGalleries,
    useShowcaseBlur,
    useTranscodeType,
    type ForageWatchTarget,
    type Gender,
} from "../home/pluginSettings";
import {
    getBingeServerConfig,
    getBingeServerHealth,
    setBingeServerConfig,
    type BingeServerConfigState,
    type BingeServerHealth,
} from "../api/bingeServer";
import { getForageHealth } from "../api/forageServer";
import { parseCookiesTxt, describeParse } from "../api/cookiesTxt";
import { BingeServerInstallCard } from "./BingeServerInstallCard";
import { fetchStashApiKey } from "../api/queries";
import { useTranslation } from "react-i18next";

// In-app settings page — all preferences that used to live in Stash's
// plugin settings UI now live here. Same localStorage keys + pubsub,
// so any change here propagates to open Reel slides immediately.
export function SettingsPage() {
    const { setTab } = useTab();
    const scrollRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    useAutoHideTabBar(scrollRef);

    return (
        <div className="binge-tab-scroll" ref={scrollRef}>
            <header className="binge-saved-header">
                <button
                    type="button"
                    className="binge-saved-back"
                    onClick={() => setTab("home")}
                    aria-label={t("nav.back_to_home")}
                    title={t("nav.back")}
                >
                    <ChevronLeft />
                </button>
                <h1 className="binge-saved-title">{t("nav.settings")}</h1>
                <span className="binge-saved-spacer" />
            </header>

            <div className="binge-settings-list">
                <GenderRow />
                <TranscodeRow />
                <GalleriesRow />
                <LookbackRow />
                <StashDBRow />
                <StashDBProfileRow />
                <RedditRow />
                <XRow />
                <PornhubRow />
                <BingeServerInstallCard />
                <BingeServerRow />
                <BingeServerConfigCard />
                <ForageUrlRow />
                <ForageTargetRow />
                <RefractRow />
                <ShowcaseRow />
                <DebugRow />
            </div>
        </div>
    );
}

// ── Individual setting rows ──────────────────────────────────────────

function TranscodeRow() {
    const value = useTranscodeType();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.transcode.title")}
            description={t("settings.transcode.desc")}
        >
            <select
                className="binge-settings-select"
                value={value}
                onChange={(e) =>
                    setTranscodeType(
                        e.target.value as (typeof ALLOWED_TRANSCODE)[number]
                    )
                }
            >
                <option value="auto">{t("settings.transcode.auto")}</option>
                <option value="direct">{t("settings.transcode.direct")}</option>
                <option value="mp4">{t("settings.transcode.mp4")}</option>
                <option value="webm">{t("settings.transcode.webm")}</option>
                <option value="hls">{t("settings.transcode.hls")}</option>
            </select>
        </SettingRow>
    );
}

function GenderRow() {
    const allowed = useAllowedGenders();
    const { t } = useTranslation();
    const toggle = (g: Gender) => {
        const next = new Set(allowed);
        if (next.has(g)) next.delete(g);
        else next.add(g);
        setAllowedGenders(next);
    };
    return (
        <SettingRow
            title={t("settings.gender.title")}
            description={t("settings.gender.desc")}
        >
            <div
                className="binge-settings-gender-row"
                role="group"
                aria-label={t("settings.gender.title")}
            >
                {GENDER_OPTIONS.map(({ value, label }) => {
                    const active = allowed.has(value);
                    return (
                        <button
                            key={value}
                            type="button"
                            className={
                                "binge-settings-gender-btn" +
                                (active ? " is-active" : "")
                            }
                            onClick={() => toggle(value)}
                            title={label}
                            aria-label={label}
                            aria-pressed={active}
                        >
                            <GenderIcon gender={value} />
                        </button>
                    );
                })}
            </div>
        </SettingRow>
    );
}

const GENDER_OPTIONS: ReadonlyArray<{
    value: Gender;
    label: string;
}> = [
    { value: "FEMALE", label: "Female" },
    { value: "MALE", label: "Male" },
    { value: "TRANSGENDER_FEMALE", label: "Trans female" },
    { value: "TRANSGENDER_MALE", label: "Trans male" },
    { value: "NON_BINARY", label: "Non-binary" },
];

// Hand-drawn gender glyphs that scale crisply at small sizes —
// the corresponding Unicode characters render unevenly across
// fonts at 18-20px, so we paint our own. All share a 24×24 box,
// 1.8 stroke, round line caps. `currentColor` so the buttons can
// theme via the parent's `color`.
function GenderIcon({ gender }: { gender: Gender }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {gender === "FEMALE" && (
                <g>
                    <circle cx="12" cy="9" r="4.5" />
                    <path d="M12 13.5 v7" />
                    <path d="M9 17.5 h6" />
                </g>
            )}
            {gender === "MALE" && (
                <g>
                    <circle cx="10" cy="14" r="4.5" />
                    <path d="M13.2 10.8 L20 4" />
                    <path d="M14 4 H20 V10" />
                </g>
            )}
            {gender === "TRANSGENDER_FEMALE" && (
                // Venus + a small arrow sprouting from upper-left of
                // the circle (the standard trans-modifier stroke).
                <g>
                    <circle cx="12" cy="11" r="4" />
                    <path d="M12 15 v6" />
                    <path d="M9.5 18.5 h5" />
                    <path d="M9.1 8.1 L5 4" />
                    <path d="M5 4 H8.5 M5 4 V7.5" />
                </g>
            )}
            {gender === "TRANSGENDER_MALE" && (
                // Mars + a perpendicular stroke across the diagonal
                // arrow shaft — mirrors the trans-male glyph (U+26A6).
                <g>
                    <circle cx="10" cy="14" r="4" />
                    <path d="M12.8 11.2 L20 4" />
                    <path d="M14 4 H20 V10" />
                    <path d="M14.5 9.5 L17.5 12.5" />
                </g>
            )}
            {gender === "NON_BINARY" && (
                // Single vertical stem with a circle in the middle —
                // matches the contemporary NB symbol (a Venus-like
                // shape with no cross or arrow).
                <g>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 3 V8" />
                    <path d="M12 16 V21" />
                </g>
            )}
        </svg>
    );
}
function GalleriesRow() {
    const value = useShowGalleries();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.galleries.title")}
            description={t("settings.galleries.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setShowGalleries(v)}
                label={t("settings.galleries.label")}
            />
        </SettingRow>
    );
}

function LookbackRow() {
    const value = useLookbackDays();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.lookback.title")}
            description={t("settings.lookback.desc")}
        >
            <select
                className="binge-settings-select"
                value={String(value)}
                onChange={(e) => setLookbackDays(parseInt(e.target.value, 10))}
            >
                {ALLOWED_LOOKBACK_DAYS.map((days) => (
                    <option key={days} value={String(days)}>
                        {days} {t("settings.lookback.days")}
                    </option>
                ))}
            </select>
        </SettingRow>
    );
}

function StashDBRow() {
    const value = useIncludeStashDB();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.stashdb.title")}
            description={t("settings.stashdb.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setIncludeStashDB(v)}
                label="StashDB"
            />
        </SettingRow>
    );
}

function StashDBProfileRow() {
    const value = useIncludeStashDBInProfile();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.stashdb_profile.title")}
            description={t("settings.stashdb_profile.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setIncludeStashDBInProfile(v)}
                label={t("settings.stashdb_profile.label")}
            />
        </SettingRow>
    );
}

function RedditRow() {
    const value = useIncludeReddit();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.reddit.title")}
            description={t("settings.reddit.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setIncludeReddit(v)}
                label="Reddit"
            />
        </SettingRow>
    );
}

function XRow() {
    const value = useIncludeX();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.x.title")}
            description={t("settings.x.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setIncludeX(v)}
                label="X"
            />
        </SettingRow>
    );
}

function PornhubRow() {
    const value = useIncludePornhub();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.pornhub.title")}
            description={t("settings.pornhub.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setIncludePornhub(v)}
                label="PornHub"
            />
        </SettingRow>
    );
}

function BingeServerRow() {
    const stored = useBingeServerUrl();
    const { t } = useTranslation();
    // Local edit buffer so typing doesn't trigger pubsub on every
    // keystroke. We commit on blur (and resync if the user changes
    // the value in another tab via the storage event).
    const [draft, setDraft] = useState(stored);
    useEffect(() => {
        setDraft(stored);
    }, [stored]);

    return (
        <SettingRow
            title={t("settings.server_url.title")}
            description={t("settings.server_url.desc")}
        >
            <div className="binge-settings-url-row">
                <input
                    type="text"
                    className="binge-settings-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                        if (draft !== stored) setBingeServerUrl(draft);
                    }}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder="http://localhost:7878"
                />
                <BingeServerHealthDot url={stored} />
            </div>
        </SettingRow>
    );
}

// Pings /healthz on mount + whenever the configured URL changes.
// Three-state: pending (grey) / ok (green) / unreachable (red).
function BingeServerHealthDot({ url }: { url: string }) {
    const { t } = useTranslation();
    const [state, setState] = useState<"pending" | "ok" | "down">("pending");
    useEffect(() => {
        let alive = true;
        setState("pending");
        getBingeServerHealth()
            .then((h) => {
                if (!alive) return;
                setState(h && h.ok ? "ok" : "down");
            })
            .catch(() => {
                if (!alive) return;
                setState("down");
            });
        return () => {
            alive = false;
        };
    }, [url]);

    const label =
        state === "ok"
            ? t("settings.server_health.ok")
            : state === "down"
              ? t("settings.server_health.down")
              : t("settings.server_health.pending");
    return (
        <span
            className={`binge-settings-status-dot is-${state}`}
            title={label}
            aria-label={label}
            role="status"
        />
    );
}

// binge-server live config card. Shows daemon health, auto-pushes the
// Stash API key on first contact, and exposes a Reddit-cookie input
// so cookie rotation can happen entirely from the binge UI.
//
// Three visible states:
//   - "unreachable" → daemon down; show a setup link, no fields
//   - "needs config" → daemon up, missing creds; show inputs
//   - "all set"     → daemon up + configured; show status + last poll
//
// The Stash API key fetch is silent — binge calls
// `fetchStashApiKey()` (same-origin Stash GraphQL) and POSTs it to
// /config the first time the daemon comes up without one. The user
// never sees that step.
function BingeServerConfigCard() {
    const { t } = useTranslation();
    const url = useBingeServerUrl();
    const [health, setHealth] = useState<BingeServerHealth | null | "pending">(
        "pending"
    );
    const [config, setConfig] = useState<BingeServerConfigState | null>(null);
    const [cookieInput, setCookieInput] = useState("");
    const [cookieBusy, setCookieBusy] = useState(false);
    const [cookieError, setCookieError] = useState<string | null>(null);
    const [cookieSaved, setCookieSaved] = useState(false);
    // cookies.txt import — one file drop instead of two devtools digs.
    const [importMsg, setImportMsg] = useState<string | null>(null);
    const [importErr, setImportErr] = useState<string | null>(null);
    const [importBusy, setImportBusy] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    // X (Twitter) cookies — two values, saved together.
    const [xAuthInput, setXAuthInput] = useState("");
    const [xCt0Input, setXCt0Input] = useState("");
    const [xBusy, setXBusy] = useState(false);
    const [xError, setXError] = useState<string | null>(null);
    const [xSaved, setXSaved] = useState(false);
    const [showXHelp, setShowXHelp] = useState(false);
    // Social "save to Stash" library roots.
    const [socWrite, setSocWrite] = useState("");
    const [socStash, setSocStash] = useState("");
    const [socBusy, setSocBusy] = useState(false);
    const [socError, setSocError] = useState<string | null>(null);
    const [socSaved, setSocSaved] = useState(false);

    // Poll health + config on mount + URL change.
    useEffect(() => {
        let alive = true;
        setHealth("pending");
        setConfig(null);
        setCookieError(null);
        setCookieSaved(false);
        (async () => {
            const [h, c] = await Promise.all([
                getBingeServerHealth(),
                getBingeServerConfig(),
            ]);
            if (!alive) return;
            setHealth(h);
            setConfig(c);
            setSocWrite(c?.socialWriteRoot ?? "");
            setSocStash(c?.socialStashRoot ?? "");
        })();
        return () => {
            alive = false;
        };
    }, [url]);

    // Silent auto-push of the Stash API key whenever the daemon is
    // reachable but doesn't have one. Fetch from Stash same-origin →
    // POST to binge-server → refresh local config state.
    useEffect(() => {
        if (config === null) return;
        if (config.stashApiKeySet) return;
        let alive = true;
        (async () => {
            try {
                const apiKey = await fetchStashApiKey();
                if (!alive || !apiKey) return;
                const stashUrl = window.location.origin;
                const result = await setBingeServerConfig({
                    stashUrl,
                    stashApiKey: apiKey,
                });
                if (!alive) return;
                if (result.ok) {
                    const refreshed = await getBingeServerConfig();
                    if (alive) setConfig(refreshed);
                }
            } catch (err) {
                console.warn("[binge] auto-push Stash API key failed", err);
            }
        })();
        return () => {
            alive = false;
        };
    }, [config]);

    // Parses in the browser and sends only the values binge understands.
    // The file itself never leaves the page — a cookies.txt exported from a
    // live session usually holds logins for every site you've visited, so
    // uploading it wholesale would be a poor trade for saving one paste.
    const handleCookiesFile = async (file: File) => {
        setImportBusy(true);
        setImportMsg(null);
        setImportErr(null);
        try {
            const parsed = parseCookiesTxt(await file.text());
            if (parsed.found.length === 0) {
                setImportErr(describeParse(parsed));
                return;
            }
            const result = await setBingeServerConfig({
                redditSessionCookie: parsed.redditSessionCookie,
                xAuthToken: parsed.xAuthToken,
                xCt0: parsed.xCt0,
            });
            if (result.ok) {
                setImportMsg(describeParse(parsed) + " Saved.");
                const refreshed = await getBingeServerConfig();
                setConfig(refreshed);
            } else {
                setImportErr(result.error);
            }
        } catch (err) {
            setImportErr(
                "Couldn't read that file: " +
                    (err instanceof Error ? err.message : String(err))
            );
        } finally {
            setImportBusy(false);
        }
    };

    const handleSaveCookie = async () => {
        const cookie = cookieInput.trim();
        if (!cookie) return;
        setCookieBusy(true);
        setCookieError(null);
        setCookieSaved(false);
        const result = await setBingeServerConfig({
            redditSessionCookie: cookie,
        });
        if (result.ok) {
            setCookieSaved(true);
            setCookieInput("");
            const refreshed = await getBingeServerConfig();
            setConfig(refreshed);
        } else {
            setCookieError(result.error);
        }
        setCookieBusy(false);
    };

    const handleSaveXCookies = async () => {
        const auth = xAuthInput.trim();
        const ct0 = xCt0Input.trim();
        if (!auth || !ct0) return;
        setXBusy(true);
        setXError(null);
        setXSaved(false);
        const result = await setBingeServerConfig({
            xAuthToken: auth,
            xCt0: ct0,
        });
        if (result.ok) {
            setXSaved(true);
            setXAuthInput("");
            setXCt0Input("");
            const refreshed = await getBingeServerConfig();
            setConfig(refreshed);
        } else {
            setXError(result.error);
        }
        setXBusy(false);
    };

    const handleSaveSocialPaths = async () => {
        setSocBusy(true);
        setSocError(null);
        setSocSaved(false);
        const result = await setBingeServerConfig({
            socialWriteRoot: socWrite.trim(),
            socialStashRoot: socStash.trim(),
        });
        if (result.ok) {
            setSocSaved(true);
            const refreshed = await getBingeServerConfig();
            setConfig(refreshed);
        } else {
            setSocError(result.error);
        }
        setSocBusy(false);
    };

    if (health === "pending") {
        return (
            <div className="binge-settings-card">
                <div className="binge-settings-card-header">
                    <h3 className="binge-settings-card-title">
                        {t("settings.server_config.title")}
                    </h3>
                    <span className="binge-settings-card-status">
                        <span className="binge-settings-status-dot is-pending" />
                        {t("status.checking")}
                    </span>
                </div>
            </div>
        );
    }

    if (health === null) {
        return (
            <div className="binge-settings-card is-disconnected">
                <div className="binge-settings-card-header">
                    <h3 className="binge-settings-card-title">
                        {t("settings.server_config.title")}
                    </h3>
                    <span className="binge-settings-card-status">
                        <span className="binge-settings-status-dot is-down" />
                        {t("settings.server_health.down")}
                    </span>
                </div>
                <p className="binge-settings-card-description">
                    Daemon unreachable at <code>{url}</code>. Reddit stories
                    will be silently skipped until it's running.{" "}
                    <a
                        href="https://github.com/ordureconnoisseur/binge-server"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="binge-settings-card-link"
                    >
                        {t("settings.server_config.setup_link")}
                    </a>
                </p>
            </div>
        );
    }

    // Daemon is reachable — render the full config card.
    const stashKeyState = config?.stashApiKeySet
        ? t("settings.server_config.auto_detected")
        : t("settings.server_config.configuring");
    const cookieIsSet = !!config?.redditCookieSet;
    const xCookiesSet = !!config?.xCookiesSet;

    return (
        <div className="binge-settings-card">
            <div className="binge-settings-card-header">
                <h3 className="binge-settings-card-title">
                    {t("settings.server_config.title")}
                </h3>
                <span className="binge-settings-card-status">
                    <span className="binge-settings-status-dot is-ok" />
                    {t("status.connected")}
                    {health.lastPoll && (
                        <span className="binge-settings-card-status-meta">
                            · {health.performerCount} performers · last poll{" "}
                            {formatRelative(health.lastPoll)}
                        </span>
                    )}
                </span>
            </div>
            <p className="binge-settings-card-description">
                {t("settings.server_config.desc")}
            </p>

            <div className="binge-settings-card-field">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.stash_api_key")}
                </span>
                <span className="binge-settings-card-field-value">
                    {stashKeyState}
                </span>
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.import_cookies")}
                </span>
                <div className="binge-cookies-import">
                    <label className="binge-install-btn is-secondary">
                        {importBusy ? "Reading…" : "Choose file"}
                        <input
                            type="file"
                            accept=".txt,text/plain"
                            hidden
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = "";
                                if (f) void handleCookiesFile(f);
                            }}
                        />
                    </label>
                    <span className="binge-cookies-import-hint">
                        {t("settings.server_config.import_cookies_hint")}
                    </span>
                </div>
                {importMsg && (
                    <p className="binge-server-config-ok">{importMsg}</p>
                )}
                {importErr && (
                    <p className="binge-server-config-error">{importErr}</p>
                )}
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.reddit_cookie")}
                </span>
                <div className="binge-server-config-cookie-row">
                    <input
                        type="password"
                        className="binge-settings-input"
                        value={cookieInput}
                        onChange={(e) => {
                            setCookieInput(e.target.value);
                            setCookieSaved(false);
                            setCookieError(null);
                        }}
                        placeholder={
                            cookieIsSet
                                ? t("settings.server_config.cookie_set")
                                : t("settings.server_config.cookie_placeholder")
                        }
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        disabled={cookieBusy}
                    />
                    <button
                        type="button"
                        className="binge-server-config-cookie-save"
                        onClick={() => void handleSaveCookie()}
                        disabled={cookieBusy || !cookieInput.trim()}
                    >
                        {cookieBusy ? t("action.saving") : t("action.save")}
                    </button>
                </div>
                {cookieError && (
                    <p className="binge-server-config-error">{cookieError}</p>
                )}
                {cookieSaved && (
                    <p className="binge-server-config-ok">{t("status.saved")}</p>
                )}
                <button
                    type="button"
                    className="binge-server-config-help-toggle"
                    onClick={() => setShowHelp((v) => !v)}
                >
                    {showHelp ? "▾" : "▸"} {t("settings.server_config.how_to_reddit")}
                </button>
                {showHelp && (
                    <ol className="binge-server-config-help">
                        <li>In a regular browser tab, log into reddit.com.</li>
                        <li>
                            {t("settings.server_config.help_reddit_1")}
                        </li>
                        <li>
                            {t("settings.server_config.help_reddit_2")}
                        </li>
                        <li>
                            Cookies expire every few months. When stories stop
                            updating, repeat steps 1–3.
                        </li>
                    </ol>
                )}
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.x_cookies")}
                </span>
                <div className="binge-server-config-cookie-row">
                    <input
                        type="password"
                        className="binge-settings-input"
                        value={xAuthInput}
                        onChange={(e) => {
                            setXAuthInput(e.target.value);
                            setXSaved(false);
                            setXError(null);
                        }}
                        placeholder={
                            xCookiesSet
                                ? t("settings.server_config.x_auth_set")
                                : "auth_token"
                        }
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        disabled={xBusy}
                    />
                    <input
                        type="password"
                        className="binge-settings-input"
                        value={xCt0Input}
                        onChange={(e) => {
                            setXCt0Input(e.target.value);
                            setXSaved(false);
                            setXError(null);
                        }}
                        placeholder={xCookiesSet ? "ct0" : "ct0"}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        disabled={xBusy}
                    />
                    <button
                        type="button"
                        className="binge-server-config-cookie-save"
                        onClick={() => void handleSaveXCookies()}
                        disabled={
                            xBusy || !xAuthInput.trim() || !xCt0Input.trim()
                        }
                    >
                        {xBusy ? t("action.saving") : t("action.save")}
                    </button>
                </div>
                {xError && (
                    <p className="binge-server-config-error">{xError}</p>
                )}
                {xSaved && <p className="binge-server-config-ok">{t("status.saved")}</p>}
                <button
                    type="button"
                    className="binge-server-config-help-toggle"
                    onClick={() => setShowXHelp((v) => !v)}
                >
                    {showXHelp ? "▾" : "▸"} {t("settings.server_config.how_to_x")}
                </button>
                {showXHelp && (
                    <ol className="binge-server-config-help">
                        <li>{t("settings.server_config.help_x_1")}</li>
                        <li>
                            {t("settings.server_config.help_x_2")}
                        </li>
                        <li>
                            {t("settings.server_config.help_x_3")}
                        </li>
                        <li>
                            {t("settings.server_config.help_x_4")}
                        </li>
                    </ol>
                )}
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.social_save_path")}{" "}
                    {config?.socialSaveConfigured ? "✓" : ""}
                </span>
                <p className="binge-settings-card-description">
                    {t("settings.server_config.social_save_desc")}
                </p>
                <input
                    type="text"
                    className="binge-settings-input"
                    value={socWrite}
                    onChange={(e) => {
                        setSocWrite(e.target.value);
                        setSocSaved(false);
                        setSocError(null);
                    }}
                    placeholder={t("settings.server_config.daemon_write_path")}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={socBusy}
                />
                <div className="binge-server-config-cookie-row">
                    <input
                        type="text"
                        className="binge-settings-input"
                        value={socStash}
                        onChange={(e) => {
                            setSocStash(e.target.value);
                            setSocSaved(false);
                            setSocError(null);
                        }}
                        placeholder={t("settings.server_config.stash_path")}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        disabled={socBusy}
                    />
                    <button
                        type="button"
                        className="binge-server-config-cookie-save"
                        onClick={() => void handleSaveSocialPaths()}
                        disabled={socBusy}
                    >
                        {socBusy ? t("action.saving") : t("action.save")}
                    </button>
                </div>
                {socError && (
                    <p className="binge-server-config-error">{socError}</p>
                )}
                {socSaved && <p className="binge-server-config-ok">Saved ✓</p>}
            </div>
        </div>
    );
}

// Compact relative-time formatter: "2 min ago", "3 h ago", "yesterday".
function formatRelative(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "—";
    const diffMs = Date.now() - t;
    const secs = Math.floor(diffMs / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `${days} d ago`;
}

// ── forage integration rows ─────────────────────────────────────────
// "Send to forage" on a discovery card adds that StashDB scene to the
// forage daemon's watchlist. These rows point binge at the daemon.

function ForageUrlRow() {
    const stored = useForageUrl();
    const [draft, setDraft] = useState(stored);
    const { t } = useTranslation();
    useEffect(() => {
        setDraft(stored);
    }, [stored]);

    return (
        <SettingRow
            title={t("settings.forage_url.title")}
            description={t("settings.forage_url.desc")}
        >
            <div className="binge-settings-url-row">
                <input
                    type="text"
                    className="binge-settings-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                        if (draft !== stored) setForageUrl(draft);
                    }}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder="https://forage.example.ts.net"
                />
                <ForageHealthDot url={stored} />
            </div>
        </SettingRow>
    );
}

// Pings forage /healthz on mount + whenever the URL changes.
function ForageHealthDot({ url }: { url: string }) {
    const { t } = useTranslation();
    const [state, setState] = useState<"pending" | "ok" | "down" | "idle">(
        url ? "pending" : "idle"
    );
    useEffect(() => {
        if (!url) {
            setState("idle");
            return;
        }
        let alive = true;
        setState("pending");
        getForageHealth()
            .then((h) => {
                if (!alive) return;
                setState(h && h.ok ? "ok" : "down");
            })
            .catch(() => {
                if (alive) setState("down");
            });
        return () => {
            alive = false;
        };
    }, [url]);

    if (state === "idle") return null;
    const label =
        state === "ok"
            ? t("settings.forage_health.ok")
            : state === "down"
              ? t("settings.forage_health.down")
              : t("status.checking");
    return (
        <span
            className={`binge-settings-status-dot is-${state}`}
            title={label}
            aria-label={label}
            role="status"
        />
    );
}

function ForageTargetRow() {
    const value = useForageWatchTarget();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.forage_target.title")}
            description={t("settings.forage_target.desc")}
        >
            <select
                className="binge-settings-select"
                value={value}
                onChange={(e) =>
                    setForageWatchTarget(e.target.value as ForageWatchTarget)
                }
            >
                {ALLOWED_FORAGE_TARGETS.map((t) => (
                    <option key={t} value={t}>
                        {t === "any" ? "Any release" : t}
                    </option>
                ))}
            </select>
        </SettingRow>
    );
}

function RefractRow() {
    const value = useRefractIntegration();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.refract.title")}
            description={t("settings.refract.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setRefractIntegration(v)}
                label={t("settings.refract.label")}
            />
        </SettingRow>
    );
}

function ShowcaseRow() {
    const value = useShowcaseBlur();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.showcase.title")}
            description={t("settings.showcase.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setShowcaseBlur(v)}
                label={t("settings.showcase.label")}
            />
        </SettingRow>
    );
}

function DebugRow() {
    const value = useShowDebug();
    const { t } = useTranslation();
    return (
        <SettingRow
            title={t("settings.debug.title")}
            description={t("settings.debug.desc")}
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setShowDebug(v)}
                label={t("settings.debug.label")}
            />
        </SettingRow>
    );
}

// ── Building blocks ──────────────────────────────────────────────────

function SettingRow({
    title,
    description,
    children,
}: {
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <div className="binge-settings-row">
            <div className="binge-settings-row-text">
                <h3 className="binge-settings-row-title">{title}</h3>
                <p className="binge-settings-row-description">{description}</p>
            </div>
            <div className="binge-settings-row-control">{children}</div>
        </div>
    );
}

function SwitchToggle({
    checked,
    onChange,
    label,
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
    label: string;
}) {
    return (
        <label className="binge-settings-switch" title={label}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                aria-label={label}
            />
            <span className="binge-settings-switch-track" aria-hidden="true">
                <span className="binge-settings-switch-thumb" />
            </span>
        </label>
    );
}


function ChevronLeft() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}

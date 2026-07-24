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
    setDemoMode,
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
    useDemoMode,
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
import { fetchStashApiKey } from "../api/queries";

// In-app settings page — all preferences that used to live in Stash's
// plugin settings UI now live here. Same localStorage keys + pubsub,
// so any change here propagates to open Reel slides immediately.
export function SettingsPage() {
    const { setTab } = useTab();
    const scrollRef = useRef<HTMLDivElement>(null);
    useAutoHideTabBar(scrollRef);

    return (
        <div className="binge-tab-scroll" ref={scrollRef}>
            <header className="binge-saved-header">
                <button
                    type="button"
                    className="binge-saved-back"
                    onClick={() => setTab("home")}
                    aria-label="返回首页"
                    title="返回"
                >
                    <ChevronLeft />
                </button>
                <h1 className="binge-saved-title">设置</h1>
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
                <BingeServerRow />
                <BingeServerConfigCard />
                <ForageUrlRow />
                <ForageTargetRow />
                <RefractRow />
                <ShowcaseRow />
                <DemoRow />
                <DebugRow />
            </div>
        </div>
    );
}

// ── Individual setting rows ──────────────────────────────────────────

function TranscodeRow() {
    const value = useTranscodeType();
    return (
        <SettingRow
            title="流媒体类型"
            description="视频如何传输到 binge reel。自动跟随 Stash 的转码规则。直连跳过转码（最适合已兼容的格式）。MP4/WebM 强制转码输出。HLS 使用分块流式传输。"
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
                <option value="auto">自动（Stash 决定）</option>
                <option value="direct">直连（无转码）</option>
                <option value="mp4">转码 MP4</option>
                <option value="webm">转码 WebM</option>
                <option value="hls">HLS 流式传输</option>
            </select>
        </SettingRow>
    );
}

function GenderRow() {
    const allowed = useAllowedGenders();
    const toggle = (g: Gender) => {
        const next = new Set(allowed);
        if (next.has(g)) next.delete(g);
        else next.add(g);
        setAllowedGenders(next);
    };
    return (
        <SettingRow
            title="显示的性别"
            description="这些性别的演员会出现在首页发现动态和探索的“发现演员”行中。默认为女性 + 跨性别女性；切换其他以扩大范围。"
        >
            <div
                className="binge-settings-gender-row"
                role="group"
                aria-label="显示的性别"
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
    { value: "FEMALE", label: "女性" },
    { value: "MALE", label: "男性" },
    { value: "TRANSGENDER_FEMALE", label: "跨性别女性" },
    { value: "TRANSGENDER_MALE", label: "跨性别男性" },
    { value: "NON_BINARY", label: "非二元" },
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
    return (
        <SettingRow
            title="在动态中显示图库"
            description="将图库帖子（图集）混入首页动态中与场景一起展示。关闭则只看场景。"
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setShowGalleries(v)}
                label="显示图库"
            />
        </SettingRow>
    );
}

function LookbackRow() {
    const value = useLookbackDays();
    return (
        <SettingRow
            title="近期窗口"
            description="首页“新”内容的回溯范围。同时影响故事栏和初始动态加载。窗口越短越紧凑；窗口越长展示更多内容，但库较大时首屏加载会变慢。"
        >
            <select
                className="binge-settings-select"
                value={String(value)}
                onChange={(e) => setLookbackDays(parseInt(e.target.value, 10))}
            >
                {ALLOWED_LOOKBACK_DAYS.map((days) => (
                    <option key={days} value={String(days)}>
                        {lookbackLabel(days)}
                    </option>
                ))}
            </select>
        </SettingRow>
    );
}

function StashDBRow() {
    const value = useIncludeStashDB();
    return (
        <SettingRow
            title="在故事中包含 StashDB 新发布"
            description="故事栏也会展示你库中演员在 StashDB 上的新发布（你尚未拥有的内容）。需要在 Stash → 设置 → 元数据提供商 → StashBox 中配置 StashDB API 密钥。结果缓存 12 小时。"
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
    return (
        <SettingRow
            title="将 StashDB 场景混入演员档案"
            description="查看库中演员档案时，也展示其 StashDB 目录中你尚未拥有的场景——按日期与库中场景交错排列。点击仅存在于 StashDB 的场景会打开与发现动态相同的加入库弹窗。"
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setIncludeStashDBInProfile(v)}
                label="档案中的 StashDB"
            />
        </SettingRow>
    );
}

function RedditRow() {
    const value = useIncludeReddit();
    return (
        <SettingRow
            title="在故事中包含 Reddit 帖子"
            description="故事栏展示个人资料含 reddit.com 链接的演员在 Reddit 上的新提交。需要 binge-server 运行（在下方设置 URL）并在 reddit.com 上配置一个 script-app。关闭守护进程则自动跳过。"
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
    return (
        <SettingRow
            title="在档案中包含 X (Twitter) 媒体"
            description="为个人资料含 twitter.com / x.com 链接的演员档案添加一个 X 标签页，按需获取。需要 binge-server 运行（在下方设置 URL）并配置 X cookies。关闭守护进程或无 cookies 则自动跳过。"
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
    return (
        <SettingRow
            title="包含 PornHub 视频"
            description="将演员的 PornHub 视频折叠进其场景网格（新上传加入故事栏），适用于个人资料含 pornhub.com pornstar/model 链接的演员。悬停播放预览；点击流式播放；保存则下载到 Stash。需要 binge-server。关闭守护进程则自动跳过。"
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
    // Local edit buffer so typing doesn't trigger pubsub on every
    // keystroke. We commit on blur (and resync if the user changes
    // the value in another tab via the storage event).
    const [draft, setDraft] = useState(stored);
    useEffect(() => {
        setDraft(stored);
    }, [stored]);

    return (
        <SettingRow
            title="binge-server URL"
            description="binge-server 守护进程的 HTTP 地址。默认为 http://localhost:7878——如果你在其他主机或端口上运行 binge-server，请更改此项。状态点会 ping /healthz。"
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
            ? "binge-server 可达"
            : state === "down"
              ? "binge-server 不可达"
              : "检查中…";
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
    const url = useBingeServerUrl();
    const [health, setHealth] = useState<BingeServerHealth | null | "pending">(
        "pending"
    );
    const [config, setConfig] = useState<BingeServerConfigState | null>(null);
    const [cookieInput, setCookieInput] = useState("");
    const [cookieBusy, setCookieBusy] = useState(false);
    const [cookieError, setCookieError] = useState<string | null>(null);
    const [cookieSaved, setCookieSaved] = useState(false);
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
                        binge-server 配置
                    </h3>
                    <span className="binge-settings-card-status">
                        <span className="binge-settings-status-dot is-pending" />
                        检查中…
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
                        binge-server 配置
                    </h3>
                    <span className="binge-settings-card-status">
                        <span className="binge-settings-status-dot is-down" />
                        不可达
                    </span>
                </div>
                <p className="binge-settings-card-description">
                    在 <code>{url}</code> 上无法连接到守护进程。在它运行之前，Reddit
                    故事会被静默跳过。{" "}
                    <a
                        href="https://github.com/ordureconnoisseur/binge-server"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="binge-settings-card-link"
                    >
                        设置 binge-server →
                    </a>
                </p>
            </div>
        );
    }

    // Daemon is reachable — render the full config card.
    const stashKeyState = config?.stashApiKeySet
        ? "✓ 已自动检测"
        : "配置中…";
    const cookieIsSet = !!config?.redditCookieSet;
    const xCookiesSet = !!config?.xCookiesSet;

    return (
        <div className="binge-settings-card">
            <div className="binge-settings-card-header">
                <h3 className="binge-settings-card-title">
                    binge-server 配置
                </h3>
                <span className="binge-settings-card-status">
                    <span className="binge-settings-status-dot is-ok" />
                    已连接
                    {health.lastPoll && (
                        <span className="binge-settings-card-status-meta">
                            · {health.performerCount} 名演员 ·{" "}
                            上次轮询 {formatRelative(health.lastPoll)}
                        </span>
                    )}
                </span>
            </div>
            <p className="binge-settings-card-description">
                守护进程代表你轮询 Reddit 所使用的凭据。Stash API
                密钥会自动填入；Reddit 会话 Cookie 需要你手动粘贴（它保存在你的浏览器中，不在 Stash 中）。
            </p>

            <div className="binge-settings-card-field">
                <span className="binge-settings-card-field-label">
                    Stash API 密钥
                </span>
                <span className="binge-settings-card-field-value">
                    {stashKeyState}
                </span>
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    Reddit 会话 Cookie
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
                                ? "✓ 已设置 · 粘贴新值以轮换"
                                : "粘贴你的 reddit_session 值"
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
                        {cookieBusy ? "保存中…" : "保存"}
                    </button>
                </div>
                {cookieError && (
                    <p className="binge-server-config-error">
                        {cookieError}
                    </p>
                )}
                {cookieSaved && (
                    <p className="binge-server-config-ok">已保存 ✓</p>
                )}
                <button
                    type="button"
                    className="binge-server-config-help-toggle"
                    onClick={() => setShowHelp((v) => !v)}
                >
                    {showHelp ? "▾" : "▸"} 如何找到你的 Reddit cookie
                </button>
                {showHelp && (
                    <ol className="binge-server-config-help">
                        <li>
                            在普通浏览器标签页中登录 reddit.com。
                        </li>
                        <li>
                            打开开发者工具（F12）→ Application → Cookies
                            → https://www.reddit.com
                        </li>
                        <li>
                            找到名为{" "}
                            <code>reddit_session</code> 的行，复制其
                            Value 列（一长串类似 JWT 的字符串），粘贴到上方。
                        </li>
                        <li>
                            Cookie 每几个月过期。当故事停止更新时，重复步骤 1–3。
                        </li>
                    </ol>
                )}
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    X (Twitter) cookies
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
                                ? "✓ 已设置 · 粘贴 auth_token 以轮换"
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
                        {xBusy ? "保存中…" : "保存"}
                    </button>
                </div>
                {xError && (
                    <p className="binge-server-config-error">{xError}</p>
                )}
                {xSaved && <p className="binge-server-config-ok">已保存 ✓</p>}
                <button
                    type="button"
                    className="binge-server-config-help-toggle"
                    onClick={() => setShowXHelp((v) => !v)}
                >
                    {showXHelp ? "▾" : "▸"} 如何找到你的 X cookies
                </button>
                {showXHelp && (
                    <ol className="binge-server-config-help">
                        <li>在普通浏览器标签页中登录 x.com。</li>
                        <li>
                            打开开发者工具（F12）→ Application → Cookies →
                            https://x.com
                        </li>
                        <li>
                            复制 <code>auth_token</code>{" "}
                            和 <code>ct0</code> 的 Value 到上方字段，然后保存。
                        </li>
                        <li>
                            如有可能，建议使用副 X 账号——自动化访问违反 X 的条款。Cookie
                            会定期过期；当 X 媒体停止加载时请重新粘贴。
                        </li>
                    </ol>
                )}
            </div>

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    保存到 Stash 的库路径{" "}
                    {config?.socialSaveConfigured ? "✓" : ""}
                </span>
                <p className="binge-settings-card-description">
                    保存的 X/Reddit/Redgifs 帖子写入位置。两个路径是因为守护进程和 Stash 可能在不同主机上：第一个是 binge-server 写入的位置；第二个是 Stash 看到的同一文件夹（一个 Stash 库路径）。当它们是同一台机器时，两者相同。
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
                    placeholder="守护进程写入路径，例如 /library/social"
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
                        placeholder="Stash 路径，例如 Z:\Media\social"
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
                        {socBusy ? "保存中…" : "保存"}
                    </button>
                </div>
                {socError && (
                    <p className="binge-server-config-error">{socError}</p>
                )}
                {socSaved && (
                    <p className="binge-server-config-ok">已保存 ✓</p>
                )}
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
    if (secs < 60) return "刚刚";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    return `${days} 天前`;
}

// ── forage integration rows ─────────────────────────────────────────
// "Send to forage" on a discovery card adds that StashDB scene to the
// forage daemon's watchlist. These rows point binge at the daemon.

function ForageUrlRow() {
    const stored = useForageUrl();
    const [draft, setDraft] = useState(stored);
    useEffect(() => {
        setDraft(stored);
    }, [stored]);

    return (
        <SettingRow
            title="forage 服务器 URL"
            description="你的 forage 守护进程的基础 URL（例如 https://forage.tailf01ca.ts.net）。当此守护进程可达时，发现场景上会出现“发送到 forage”。认证是自动的——binge 出示你的 Stash API 密钥，forage 已信任它；无需粘贴任何内容。状态点会 ping /healthz。"
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
            ? "forage 可达"
            : state === "down"
              ? "forage 不可达"
              : "检查中…";
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
    return (
        <SettingRow
            title="forage 监看质量"
            description="当你发送场景到 forage 时，这是它在标记发布可抓取前等待的质量。“任意”会在任意分辨率的第一个发布出现时即展示。"
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
                        {t === "any" ? "任意发布" : t}
                    </option>
                ))}
            </select>
        </SettingRow>
    );
}

function RefractRow() {
    const value = useRefractIntegration();
    return (
        <SettingRow
            title="跟随 refract 强调色"
            description="如果你也使用 refract 主题，binge 的强调色将匹配你在 Stash 设置中选择的 refract 强调色（橙色 / 青色 / 粉色 / 黄色 / 紫色 / 绿色 / 蓝绿色）。故事环始终保留 Instagram 标志性的渐变。"
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setRefractIntegration(v)}
                label="跟随 refract 强调色"
            />
        </SettingRow>
    );
}

function ShowcaseRow() {
    const value = useShowcaseBlur();
    return (
        <SettingRow
            title="展示模式（模糊所有媒体）"
            description="模糊 binge 中所有图片、视频和头像，同时保持界面清晰——用于截图、演示录制或屏幕共享而不暴露库内容。不会上传或修改任何内容；仅为浏览器内的显示滤镜。快捷键：|（Shift + \\）"
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setShowcaseBlur(v)}
                label="展示模糊"
            />
        </SettingRow>
    );
}

function DemoRow() {
    const value = useDemoMode();
    return (
        <SettingRow
            title="演示内容"
            description="用虚构的、SFW 占位内容（渐变 + 虚构名字）替换你的库，用于录制营销素材——不显示真实的演员、场景或媒体。仅显示用；Stash 中无任何变化。"
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setDemoMode(v)}
                label="演示内容"
            />
        </SettingRow>
    );
}

function DebugRow() {
    const value = useShowDebug();
    return (
        <SettingRow
            title="显示调试覆盖层"
            description="固定一个小型诊断面板，显示已挂载的视频数量、JS 堆、滚动/标签页状态以及最近的 GraphQL 响应时间。快捷键：\\"
        >
            <SwitchToggle
                checked={value}
                onChange={(v) => setShowDebug(v)}
                label="调试覆盖层"
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

function lookbackLabel(days: number): string {
    if (days === 7) return "最近 7 天";
    if (days === 14) return "最近 14 天";
    if (days === 30) return "最近 30 天";
    if (days === 60) return "最近 60 天";
    if (days === 90) return "最近 90 天";
    return `最近 ${days} 天`;
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

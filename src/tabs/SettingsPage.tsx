import {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n/config";
import { getTagLanguage, syncTagLanguage } from "../api/collections";
import { useTab } from "./TabContext";
import { useAutoHideTabBar } from "../hooks/useAutoHideTabBar";
import {
    confirmDaemonOrigin,
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
    useLibraryFolderNames,
    setLibraryFolderNames,
    useGalleryIgnoreFolders,
    setGalleryIgnoreFolders,
    useShowcaseBlur,
    useTranscodeType,
    type ForageWatchTarget,
    type Gender,
    hasChosenBingeServer,
    useDaemonOriginsRevision,
} from "../home/pluginSettings";
import {
    daemonCanReachStashAt,
    isTrustedDaemonUrl,
    getBingeServerConfig,
    getBingeServerHealth,
    setBingeServerConfig,
    type BingeServerConfigState,
    type BingeServerHealth,
} from "../api/bingeServer";
import { getForageHealth } from "../api/forageServer";
import { parseCookiesTxt, describeParse } from "../api/cookiesTxt";
import { BingeServerInstallCard } from "./BingeServerInstallCard";
import { isLongDescription, matchesSettingQuery } from "./settingsSearch";
import {
    PLUGIN_ID_ADVANCED_RATING,
    PLUGIN_ID_MULTIVIEW,
    PLUGIN_ID_SCRIBE,
    useHasAdvancedRating,
    useHasMultiview,
    useHasScribe,
    usePluginLoaded,
} from "../plugins/PluginContext";
import { fetchStashApiKey } from "../api/queries";
import { getActiveSource, type ActiveSource } from "../api/source";
import { getLinkedPerformers } from "../api/stashdb";
import { DEFAULT_LIBRARY_FOLDER_NAMES } from "../home/impliedSource";
import { DEFAULT_GALLERY_IGNORE_FOLDERS } from "../home/galleryNoise";

// Which of binge's neighbours are installed, and what each one adds.
//
// Several features here are not binge's at all: the per-criterion
// rating modal, the multiview grid and the Scribe pencil all belong to
// other plugins and simply do not appear without them. That is the
// right behaviour and the wrong presentation, because a feature you
// have read about and cannot find reads as broken. Naming them, saying
// what each adds and whether it is present, turns an invisible
// dependency into a choice.
const COMPANIONS: {
    id: string;
    name: string;
    addsKey: string;
    url?: string;
}[] = [
    {
        id: PLUGIN_ID_ADVANCED_RATING,
        name: "Advanced Rating",
        addsKey: "settings.companion.advanced_rating",
        url: "https://github.com/ordureconnoisseur/stash-advanced-rating",
    },
    {
        id: PLUGIN_ID_MULTIVIEW,
        name: "Multiview",
        addsKey: "settings.companion.multiview",
        url: "https://github.com/ordureconnoisseur/stash-multiview",
    },
    {
        id: PLUGIN_ID_SCRIBE,
        name: "Scribe",
        addsKey: "settings.companion.scribe",
    },
];

function CompanionPluginsCard() {
    // The named helpers cover one plugin each; this card wants them
    // side by side.
    const { t } = useTranslation();
    const loaded = usePluginLoaded();
    const present: Record<string, boolean> = {
        [PLUGIN_ID_ADVANCED_RATING]: useHasAdvancedRating(),
        [PLUGIN_ID_MULTIVIEW]: useHasMultiview(),
        [PLUGIN_ID_SCRIBE]: useHasScribe(),
    };
    if (!loaded) return null;
    return (
        <div className="binge-settings-card">
            <p className="binge-settings-card-description">
                {t("settings.companion.hint")}
            </p>
            <ul className="binge-companion-list">
                {COMPANIONS.map((c) => {
                    const installed = present[c.id] === true;
                    return (
                        <li key={c.id} className="binge-companion">
                            <div className="binge-companion-head">
                                <span className="binge-companion-name">
                                    {c.name}
                                </span>
                                <span
                                    className={
                                        "binge-companion-state" +
                                        (installed ? " is-present" : "")
                                    }
                                >
                                    {installed
                                        ? t("settings.companion.installed")
                                        : t("settings.companion.not_enabled")}
                                </span>
                            </div>
                            <p className="binge-companion-adds">
                                {t(c.addsKey)}
                                {!installed && c.url && (
                                    <>
                                        {" "}
                                        <a
                                            href={c.url}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="binge-settings-card-link"
                                        >
                                            {t("settings.companion.get_it")}
                                        </a>
                                    </>
                                )}
                            </p>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

// In-app settings page — all preferences that used to live in Stash's
// plugin settings UI now live here. Same localStorage keys + pubsub,
// so any change here propagates to open Reel slides immediately.
// What the filter box currently holds. Every row reads it and decides
// for itself whether to render, so the searchable text of a setting is
// its own title and description rather than a second copy kept in a
// registry that would drift the first time someone reworded one.
const SettingsFilterContext = createContext("");

// The sections, in the order someone looks for things rather than the
// order the features were built. What appears on Home comes first,
// because that is what people open this page to change. The two daemons
// come last, because most installs never touch them.
export function SettingsPage() {
    const { setTab } = useTab();
    const scrollRef = useRef<HTMLDivElement>(null);
    const { t } = useTranslation();
    useAutoHideTabBar(scrollRef);
    const [query, setQuery] = useState("");

    // Reddit, X and PornHub are all served by binge-server. Without one
    // configured those three switches do nothing whatsoever, and the
    // page used to present them exactly like the switches that work.
    // Reading the stored URL costs no request and is honest: it says
    // the feature needs something not set up yet, rather than letting
    // someone switch it on and wonder why nothing ever arrives.
    //
    // The verdict comes from hasChosenBingeServer(), not from the URL:
    // useBingeServerUrl() falls back to http://<this host>:7878, so it
    // is NEVER empty and a test against it would have been dead code
    // that quietly never fired. The hook is still called, to re-render
    // this page when the URL is written from the card below.
    useBingeServerUrl();
    const needsDaemon = hasChosenBingeServer()
        ? null
        : t("settings.needs_daemon");

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

            <div className="binge-settings-toolbar">
                <div className="binge-settings-search">
                    <SearchIcon />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t("settings.search_placeholder")}
                        aria-label={t("settings.search_placeholder")}
                        spellCheck={false}
                        autoComplete="off"
                    />
                    {query !== "" && (
                        <button
                            type="button"
                            className="binge-settings-search-clear"
                            onClick={() => setQuery("")}
                            aria-label={t("settings.search_clear")}
                        >
                            &times;
                        </button>
                    )}
                </div>
            </div>

            <SettingsFilterContext.Provider value={query}>
                <div
                    className={
                        "binge-settings-list" +
                        (query.trim() !== "" ? " is-filtering" : "")
                    }
                >
                    <SettingsSection
                        label={t("settings.section_feed")}
                        hint={t("settings.section_feed_hint")}
                    >
                        <GenderRow />
                        <LookbackRow />
                        <GalleriesRow />
                        <GalleryIgnoreRow />
                        <LibraryFolderNamesRow />
                    </SettingsSection>

                    <SettingsSection
                        label={t("settings.section_sources")}
                        hint={t("settings.section_sources_hint")}
                    >
                        <SourceRow />
                        <StashDBRow />
                        <StashDBProfileRow />
                        <RedditRow requires={needsDaemon} />
                        <XRow requires={needsDaemon} />
                        <PornhubRow requires={needsDaemon} />
                    </SettingsSection>

                    <SettingsSection label={t("settings.section_playback")}>
                        <TranscodeRow />
                    </SettingsSection>

                    <SettingsSection label={t("settings.section_appearance")}>
                        <LanguageRow />
                        <ShowcaseRow />
                        <RefractRow />
                    </SettingsSection>

                    <SettingsSection
                        label={t("settings.section_companions")}
                        hint={t("settings.section_companions_hint")}
                    >
                        <Searchable text="plugins binge works with companion advanced rating multiview scribe">
                            <CompanionPluginsCard />
                        </Searchable>
                    </SettingsSection>

                    <SettingsSection
                        label="binge-server"
                        hint={t("settings.section_binge_server_hint")}
                    >
                        <Searchable text="binge-server install daemon reddit x twitter pornhub">
                            <BingeServerInstallCard />
                        </Searchable>
                        <BingeServerRow />
                        <Searchable text="binge-server configuration stash key reddit cookie x auth token library roots">
                            <BingeServerConfigCard />
                        </Searchable>
                    </SettingsSection>

                    <SettingsSection
                        label="forage"
                        hint={t("settings.section_forage_hint")}
                    >
                        <ForageUrlRow />
                        <ForageTargetRow />
                    </SettingsSection>

                    <SettingsSection label={t("settings.section_advanced")}>
                        <DebugRow />
                    </SettingsSection>

                    <p className="binge-settings-noresults">
                        {t("settings.no_results")}
                    </p>
                </div>
            </SettingsFilterContext.Provider>

            <SupportFooter />
        </div>
    );
}

// A titled group of settings. Hidden entirely once everything inside it
// has filtered itself out, which is done in CSS with :has() rather than
// by counting children here: a section cannot know whether its children
// rendered without them reporting back up, and an unsupported selector
// degrades to showing the section rather than to hiding the page.
function SettingsSection({
    label,
    hint,
    children,
}: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <section className="binge-settings-section">
            <div className="binge-settings-section-head">
                <h2 className="binge-settings-section-label">{label}</h2>
                {hint && <p className="binge-settings-section-hint">{hint}</p>}
            </div>
            <div className="binge-settings-group">{children}</div>
        </section>
    );
}

// Filter wrapper for the cards, which carry their own layout and so do
// not go through SettingRow. The text is what typing has to match.
function Searchable({ text, children }: { text: string; children: ReactNode }) {
    const query = useContext(SettingsFilterContext);
    if (!matchesSettingQuery(text, query)) return null;
    return <>{children}</>;
}

// Quiet footer under the settings list. No toggle, no dismiss state, no nag:
// it just sits at the bottom of the page for anyone who scrolls that far.
function SupportFooter() {
    const { t } = useTranslation();
    return (
        <p className="binge-settings-support">
            {t("settings.support_free")}{" "}
            <a
                href="https://github.com/sponsors/ordureconnoisseur"
                target="_blank"
                rel="noopener noreferrer"
            >
                {t("settings.support_sponsor")}
            </a>{" "}
            {t("settings.support_or")}{" "}
            <a
                href="https://ko-fi.com/ordureconnoisseur"
                target="_blank"
                rel="noopener noreferrer"
            >
                Ko-fi
            </a>{" "}
            {t("settings.support_chip_in")}
        </p>
    );
}

// ── Individual setting rows ──────────────────────────────────────────

function LanguageRow() {
    const { t, i18n } = useTranslation();
    const [tagLang, setTagLang] = useState(getTagLanguage());
    const [syncing, setSyncing] = useState(false);

    const needsSync = i18n.language !== tagLang;

    const handleSync = async () => {
        setSyncing(true);
        try {
            await syncTagLanguage(i18n.language);
            setTagLang(i18n.language);
        } catch (err) {
            console.warn("[binge] tag sync failed", err);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <>
            <SettingRow
                title={t("language")}
                description={t("language_desc")}
            >
                <select
                    className="binge-settings-select"
                    value={i18n.language}
                    onChange={(e) => i18n.changeLanguage(e.target.value)}
                >
                    <option value="zh">{t("zh")}</option>
                    <option value="en">{t("en")}</option>
                </select>
            </SettingRow>
            {needsSync && (
                <button
                    type="button"
                    className="binge-settings-sync-tags-btn"
                    onClick={handleSync}
                    disabled={syncing}
                >
                    {syncing
                        ? t("status.saving")
                        : t("settings.sync_tags", { lang: t(i18n.language) })}
                </button>
            )}
        </>
    );
}

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
                {GENDER_OPTIONS.map(({ value, labelKey, defaultLabel }) => {
                    const active = allowed.has(value);
                    const label = t(labelKey, defaultLabel);
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
    labelKey: string;
    defaultLabel: string;
}> = [
    { value: "FEMALE", labelKey: "settings.gender.female", defaultLabel: "女性" },
    { value: "MALE", labelKey: "settings.gender.male", defaultLabel: "男性" },
    { value: "TRANSGENDER_FEMALE", labelKey: "settings.gender.trans_female", defaultLabel: "跨性别女性" },
    { value: "TRANSGENDER_MALE", labelKey: "settings.gender.trans_male", defaultLabel: "跨性别男性" },
    { value: "NON_BINARY", labelKey: "settings.gender.non_binary", defaultLabel: "非二元" },
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

// Scenes with no performer linked are named after the folder they sit
// in. binge works out the library root by comparing the paths against
// each other, so this list only has to name the intermediate buckets
// that some scenes sit in and others do not. Which words those are is
// entirely a property of one person's disk, so it is theirs to set.
function LibraryFolderNamesRow() {
    const stored = useLibraryFolderNames();
    const joined = stored.join(", ");
    const [draft, setDraft] = useState(joined);
    const { t } = useTranslation();
    useEffect(() => {
        setDraft(joined);
    }, [joined]);

    return (
        <SettingRow
            layout="stacked"
            title={t("settings.library_folders.title")}
            description={t("settings.library_folders.desc")}
        >
            <div className="binge-settings-url-row">
                <input
                    type="text"
                    className="binge-settings-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                        if (draft !== joined)
                            setLibraryFolderNames(draft.split(","));
                    }}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder="unfiled, misc, new"
                />
                <button
                    type="button"
                    className="binge-settings-inline-btn"
                    onClick={() =>
                        setLibraryFolderNames(DEFAULT_LIBRARY_FOLDER_NAMES)
                    }
                >
                    {t("action.reset")}
                </button>
            </div>
        </SettingRow>
    );
}

// Galleries living in these folders are artwork rather than photo sets.
// Same reasoning as LibraryFolderNamesRow: which names those are is a
// fact about one person's disk, so it cannot be a constant in a plugin
// other people install.
function GalleryIgnoreRow() {
    const stored = useGalleryIgnoreFolders();
    const joined = stored.join(", ");
    const [draft, setDraft] = useState(joined);
    const { t } = useTranslation();
    useEffect(() => {
        setDraft(joined);
    }, [joined]);

    return (
        <SettingRow
            layout="stacked"
            title={t("settings.gallery_ignore.title")}
            description={t("settings.gallery_ignore.desc")}
        >
            <div className="binge-settings-url-row">
                <input
                    type="text"
                    className="binge-settings-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => {
                        if (draft !== joined)
                            setGalleryIgnoreFolders(draft.split(","));
                    }}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder="screen*, cover, proof"
                />
                <button
                    type="button"
                    className="binge-settings-inline-btn"
                    onClick={() =>
                        setGalleryIgnoreFolders(DEFAULT_GALLERY_IGNORE_FOLDERS)
                    }
                >
                    {t("action.reset")}
                </button>
            </div>
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

// 发现数据源只读展示（不是配置入口——源在 Stash 的插件设置页
// sourceEndpoint 配置，语义见 src/api/source.ts 头注释）。
//
// 健康四态：
//   - ok          活动源解析成功，且本地库有演员链接到它（联动可用）
//   - warn        源可用，但 0 位链接演员 → 发现流/stories 将为空
//                 （数据前提：需先用该实例刮削库，代码无法弥补）
//   - fault       stashBoxes 无匹配条目（无 API key）或本地查询失败
//   - pending     解析中
// 另有一行回退说明：配置的 endpoint 与 Stash 的 stash-box 列表
// 不匹配时说明已回退 stashdb.org 及原因，不静默。
type SourceRowState =
    | { kind: "pending" }
    | { kind: "fault" }
    | {
          kind: "resolved";
          host: string;
          fallbackReason: ActiveSource["fallbackReason"];
          health:
              | { kind: "no-key" }
              | { kind: "query-failed" }
              | { kind: "unlinked" }
              | { kind: "ok"; linked: number };
      };

function SourceRow() {
    const { t } = useTranslation();
    const [state, setState] = useState<SourceRowState>({ kind: "pending" });

    useEffect(() => {
        let alive = true;
        (async () => {
            let src: ActiveSource;
            try {
                src = await getActiveSource();
            } catch {
                if (alive) setState({ kind: "fault" });
                return;
            }
            if (!alive) return;
            if (!src.apiKey) {
                setState({
                    kind: "resolved",
                    host: src.host,
                    fallbackReason: src.fallbackReason,
                    health: { kind: "no-key" },
                });
                return;
            }
            // linked 计数复用 getLinkedPerformers 的查询（按活动源
            // endpoint 过滤）。失败（查询出错）与 0（库未用该实例
            // 刮削）必须区分：前者是故障，后者是数据前提。
            try {
                const linked = await getLinkedPerformers();
                if (!alive) return;
                setState({
                    kind: "resolved",
                    host: src.host,
                    fallbackReason: src.fallbackReason,
                    health:
                        linked.length > 0
                            ? { kind: "ok", linked: linked.length }
                            : { kind: "unlinked" },
                });
            } catch {
                if (!alive) return;
                setState({
                    kind: "resolved",
                    host: src.host,
                    fallbackReason: src.fallbackReason,
                    health: { kind: "query-failed" },
                });
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    // 状态点 + 附注的展示参数。warn 用黄字（数据前提，不是故障），
    // fault 用红（真故障）。
    let dot = "is-pending";
    let host = "…";
    let note = t("settings.source.status_pending");
    let noteKind = "";
    if (state.kind === "fault") {
        dot = "is-down";
        note = t("settings.source.status_fault");
        noteKind = "is-fault";
    } else if (state.kind === "resolved") {
        host = state.host;
        if (state.health.kind === "ok") {
            dot = "is-ok";
            note = t("settings.source.status_ok", {
                count: state.health.linked,
            });
        } else if (state.health.kind === "unlinked") {
            dot = "is-warn";
            note = t("settings.source.status_unlinked");
            noteKind = "is-warn";
        } else if (state.health.kind === "no-key") {
            dot = "is-down";
            note = t("settings.source.status_no_key");
            noteKind = "is-fault";
        } else {
            dot = "is-down";
            note = t("settings.source.status_query_failed");
            noteKind = "is-fault";
        }
    }

    return (
        <SettingRow
            layout="stacked"
            title={t("settings.source.title")}
            description={t("settings.source.desc")}
        >
            <div className="binge-settings-source-status">
                <span
                    className={`binge-settings-status-dot ${dot}`}
                    role="status"
                    aria-label={note}
                />
                <span className="binge-settings-source-host">{host}</span>
                <span
                    className={`binge-settings-source-note ${noteKind}`.trim()}
                >
                    {note}
                </span>
            </div>
            {state.kind === "resolved" &&
                state.fallbackReason === "no-match" && (
                    <p className="binge-settings-source-note is-warn">
                        {t("settings.source.fallback_no_match")}
                    </p>
                )}
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
                label={t("common.stashdb")}
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

function RedditRow({ requires }: { requires: string | null }) {
    const value = useIncludeReddit();
    const { t } = useTranslation();
    return (
        <SettingRow
            requires={requires}
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

function XRow({ requires }: { requires: string | null }) {
    const value = useIncludeX();
    const { t } = useTranslation();
    return (
        <SettingRow
            requires={requires}
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

function PornhubRow({ requires }: { requires: string | null }) {
    const value = useIncludePornhub();
    const { t } = useTranslation();
    return (
        <SettingRow
            requires={requires}
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
            layout="stacked"
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
                {/* Only once somebody has actually asked for a daemon.
                    Otherwise a fresh install showed a red fault dot
                    beside the very card explaining that binge-server is
                    optional, which is the thing this was meant to stop.
                    Read at render from the same source as the card, so
                    the two always agree. */}
                {hasChosenBingeServer() && (
                    <BingeServerHealthDot url={stored} />
                )}
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
    // Re-render when a daemon origin is confirmed.
    //
    // Without this the "Use this daemon" button below did nothing you
    // could see: it recorded the origin, then wrote the URL that was
    // already stored, and React's eager-state bailout skipped the
    // re-render because the string was identical. The warning stayed on
    // screen and the button read as broken. useDaemonOriginsRevision was
    // written for exactly this and never imported anywhere - its own
    // source calls it "the missing half".
    useDaemonOriginsRevision();
    const [health, setHealth] = useState<BingeServerHealth | null | "pending">(
        "pending"
    );
    const [config, setConfig] = useState<BingeServerConfigState | null>(null);
    const [cookieInput, setCookieInput] = useState("");
    const [cookieBusy, setCookieBusy] = useState(false);
    const [cookieError, setCookieError] = useState<string | null>(null);
    // Why the Stash key never got through. Silence here used to read as
    // "still working on it" no matter how long you waited.
    const [keyError, setKeyError] = useState<string | null>(null);
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
        // Runs on a null config too. A daemon that has no key yet refuses
        // GET /config, so config is null in exactly the case the push
        // exists to resolve; returning early here meant an unconfigured
        // daemon could never be configured from the browser at all.
        if (!health || health === "pending") return;
        if (config?.stashApiKeySet) return;
        let alive = true;
        (async () => {
            try {
                const apiKey = await fetchStashApiKey();
                if (!alive) return;
                if (!apiKey) {
                    // Stash with authentication switched off has no key to
                    // find. Nothing is wrong, but the card would otherwise
                    // claim to be setting one up forever.
                    setKeyError(
                        i18n.t("settings.server_config.key_missing_error"),
                    );
                    return;
                }
                // Only offer the browser's origin when the daemon could
                // actually use it. Stash behind a public domain was being
                // sent that public URL, which the daemon rejects outright,
                // so the whole write failed and the key never landed. In
                // that case say nothing about the URL and leave the
                // daemon's own value alone: it defaults to localhost,
                // which is right when it runs beside Stash.
                const origin = window.location.origin;
                const result = await setBingeServerConfig(
                    daemonCanReachStashAt(origin)
                        ? { stashUrl: origin, stashApiKey: apiKey }
                        : { stashApiKey: apiKey },
                );
                if (!alive) return;
                if (result.ok) {
                    setKeyError(null);
                    const refreshed = await getBingeServerConfig();
                    if (alive) setConfig(refreshed);
                } else {
                    // This used to be dropped, which is why a daemon
                    // refusing the write showed as a permanent
                    // "Setting up..." with no reason given anywhere.
                    setKeyError(result.error);
                }
            } catch (err) {
                if (alive)
                    setKeyError(
                        err instanceof Error ? err.message : String(err),
                    );
                console.warn("[binge] auto-push Stash API key failed", err);
            }
        })();
        return () => {
            alive = false;
        };
    }, [config, health]);

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
            setCookieError("error" in result ? result.error : t("status.unknown_error"));
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
            setXError("error" in result ? result.error : t("status.unknown_error"));
        }
        setXBusy(false);
    };

    const destinationHost = (() => {
        try {
            return new URL(url).host;
        } catch {
            return url;
        }
    })();

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
            setSocError("error" in result ? result.error : t("status.unknown_error"));
        }
        setSocBusy(false);
    };

    // binge is withholding the credentials from this URL, so the card
    // below could not do anything even though the daemon may answer.
    // Without this the only sign was a line in the browser console, and
    // the page cheerfully said Connected while nothing worked.
    if (!isTrustedDaemonUrl(url)) {
        const isHttps = url.trim().toLowerCase().startsWith("https:");
        return (
            <div className="binge-settings-card">
                <div className="binge-settings-card-header">
                    <h3 className="binge-settings-card-title">
                        {t("settings.server_config.title")}
                    </h3>
                </div>
                <p className="binge-server-config-stale">
                    <span className="binge-server-config-stale-icon">!</span>
                    <span>
                        {t("settings.server_config.not_sending")}{" "}
                        <code>{destinationHost}</code>.{" "}
                        {isHttps
                            ? t("settings.server_config.not_trusted_https")
                            : t("settings.server_config.not_trusted_http")}
                    </span>
                </p>
                {isHttps && (
                    <button
                        type="button"
                        className="binge-server-config-cookie-save"
                        onClick={() => {
                            // The revision hook above re-renders the
                            // card. Writing the URL back does not: it is
                            // the same string, so the store bails out.
                            confirmDaemonOrigin(url);
                        }}
                    >
                        {t("settings.server_config.use_this_daemon")}
                    </button>
                )}
            </div>
        );
    }

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

    if (health === null && !hasChosenBingeServer()) {
        // Nobody has asked for a daemon here. Reporting it as
        // unreachable, with a red dot, made an optional add-on look
        // like a broken required component on every fresh install: the
        // majority of people want the reel and their own library and
        // never wanted Reddit at all. Say what it would add, and
        // otherwise stay out of the way.
        return (
            <div className="binge-settings-card">
                <div className="binge-settings-card-header">
                    <h3 className="binge-settings-card-title">
                        binge-server (optional)
                    </h3>
                </div>
                <p className="binge-settings-card-description">
                    {t("settings.server_config.optional_hint")}
                </p>
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
                    {t("settings.server_config.unreachable_desc", { url })}
                    {" "}
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
        : keyError
          ? t("settings.server_config.key_not_set")
          : t("settings.server_config.configuring");
    const cookieIsSet = !!config?.redditCookieSet;
    const xCookiesSet = !!config?.xCookiesSet;
    // Only set once the poller has actually been rejected, and cleared by
    // the daemon as soon as a working cookie is saved, so this does not
    // need its own dismissal.
    const cookieExpiredAt = config?.redditCookieExpiredAt;
    const expiredAgo = cookieExpiredAt ? relativeOrEmpty(cookieExpiredAt) : "";

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
                            {t("settings.server_config.poll_meta", {
                                count: health.performerCount,
                                time: formatRelative(health.lastPoll)
                            })}
                        </span>
                    )}
                </span>
            </div>
            <p className="binge-settings-card-description">
                {t("settings.server_config.desc")}
            </p>
            {/* Name the destination where the secrets are entered. The
                daemon URL is a setting, and a setting can be changed by
                something other than you, so the one place that must never
                be ambiguous is the moment you hand over a credential. */}
            <p className="binge-settings-card-destination">
                {t("settings.server_config.sending_to")}{" "}
                <code>{destinationHost}</code>
            </p>

            <div className="binge-settings-card-field">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.stash_api_key")}
                </span>
                <span className="binge-settings-card-field-value">
                    {stashKeyState}
                </span>
            </div>
            {keyError && !config?.stashApiKeySet && (
                <p className="binge-server-config-error">{keyError}</p>
            )}

            {cookieExpiredAt && (
                <p className="binge-server-config-stale">
                    <span className="binge-server-config-stale-icon">!</span>
                    <span>
                        {expiredAgo
                            ? t("settings.server_config.cookie_expired_notice_with_time", {
                                  ago: expiredAgo,
                              })
                            : t("settings.server_config.cookie_expired_notice")}
                    </span>
                </p>
            )}

            <div className="binge-settings-card-field is-stacked">
                <span className="binge-settings-card-field-label">
                    {t("settings.server_config.import_cookies")}
                </span>
                <div className="binge-cookies-import">
                    <label className="binge-install-btn is-secondary">
                        {importBusy
                            ? t("settings.server_config.import_reading")
                            : t("settings.server_config.import_choose_file")}
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
                            cookieExpiredAt
                                ? t("settings.server_config.cookie_expired")
                                : cookieIsSet
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
                    <p className="binge-server-config-error">
                        {cookieError}
                    </p>
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
                        <li>
                            {t("settings.server_config.help_reddit_1")}
                        </li>
                        <li>
                            {t("settings.server_config.help_reddit_2")}
                        </li>
                        <li>
                            {t("settings.server_config.help_reddit_3")}
                        </li>
                        <li>
                            {t("settings.server_config.help_reddit_4")}
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
                {socSaved && (
                    <p className="binge-server-config-ok">{t("status.saved")}</p>
                )}
            </div>
        </div>
    );
}

/// Same as formatRelative, but yields "" rather than a placeholder when
/// the timestamp is unusable, so callers can drop the clause entirely
/// instead of printing punctuation with nothing in it.
function relativeOrEmpty(iso: string): string {
    return Number.isFinite(Date.parse(iso)) ? formatRelative(iso) : "";
}

// Compact relative-time formatter: "2 min ago", "3 h ago", "yesterday".
function formatRelative(iso: string): string {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "unknown";
    const diffMs = Date.now() - t;
    const secs = Math.floor(diffMs / 1000);
    // Notice: to properly translate relative times in a pure function, we need i18next instance directly.
    // For simplicity, we assume i18next is available globally or we use it here.
    // I will replace this with simple translation using i18n instance.
    const tFunc = i18n.t;
    if (secs < 60) return tFunc("time.just_now", "刚刚");
    const mins = Math.floor(secs / 60);
    if (mins < 60) return tFunc("time.minutes_ago", "{{count}} 分钟前", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return tFunc("time.hours_ago", "{{count}} 小时前", { count: hours });
    const days = Math.floor(hours / 24);
    return tFunc("time.days_ago", "{{count}} 天前", { count: days });
}

// ── forage integration rows ─────────────────────────────────────────
// "Send to forage" on a discovery card adds that StashDB scene to the
// forage daemon's watchlist. These rows point binge at the daemon.

function ForageUrlRow() {
    const stored = useForageUrl();
    const [draft, setDraft] = useState(stored);
    const { t } = useTranslation();
    // forage 的 watch 语义绑定 stashdb.org 的 scene id。活动数据源
    // 非默认源时"发送到 forage"整体禁用（见 forageServer.ts 的
    // forageAvailable）；此处用 badge 说明原因，而不是让入口静默
    // 消失。
    const [sourceLimited, setSourceLimited] = useState(false);
    useEffect(() => {
        let alive = true;
        getActiveSource()
            .then((s) => {
                if (alive) setSourceLimited(!s.isDefault);
            })
            .catch(() => {
                /* 配置读取失败 → 按默认源放行，不显示 badge */
            });
        return () => {
            alive = false;
        };
    }, []);
    useEffect(() => {
        setDraft(stored);
    }, [stored]);

    return (
        <SettingRow
            layout="stacked"
            title={t("settings.forage_url.title")}
            description={t("settings.forage_url.desc")}
            requires={
                sourceLimited
                    ? t("settings.forage_url.source_limited")
                    : null
            }
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
                {ALLOWED_FORAGE_TARGETS.map((targetOption) => (
                    <option key={targetOption} value={targetOption}>
                        {targetOption === "any" ? t("settings.forage_target.any") : targetOption}
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
    layout = "inline",
    requires = null,
    children,
}: {
    title: string;
    description: string;
    // "stacked" puts the control on its own line under the text.
    //
    // The inline layout gives the control whatever width it asks for
    // and the text whatever is left. That is fine for a switch and a
    // disaster for a text field: .binge-settings-input asks for 16rem,
    // a Reset button sits beside it, and at 430px, which is the width
    // binge is mostly used at, roughly forty pixels were left for the
    // title. "Gallery folders to ignore" came out one word per line,
    // over four lines, above forty more lines of description set one
    // word wide. Four rows did this and between them they were about a
    // quarter of the page's height.
    layout?: "inline" | "stacked";
    // Why this setting cannot do anything yet, if it cannot. Shown as a
    // quiet badge; the control stays live so it can be set up in
    // advance.
    requires?: string | null;
    children: ReactNode;
}) {
    const query = useContext(SettingsFilterContext);
    const [expanded, setExpanded] = useState(false);
    const { t } = useTranslation();

    if (!matchesSettingQuery(title + " " + description, query)) return null;

    // Long descriptions fold away. Not deleted: several of them are the
    // only place a non-obvious behaviour is written down, and the ones
    // that read as over-explained on the tenth visit are exactly the
    // ones that are load-bearing on the first. Folded, the page is a
    // list of settings again; unfolded, nothing has been lost.
    //
    // While filtering, everything is open, so a match inside a folded
    // description is not hidden by the fold that the search caused.
    const foldable = isLongDescription(description);
    const open = expanded || query.trim() !== "";

    return (
        <div
            className={
                "binge-settings-row" +
                (layout === "stacked" ? " is-stacked" : "") +
                (requires ? " is-unmet" : "")
            }
        >
            <div className="binge-settings-row-text">
                <h3 className="binge-settings-row-title">
                    {title}
                    {requires && (
                        <span className="binge-settings-row-badge">
                            {requires}
                        </span>
                    )}
                </h3>
                <p
                    className={
                        "binge-settings-row-description" +
                        (foldable && !open ? " is-folded" : "")
                    }
                >
                    {description}
                </p>
                {foldable && query.trim() === "" && (
                    <button
                        type="button"
                        className="binge-settings-row-more"
                        onClick={() => setExpanded((v) => !v)}
                        aria-expanded={expanded}
                    >
                        {expanded
                            ? t("settings.show_less")
                            : t("settings.show_more")}
                    </button>
                )}
            </div>
            <div className="binge-settings-row-control">{children}</div>
        </div>
    );
}

function SearchIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
        >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.2-3.2" />
        </svg>
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

// lookbackLabel unused now

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

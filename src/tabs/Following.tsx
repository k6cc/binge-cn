import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    findAllPerformers,
    type PerformerSummary,
} from "../api/queries";
import { useSharedStories } from "../home/StoriesContext";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { useAutoHideTabBar } from "../hooks/useAutoHideTabBar";
import { useSearchHistory } from "../hooks/useSearchHistory";
import { SearchHistoryDropdown } from "../components/SearchHistoryDropdown";
import { BingeLoading } from "../components/BingeLoading";
import { useScrollToTop } from "../hooks/useScrollToTop";
import { ScrollTopButton } from "../components/ScrollTopButton";

type LoadState =
    | { kind: "loading" }
    | { kind: "ready"; performers: PerformerSummary[] }
    | { kind: "error"; message: string };

type SortMode =
    | "name-asc"
    | "name-desc"
    | "scenes-desc"
    | "scenes-asc"
    | "last-post-desc"
    | "last-post-asc";

//
type LastPostMap = Map<string, string>;

function sortPerformers(
    list: PerformerSummary[],
    mode: SortMode,
    lastPost: LastPostMap
): PerformerSummary[] {
    const copy = list.slice();
    switch (mode) {
        case "name-asc":
            return copy.sort((a, b) =>
                a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
            );
        case "name-desc":
            return copy.sort((a, b) =>
                b.name.localeCompare(a.name, undefined, { sensitivity: "base" })
            );
        case "scenes-desc":
            return copy.sort(
                (a, b) => (b.scene_count ?? 0) - (a.scene_count ?? 0)
            );
        case "scenes-asc":
            return copy.sort(
                (a, b) => (a.scene_count ?? 0) - (b.scene_count ?? 0)
            );
        case "last-post-desc":
            // Performers with NO recent activity sort to the bottom in
            // newest-first; we use empty string as a sentinel that
            // localeCompare sees as smaller than any real ISO timestamp.
            return copy.sort((a, b) => {
                const av = lastPost.get(a.id) ?? "";
                const bv = lastPost.get(b.id) ?? "";
                return bv.localeCompare(av);
            });
        case "last-post-asc":
            // Performers with NO recent activity sort to the bottom in
            // oldest-first too — treat "unknown" as max via "￿".
            return copy.sort((a, b) => {
                const av = lastPost.get(a.id) ?? "￿";
                const bv = lastPost.get(b.id) ?? "￿";
                return av.localeCompare(bv);
            });
    }
}

// Following tab: favourited performers up top, all others below, both
// filterable by a single search box and sortable via a small dropdown.
// Performers without scenes are still shown — Stash treats them as
// "in your library" even when they have zero linked scenes.
export function Following() {
    const [state, setState] = useState<LoadState>({ kind: "loading" });
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState<SortMode>("name-asc");
    const [searchFocused, setSearchFocused] = useState(false);
    // 输入法合成标记：合成中不保存搜索词，避免预输入误存
    const composingRef = useRef(false);
    const { openProfile } = usePerformerProfile();
    const { history: performerSearchHistory, addEntry: addPerformerSearchEntry, removeEntry: removePerformerSearchEntry, scheduleSave: schedulePerformerSave } =
        useSearchHistory("performers");
    const scrollRef = useRef<HTMLDivElement>(null);
    useAutoHideTabBar(scrollRef);
    const { show: showScrollTop, scrollToTop } = useScrollToTop(scrollRef);
    const { t } = useTranslation();
    const SORT_OPTIONS: { value: SortMode; label: string }[] = useMemo(() => [
        { value: "name-asc", label: t("sort.name_asc") },
        { value: "name-desc", label: t("sort.name_desc") },
        { value: "scenes-desc", label: t("sort.scenes_desc") },
        { value: "scenes-asc", label: t("sort.scenes_asc") },
        { value: "last-post-desc", label: t("sort.last_post_desc") },
        { value: "last-post-asc", label: t("sort.last_post_asc") },
    ], [t]);

    // Re-use the same useStories() data Home renders — already merged
    // (library + StashDB + Reddit) and cached. The per-performer
    // `latestEffectiveAt` is exactly what we need for "last activity".
    const stories = useSharedStories();
    const lastPost = useMemo<LastPostMap>(() => {
        const map: LastPostMap = new Map();
        if (stories.state.kind !== "ready") return map;
        for (const s of stories.state.stories) {
            map.set(s.performerId, s.latestEffectiveAt);
        }
        return map;
    }, [stories.state]);

    useEffect(() => {
        let alive = true;
        findAllPerformers()
            .then((performers) => {
                if (!alive) return;
                setState({ kind: "ready", performers });
            })
            .catch((err: Error) => {
                if (!alive) return;
                setState({ kind: "error", message: err.message });
            });
        return () => {
            alive = false;
        };
    }, []);

    // Filter pass — only re-runs on search/state change. Splitting
    // this from the sort means a single keystroke doesn't re-sort a
    // 1000+ performer library; only the cheaper substring filter
    // re-runs.
    const filtered = useMemo(() => {
        if (state.kind !== "ready") {
            return { fav: [] as PerformerSummary[], oth: [] as PerformerSummary[] };
        }
        const q = search.trim().toLowerCase();
        const source = q
            ? state.performers.filter((p) =>
                  p.name.toLowerCase().includes(q)
              )
            : state.performers;
        const fav: PerformerSummary[] = [];
        const oth: PerformerSummary[] = [];
        for (const p of source) {
            (p.favorite ? fav : oth).push(p);
        }
        return { fav, oth };
    }, [state, search]);

    // Sort pass — only re-runs when sort mode or activity data changes.
    const { favourites, others } = useMemo(
        () => ({
            favourites: sortPerformers(filtered.fav, sort, lastPost),
            others: sortPerformers(filtered.oth, sort, lastPost),
        }),
        [filtered, sort, lastPost]
    );

    return (
        <div className="binge-tab-scroll" ref={scrollRef}>
            <div className="binge-tab-inner">
                <h1 className="binge-tab-title">{t("nav.following")}</h1>

                <div className="binge-following-controls">
                    <div className="binge-search-wrap">
                        <input
                            type="search"
                            className="binge-following-search"
                            placeholder={t("nav.search_performers")}
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                if (!composingRef.current) {
                                    schedulePerformerSave(e.target.value);
                                }
                            }}
                            onCompositionStart={() => {
                                composingRef.current = true;
                            }}
                            onCompositionEnd={(e) => {
                                composingRef.current = false;
                                // setTimeout(0)：compositionend 触发时 input.value
                                // 可能还是合成前的旧值，延迟到下一个事件循环读取
                                const target = e.currentTarget;
                                window.setTimeout(() => {
                                    schedulePerformerSave(target.value);
                                }, 0);
                            }}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => {
                                addPerformerSearchEntry(search);
                                setSearchFocused(false);
                            }}
                            aria-label={t("nav.search_performers")}
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                        />
                        {searchFocused && (
                            <SearchHistoryDropdown
                                history={performerSearchHistory}
                                query={search}
                                onPick={(term) => {
                                    setSearch(term);
                                    setSearchFocused(false);
                                }}
                                onRemove={removePerformerSearchEntry}
                            />
                        )}
                    </div>
                    <select
                        className="binge-following-sort"
                        value={sort}
                        onChange={(e) => setSort(e.target.value as SortMode)}
                        aria-label={t("nav.sort_performers")}
                    >
                        {SORT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                {state.kind === "loading" && <BingeLoading minHeight="60vh" />}
                {state.kind === "error" && (
                    <div className="binge-status binge-status-error">
                        {t("status.error_message", { message: state.message })}
                    </div>
                )}
                {state.kind === "ready" && (
                    <>
                        <Section
                            title={t("nav.favorites")}
                            count={favourites.length}
                            performers={favourites}
                            onPick={openProfile}
                            emptyHint={
                                state.performers.some((p) => p.favorite)
                                    ? t("status.no_match")
                                    : t("status.no_favorites")
                            }
                            favorite
                        />
                        <Section
                            title={t("nav.all_performers")}
                            count={others.length}
                            performers={others}
                            onPick={openProfile}
                            emptyHint={t("status.no_match")}
                            favorite={false}
                        />
                    </>
                )}
            </div>
            {showScrollTop && <ScrollTopButton onClick={scrollToTop} />}
        </div>
    );
}

function Section({
    title,
    count,
    performers,
    onPick,
    emptyHint,
    favorite,
}: {
    title: string;
    count: number;
    performers: PerformerSummary[];
    onPick: (id: string) => void;
    emptyHint: string;
    favorite: boolean;
}) {
    const { t } = useTranslation();
    return (
        <section className="binge-following-section">
            <header className="binge-following-section-head">
                <h2 className="binge-following-section-title">{title}</h2>
                <span className="binge-following-section-count">{count}</span>
            </header>
            {performers.length === 0 ? (
                <div className="binge-status binge-following-empty">
                    {emptyHint}
                </div>
            ) : (
                <ul className="binge-following-grid">
                    {performers.map((p) => (
                        <li key={p.id}>
                            <button
                                type="button"
                                className={
                                    "binge-follow-card" +
                                    (favorite ? " is-favorite" : "")
                                }
                                onClick={() => onPick(p.id)}
                            >
                                <span
                                    className="binge-follow-avatar"
                                    style={
                                        p.image_path
                                            ? {
                                                  backgroundImage: `url(${p.image_path})`,
                                              }
                                            : undefined
                                    }
                                >
                                    {!p.image_path && (
                                        <span className="binge-follow-initial">
                                            {p.name.charAt(0).toUpperCase()}
                                        </span>
                                    )}
                                </span>
                                <span className="binge-follow-name">
                                    {p.name}
                                </span>
                                {typeof p.scene_count === "number" &&
                                    p.scene_count > 0 && (
                                        <span className="binge-follow-count">
                                            {t("status.performer_scenes", { count: p.scene_count })}
                                        </span>
                                    )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

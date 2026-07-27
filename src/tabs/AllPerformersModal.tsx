import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    findAllPerformers,
    type PerformerSummary,
} from "../api/queries";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { useSearchHistory } from "../hooks/useSearchHistory";
import { SearchHistoryDropdown } from "../components/SearchHistoryDropdown";
import { BingeLoading } from "../components/BingeLoading";

interface AllPerformersModalProps {
    onClose: () => void;
}

type LoadState =
    | { kind: "loading" }
    | { kind: "ready"; performers: PerformerSummary[] }
    | { kind: "error"; message: string };

// Full-screen overlay listing every performer in the library. Reachable
// from Explore via the "See all" link on the Discover performers section.
// Click a performer → set filter + switch to For You + close modal.
// Esc or backdrop click closes without picking.
export function AllPerformersModal({ onClose }: AllPerformersModalProps) {
    const { t } = useTranslation();
    const [state, setState] = useState<LoadState>({ kind: "loading" });
    const [query, setQuery] = useState("");
    const [searchFocused, setSearchFocused] = useState(false);
    // 输入法合成标记：合成中不保存搜索词，避免预输入误存
    const composingRef = useRef(false);
    const { openProfile } = usePerformerProfile();
    const { history: performerSearchHistory, addEntry: addPerformerSearchEntry, removeEntry: removePerformerSearchEntry, scheduleSave: schedulePerformerSave } =
        useSearchHistory("performers");
    const panelRef = useRef<HTMLDivElement>(null);

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

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // Profile opens on top of the modal; closing the profile reveals the
    // modal still open. The user can keep browsing performers, or hit close
    // to return to Explore.
    const handlePick = (p: PerformerSummary) => {
        openProfile(p.id);
    };

    const filtered =
        state.kind === "ready"
            ? query.trim()
                ? state.performers.filter((p) =>
                      p.name
                          .toLowerCase()
                          .includes(query.trim().toLowerCase())
                  )
                : state.performers
            : [];

    return (
        <div className="binge-modal-overlay" onClick={onClose}>
            <div
                className="binge-modal"
                ref={panelRef}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={t("nav.all_performers", "所有演员")}
            >
                <header className="binge-modal-header">
                    <h2>{t("nav.all_performers", "所有演员")}</h2>
                    <button
                        type="button"
                        className="binge-modal-close"
                        onClick={onClose}
                        aria-label={t("action.close", "关闭")}
                    >
                        ×
                    </button>
                </header>
                <div className="binge-modal-toolbar">
                    <div className="binge-search-wrap">
                        <input
                            type="text"
                            className="binge-modal-search"
                            placeholder={t("nav.search_performers", "搜索演员…")}
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
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
                                addPerformerSearchEntry(query);
                                setSearchFocused(false);
                            }}
                            autoFocus
                        />
                        {searchFocused && (
                            <SearchHistoryDropdown
                                history={performerSearchHistory}
                                query={query}
                                onPick={(term) => {
                                    setQuery(term);
                                    setSearchFocused(false);
                                }}
                                onRemove={removePerformerSearchEntry}
                            />
                        )}
                    </div>
                    {state.kind === "ready" && (
                        <span className="binge-modal-count">
                            {t("status.performer_count", "{{count}} 位演员", { count: filtered.length })}
                        </span>
                    )}
                </div>
                <div className="binge-modal-body">
                    {state.kind === "loading" && (
                        <BingeLoading minHeight="20vh" />
                    )}
                    {state.kind === "error" && (
                        <div className="binge-status binge-status-error">
                            {t("status.error_message", "错误：{{message}}", { message: state.message })}
                        </div>
                    )}
                    {state.kind === "ready" && filtered.length === 0 && (
                        <div className="binge-status">{t("status.no_match", "无匹配项")}</div>
                    )}
                    {state.kind === "ready" && filtered.length > 0 && (
                        <ul className="binge-following-grid">
                            {filtered.map((p) => (
                                <li key={p.id}>
                                    <button
                                        type="button"
                                        className={
                                            "binge-follow-card" +
                                            (p.favorite ? " is-favorite" : "")
                                        }
                                        onClick={() => handlePick(p)}
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
                                                    {p.name
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </span>
                                            )}
                                        </span>
                                        <span className="binge-follow-name">
                                            {p.name}
                                        </span>
                                        {typeof p.scene_count === "number" &&
                                            p.scene_count > 0 && (
                                                <span className="binge-follow-count">
                                                    {t("status.performer_scenes", "{{count}} 个场景", { count: p.scene_count })}
                                                </span>
                                            )}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}

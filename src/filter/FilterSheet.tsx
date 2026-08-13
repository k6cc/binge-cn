import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useFilter } from "./FilterContext";
import {
    findSavedFiltersForScenes,
    type StashSavedFilter,
} from "../api/queries";
import { useTranslation } from "react-i18next";

interface FilterSheetProps {
    onClose: () => void;
}

// "Filter" bottom sheet for the For You reel. Lists Stash's native
// saved filters (mode: SCENES) and lets the user apply one with a tap.
// Each saved filter's object_filter and sort/direction get passed
// directly to findScenes, so even criteria binge doesn't model in its
// chip UI (rating100, play_count, duration, path, etc.) work properly.
//
// Active chips section above shows the current filter state with
// per-chip removal + Clear all.
//
// Saving NEW saved filters from binge isn't supported here — Stash's
// `saveFilter` mutation requires serialising ui_options + criterion
// metadata that binge doesn't track. Users create + manage saved
// filters in Stash's main scene browser; binge applies them.
export function FilterSheet({ onClose }: FilterSheetProps) {
    const {
        filter,
        remove,
        clear,
        isEmpty,
        activeSavedFilter,
        applySavedFilter,
        clearSavedFilter,
    } = useFilter();
    const [state, setState] = useState<
        | { kind: "loading" }
        | { kind: "ready"; filters: StashSavedFilter[] }
        | { kind: "error"; message: string }
    >({ kind: "loading" });
    const { t } = useTranslation();

    useEffect(() => {
        let alive = true;
        findSavedFiltersForScenes()
            .then((filters) => {
                if (alive) setState({ kind: "ready", filters });
            })
            .catch((err) => {
                if (alive)
                    setState({
                        kind: "error",
                        message:
                            err instanceof Error ? err.message : String(err),
                    });
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

    return createPortal(
        <div className="binge-sheet-root">
            <div className="binge-sheet-backdrop" onClick={onClose} />
            <div
                className="binge-sheet binge-filter-sheet"
                role="dialog"
                aria-label={t("filter.filter_criteria")}
            >
                <div className="binge-sheet-handle" aria-hidden="true" />
                <div className="binge-filter-sheet-header">
                    <h2 className="binge-filter-sheet-title">{t("filter.filter_criteria")}</h2>
                </div>

                {/* Active state */}
                <section className="binge-filter-sheet-section">
                    <header className="binge-filter-sheet-section-head">
                        <h3>{t("filter.current_active")}</h3>
                        {(!isEmpty || activeSavedFilter) && (
                            <button
                                type="button"
                                className="binge-filter-sheet-clear"
                                onClick={() => clear()}
                            >
                                {t("action.clear_all")}
                            </button>
                        )}
                    </header>
                    {activeSavedFilter ? (
                        <div className="binge-filter-sheet-chips">
                            <button
                                type="button"
                                className="binge-filter-sheet-chip binge-filter-sheet-chip-saved"
                                onClick={() => clearSavedFilter()}
                                title={t("action.clear_saved_filter", { name: activeSavedFilter.name })}
                            >
                                <span>{activeSavedFilter.name}</span>
                                <span
                                    className="binge-filter-sheet-chip-x"
                                    aria-hidden="true"
                                >
                                    ×
                                </span>
                            </button>
                        </div>
                    ) : isEmpty ? (
                        <div className="binge-filter-sheet-empty">
                            {t("filter.no_active_filters")}
                        </div>
                    ) : (
                        <div className="binge-filter-sheet-chips">
                            {filter.performers.map((p) => (
                                <FilterChip
                                    key={`p:${p.id}`}
                                    label={p.name}
                                    tone="performers"
                                    onRemove={() => remove("performers", p.id)}
                                />
                            ))}
                            {filter.tags.map((t) => (
                                <FilterChip
                                    key={`t:${t.id}`}
                                    label={t.name}
                                    tone="tags"
                                    onRemove={() => remove("tags", t.id)}
                                />
                            ))}
                            {filter.studios.map((s) => (
                                <FilterChip
                                    key={`s:${s.id}`}
                                    label={s.name}
                                    tone="studios"
                                    onRemove={() => remove("studios", s.id)}
                                />
                            ))}
                        </div>
                    )}
                </section>

                {/* Stash saved filters */}
                <section className="binge-filter-sheet-section">
                    <header className="binge-filter-sheet-section-head">
                        <h3>{t("filter.stash_saved_filters")}</h3>
                    </header>
                    {state.kind === "loading" && (
                        <div className="binge-filter-sheet-empty">Loading…</div>
                    )}
                    {state.kind === "error" && (
                        <div className="binge-filter-sheet-empty">
                            {t("status.load_failed", { message: state.message })}
                        </div>
                    )}
                    {state.kind === "ready" && state.filters.length === 0 && (
                        <div className="binge-filter-sheet-empty">
                            {t("filter.no_saved_filters")}
                        </div>
                    )}
                    {state.kind === "ready" && state.filters.length > 0 && (
                        <ul className="binge-filter-sheet-presets">
                            {state.filters.map((sf) => (
                                <SavedFilterRow
                                    key={sf.id}
                                    sf={sf}
                                    active={activeSavedFilter?.id === sf.id}
                                    onApply={() => {
                                        applySavedFilter(sf);
                                        onClose();
                                    }}
                                />
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </div>,
        document.body
    );
}

function FilterChip({
    label,
    tone,
    onRemove,
}: {
    label: string;
    tone: "performers" | "tags" | "studios";
    onRemove: () => void;
}) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className={
                "binge-filter-sheet-chip binge-filter-sheet-chip-" + tone
            }
            onClick={onRemove}
            title={t("action.remove_item", { item: label })}
        >
            <span>{label}</span>
            <span className="binge-filter-sheet-chip-x" aria-hidden="true">
                ×
            </span>
        </button>
    );
}

function SavedFilterRow({
    sf,
    active,
    onApply,
}: {
    sf: StashSavedFilter;
    active: boolean;
    onApply: () => void;
}) {
    const { t } = useTranslation();
    // Summarise the saved filter's criteria for the row's secondary line.
    const criteria = Object.keys(sf.object_filter ?? {});
    const summary =
        criteria.length === 0
            ? t("filter.no_filters")
            : criteria.slice(0, 4).join(" · ") +
              (criteria.length > 4 ? ` · +${criteria.length - 4}` : "");
    const sort = sf.find_filter?.sort ?? "";
    return (
        <li
            className={
                "binge-filter-sheet-preset-row" + (active ? " is-active" : "")
            }
        >
            <button
                type="button"
                className="binge-filter-sheet-preset-apply"
                onClick={onApply}
            >
                <span className="binge-filter-sheet-preset-name">
                    {sf.name}
                </span>
                <span className="binge-filter-sheet-preset-meta">
                    {summary}
                    {sort && t("filter.sort_by", { sort })}
                </span>
            </button>
        </li>
    );
}

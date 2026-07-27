import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFilter } from "./FilterContext";
import {
    loadPresets,
    newPresetId,
    savePresets,
    type FilterPreset,
} from "./presets";

interface PresetsMenuProps {
    onClose: () => void;
}

// Saved-filter manager: lists existing presets (click to load),
// saves the current filter as a new preset, supports rename + delete.
export function PresetsMenu({ onClose }: PresetsMenuProps) {
    const { filter, replace, isEmpty } = useFilter();
    const { t } = useTranslation();
    const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets());
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const panelRef = useRef<HTMLDivElement>(null);

    // Keep storage in sync after every change.
    const persist = (next: FilterPreset[]) => {
        setPresets(next);
        savePresets(next);
    };

    const handleSave = () => {
        if (isEmpty) return;
        const total =
            filter.performers.length + filter.tags.length + filter.studios.length;
        const defaultName =
            filter.performers[0]?.name ||
            filter.tags[0]?.name ||
            filter.studios[0]?.name ||
            t("filter.preset", "预设");
        const suffix = total > 1 ? ` +${total - 1}` : "";
        const name = window.prompt(
            t("filter.name_preset", "为这个预设命名"),
            `${defaultName}${suffix}`
        );
        if (!name) return;
        const preset: FilterPreset = {
            id: newPresetId(),
            name: name.trim() || `${defaultName}${suffix}`,
            filter: structuredClone(filter),
            savedAt: Date.now(),
        };
        persist([preset, ...presets]);
    };

    const handleLoad = (preset: FilterPreset) => {
        replace(preset.filter);
        onClose();
    };

    const handleDelete = (id: string) => {
        if (!window.confirm(t("filter.delete_preset_confirm", "删除这个预设？"))) return;
        persist(presets.filter((p) => p.id !== id));
    };

    const startRename = (preset: FilterPreset) => {
        setRenameId(preset.id);
        setRenameValue(preset.name);
    };

    const commitRename = () => {
        if (!renameId) return;
        const trimmed = renameValue.trim();
        if (!trimmed) {
            setRenameId(null);
            return;
        }
        persist(
            presets.map((p) =>
                p.id === renameId ? { ...p, name: trimmed } : p
            )
        );
        setRenameId(null);
    };

    // Click-outside dismiss
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (!panelRef.current?.contains(e.target as Node)) {
                onClose();
            }
        };
        const t = window.setTimeout(
            () => document.addEventListener("mousedown", handler),
            0
        );
        return () => {
            window.clearTimeout(t);
            document.removeEventListener("mousedown", handler);
        };
    }, [onClose]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (renameId) setRenameId(null);
                else onClose();
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose, renameId]);

    return (
        <div className="binge-chip-menu binge-presets-menu" ref={panelRef} role="dialog">
            <div className="binge-chip-menu-tabs">
                <span className="binge-chip-menu-tab is-active">{t("nav.saved_filters", "已保存的筛选条件")}</span>
                <button
                    type="button"
                    className="binge-chip-menu-tab binge-presets-save"
                    onClick={handleSave}
                    disabled={isEmpty}
                    title={
                        isEmpty
                            ? t("filter.add_tags_before_saving", "请先添加一些筛选标签再保存")
                            : t("filter.save_current_preset", "将当前筛选条件保存为预设")
                    }
                >
                    + {t("filter.save_current", "保存当前")}
                </button>
            </div>

            {presets.length === 0 && (
                <div className="binge-chip-menu-status">
                    {t("filter.no_saved_presets", "还没有已保存的预设")}
                </div>
            )}

            <ul className="binge-chip-menu-results">
                {presets.map((p) => {
                    const total =
                        p.filter.performers.length +
                        p.filter.tags.length +
                        p.filter.studios.length;
                    const isRenaming = renameId === p.id;
                    return (
                        <li key={p.id}>
                            <div className="binge-preset-row">
                                {isRenaming ? (
                                    <input
                                        autoFocus
                                        className="binge-chip-menu-input binge-preset-rename"
                                        value={renameValue}
                                        onChange={(e) =>
                                            setRenameValue(e.target.value)
                                        }
                                        onBlur={commitRename}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") commitRename();
                                        }}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        className="binge-chip-menu-row binge-preset-load"
                                        onClick={() => handleLoad(p)}
                                        title={t("filter.load_preset", "加载此预设")}
                                    >
                                        <span className="binge-chip-menu-name">
                                            {p.name}
                                        </span>
                                        <span className="binge-preset-count">
                                            {total}
                                        </span>
                                    </button>
                                )}
                                {!isRenaming && (
                                    <div className="binge-preset-actions">
                                        <button
                                            type="button"
                                            className="binge-preset-icon-button"
                                            onClick={() => startRename(p)}
                                            title={t("action.rename", "重命名")}
                                            aria-label={t("action.rename_preset", "重命名预设")}
                                        >
                                            ✎
                                        </button>
                                        <button
                                            type="button"
                                            className="binge-preset-icon-button binge-preset-delete"
                                            onClick={() => handleDelete(p.id)}
                                            title={t("action.delete", "删除")}
                                            aria-label={t("action.delete_preset", "删除预设")}
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

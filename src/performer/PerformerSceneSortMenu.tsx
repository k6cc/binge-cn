import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
    PERFORMER_SCENE_SORTS,
    type PerformerSceneSort,
} from "../api/queries";



export function PerformerSceneSortMenu({
    value,
    onChange,
}: {
    value: PerformerSceneSort;
    onChange: (next: PerformerSceneSort) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const SORT_LABELS_LOCAL: Record<PerformerSceneSort, string> = useMemo(() => ({
        recent: t("sort.recent", "最近"),
        views: t("sort.views", "最多播放"),
        orgasms: t("sort.orgasms", "最多高潮"),
        rating: t("sort.rating", "最高评分"),
        added: t("sort.added", "最近添加"),
    }), [t]);

    function sortLabel(key: PerformerSceneSort): string {
        const fallback = SORT_LABELS_LOCAL[key] ?? PERFORMER_SCENE_SORTS.find((s) => s.key === key)?.label ?? key;
        switch (key) {
            case "recent": return t("sort.recent", fallback);
            case "views": return t("sort.views", fallback);
            case "orgasms": return t("sort.orgasms", fallback);
            case "rating": return t("sort.rating", fallback);
            case "added": return t("sort.added", fallback);
            default: return fallback;
        }
    }

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (
                rootRef.current &&
                !rootRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const current =
        PERFORMER_SCENE_SORTS.find((s) => s.key === value) ??
        PERFORMER_SCENE_SORTS[0];

    return (
        <div className="binge-scene-sort" ref={rootRef}>
            <button
                type="button"
                className={
                    "binge-scene-sort-btn" + (open ? " is-open" : "")
                }
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                title={t("action.sort_scenes", "场景排序")}
            >
                {sortLabel(current.key)}
                <ChevronIcon />
            </button>
            {open && (
                <div className="binge-scene-sort-menu" role="menu">
                    {PERFORMER_SCENE_SORTS.map((opt) => {
                        const active = opt.key === value;
                        return (
                            <button
                                key={opt.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                className={
                                    "binge-scene-sort-item" +
                                    (active ? " is-active" : "")
                                }
                                onClick={() => {
                                    onChange(opt.key);
                                    setOpen(false);
                                }}
                            >
                                <span className="binge-scene-sort-check">
                                    {active && <CheckIcon />}
                                </span>
                                {sortLabel(opt.key)}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ChevronIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M5 13l4 4L19 7" />
        </svg>
    );
}

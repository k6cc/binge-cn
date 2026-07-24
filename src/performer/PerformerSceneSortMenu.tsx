import { useEffect, useRef, useState } from "react";
import {
    PERFORMER_SCENE_SORTS,
    type PerformerSceneSort,
} from "../api/queries";

// Sort-key → 中文 label. The shared `PERFORMER_SCENE_SORTS` constant in
// `api/queries.ts` is also consumed by other surfaces (e.g. the API
// layer's stashSort mapping), so we keep the English source strings
// there and override only the display text here.
const SORT_LABELS: Record<PerformerSceneSort, string> = {
    recent: "最近",
    views: "最多播放",
    orgasms: "最多高潮",
    rating: "最高评分",
    added: "最近添加",
};

function sortLabel(key: PerformerSceneSort): string {
    return SORT_LABELS[key] ?? PERFORMER_SCENE_SORTS.find((s) => s.key === key)?.label ?? key;
}

// Subtle sort control for the performer scene grid. Renders as a small
// muted label ("Recent ⌄") that opens a popover of the sort options —
// deliberately understated so it sits quietly in the SCENES heading next
// to the StashDB toggle. Single-select; the active option carries a check.
// Outside-click / Escape close it (same pattern as FeedFilterMenu).
export function PerformerSceneSortMenu({
    value,
    onChange,
}: {
    value: PerformerSceneSort;
    onChange: (next: PerformerSceneSort) => void;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

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
                title="场景排序"
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

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSheetClose } from "../hooks/useSheetClose";
import { useHasScribe } from "../plugins/PluginContext";
import { useScribeModal } from "../scribe/ScribeContext";
import { useTranslation } from "react-i18next";
import {
    describeRepair,
    repairPerformerFromStashDB,
} from "../api/repairPerformer";

interface PerformerMoreSheetProps {
    performerId: string;
    /// The performer's stash_id on the active source, when she has one
    /// (本仓库按活动源端点匹配，上游为硬编码 stashdb.org). Gates the
    /// repair row: without a link there is nothing to repair from.
    stashDBPerformerId?: string | null;
    onRefresh: () => void;
    onClose: () => void;
}

// Overflow menu for the performer profile (the ⋯ in the top-right
// of the header). Two actions today: refresh the cached performer
// data and open the performer's native Stash page. Mirrors the
// SceneSlide MoreSheet pattern; kept separate so the row set can
// evolve independently from the per-scene one.
export function PerformerMoreSheet({
    performerId,
    stashDBPerformerId,
    onRefresh,
    onClose,
}: PerformerMoreSheetProps) {
    const { isExiting, beginClose } = useSheetClose(onClose);
    const { t } = useTranslation();

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") beginClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [beginClose]);

    const hasScribe = useHasScribe();
    const scribeModal = useScribeModal();

    const handleRefresh = () => {
        onRefresh();
        beginClose();
    };
    const handleWriteReview = () => {
        scribeModal.openPerformer(performerId);
        beginClose();
    };
    // The sheet stays open and reports what happened, rather than
    // closing onto a profile that has silently changed. There is no
    // toast in this plugin, and inventing one for a row nobody presses
    // twice would be the wrong place to start.
    const [repairing, setRepairing] = useState(false);
    const [repairMessage, setRepairMessage] = useState<string | null>(null);
    const handleRepair = async () => {
        if (repairing || !stashDBPerformerId) return;
        setRepairing(true);
        setRepairMessage(null);
        try {
            const result = await repairPerformerFromStashDB({
                localPerformerId: performerId,
                stashDBPerformerId,
            });
            setRepairMessage(describeRepair(result));
            if (result.linked > 0 || result.filled.length > 0) onRefresh();
        } catch (err) {
            console.warn("[binge] repair failed", err);
            setRepairMessage(t("performer.repair.failed"));
        } finally {
            setRepairing(false);
        }
    };

    const handleOpenInStash = () => {
        window.open(
            `/performers/${performerId}`,
            "_blank",
            "noopener,noreferrer",
        );
        beginClose();
    };

    return createPortal(
        <div
            className={
                "binge-sheet-root binge-sheet-root-top" +
                (isExiting ? " is-exiting" : "")
            }
        >
            <div className="binge-sheet-backdrop" onClick={beginClose} />
            <div
                className="binge-sheet binge-more-sheet"
                role="dialog"
                aria-label={t("action.more_actions")}
            >
                <div className="binge-sheet-handle" aria-hidden="true" />
                <ul className="binge-more-sheet-list">
                    {hasScribe && (
                        <li>
                            <button
                                type="button"
                                className="binge-more-sheet-row"
                                onClick={handleWriteReview}
                            >
                                <span className="binge-more-sheet-row-label">
                                    {t("action.write_review")}
                                </span>
                                <CommentIcon />
                            </button>
                        </li>
                    )}
                    <li>
                        <button
                            type="button"
                            className="binge-more-sheet-row"
                            onClick={handleRefresh}
                        >
                            <span className="binge-more-sheet-row-label">
                                {t("action.refresh")}
                            </span>
                            <RefreshIcon />
                        </button>
                    </li>
                    {stashDBPerformerId && (
                        <li>
                            <button
                                type="button"
                                className="binge-more-sheet-row"
                                onClick={() => void handleRepair()}
                                disabled={repairing}
                            >
                                <span className="binge-more-sheet-row-label">
                                    {repairing
                                        ? t("performer.repair.working")
                                        : t("performer.repair.action")}
                                </span>
                                <BandageIcon />
                            </button>
                        </li>
                    )}
                    {repairMessage && (
                        <li>
                            <p className="binge-more-sheet-note">
                                {repairMessage}
                            </p>
                        </li>
                    )}
                    <li>
                        <button
                            type="button"
                            className="binge-more-sheet-row"
                            onClick={handleOpenInStash}
                        >
                            <span className="binge-more-sheet-row-label">
                                {t("action.open_in_stash")}
                            </span>
                            <ExternalLinkIcon />
                        </button>
                    </li>
                </ul>
            </div>
        </div>,
        document.body,
    );
}

function CommentIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M 20.656 17.008 a 9.993 9.993 0 1 0 -3.59 3.615 L 22 22 Z" />
        </svg>
    );
}

function RefreshIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 12C21 16.97 16.97 21 12 21C9.69 21 7.59 20.13 6 18.71L3 16M3 12C3 7.03 7.03 3 12 3C14.31 3 16.41 3.87 18 5.29L21 8M3 21V16M3 16H8M21 3V8M21 8H16" />
        </svg>
    );
}

function BandageIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="1.5" y="7.5" width="21" height="9" rx="4.5" />
            <line x1="8" y1="7.5" x2="8" y2="16.5" />
            <line x1="16" y1="7.5" x2="16" y2="16.5" />
        </svg>
    );
}

function ExternalLinkIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
    );
}

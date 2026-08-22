import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
    pornhubStreamUrl,
    saveToStash,
    getSaveProgress,
    type PornhubVideo,
} from "../api/bingeServer";
import {
    PLAYBACK_LAYER,
    closePlaybackLayer,
    openPlaybackLayer,
} from "../util/playbackStack";

// Fullscreen inline player for a PornHub video — plays the stream proxy
// (extracted + relayed mp4, no download) and offers a one-tap "Save to
// Stash" (which downloads the full video server-side via yt-dlp).
export function PornhubPlayer({
    video,
    performerId,
    onClose,
}: {
    video: PornhubVideo;
    performerId: string;
    onClose: () => void;
}) {
    const [saveState, setSaveState] = useState<
        "idle" | "saving" | "saved" | "error"
    >("idle");
    // Live download percent (0-100) while saving, null when the daemon
    // hasn't reported anything yet (old daemon without /save/progress,
    // or the download hasn't produced its first progress line).
    const [savePercent, setSavePercent] = useState<number | null>(null);
    const pollRef = useRef<number | null>(null);
    const { t } = useTranslation();

    // Stop polling if the player unmounts mid-download.
    useEffect(() => {
        return () => {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
        };
    }, []);

    // 播放层栈：PH 播放器（z:120）打开期间登记最高层——演员详情页内
    // 的悬停预览等下层视频全部暂停，杜绝两层同时出声。
    useEffect(() => {
        openPlaybackLayer(PLAYBACK_LAYER.phPlayer);
        return () => closePlaybackLayer(PLAYBACK_LAYER.phPlayer);
    }, []);

    const handleSave = async () => {
        if (saveState === "saving" || saveState === "saved") return;
        setSaveState("saving");
        setSavePercent(null);
        // Poll the daemon's live progress while the yt-dlp download
        // runs (a large video can take minutes; the POST only resolves
        // at the end).
        pollRef.current = window.setInterval(async () => {
            const p = await getSaveProgress("pornhub", video.id);
            if (p && p.state === "downloading" && p.percent > 0) {
                setSavePercent(Math.min(99, p.percent));
            }
        }, 800);
        try {
            const res = await saveToStash(
                {
                    performerStashId: performerId,
                    source: "pornhub",
                    id: video.id,
                    // yt-dlp downloads from the watch page.
                    mediaUrl: video.sourceUrl,
                    kind: "video",
                    sourceUrl: video.sourceUrl,
                    text: video.title ?? undefined,
                    createdUtc: video.createdUtc || undefined,
                },
                // Match the daemon's 4-minute request budget — the
                // default 30s would cut off any but the smallest
                // videos mid-download.
                240_000,
            );
            setSaveState(res.ok ? "saved" : "error");
        } finally {
            if (pollRef.current !== null) {
                window.clearInterval(pollRef.current);
                pollRef.current = null;
            }
            setSavePercent(null);
        }
    };

    return createPortal(
        <div
            className="binge-ph-player-root"
            role="dialog"
            aria-label={t("status.pornhub_video")}
            onClick={onClose}
        >
            <div
                className="binge-ph-player-stage"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="binge-ph-player-bar">
                    <span className="binge-ph-player-title">
                        {video.title || "PornHub"}
                    </span>
                    <button
                        type="button"
                        className={
                            "binge-ph-player-save" +
                            (saveState === "saved" ? " is-saved" : "") +
                            (saveState === "error" ? " is-error" : "")
                        }
                        onClick={() => void handleSave()}
                        disabled={
                            saveState === "saving" || saveState === "saved"
                        }
                        title={
                            saveState === "error"
                                ? t("action.save_failed_retry")
                                : t("action.download_to_stash")
                        }
                    >
                        <span className="binge-ph-player-save-label">
                            {saveState === "saved"
                                ? t("status.saved_with_check")
                                : saveState === "saving"
                                  ? savePercent !== null
                                      ? `${Math.floor(savePercent)}%`
                                      : t("action.saving")
                                  : saveState === "error"
                                    ? t("action.retry")
                                    : t("action.save_to_stash")}
                        </span>
                        {saveState === "saving" && savePercent !== null && (
                            <span
                                className="binge-ph-player-save-bar"
                                style={{ width: `${savePercent}%` }}
                            />
                        )}
                    </button>
                    <button
                        type="button"
                        className="binge-ph-player-close"
                        onClick={onClose}
                        aria-label={t("action.close")}
                    >
                        ✕
                    </button>
                </div>
                <video
                    className="binge-ph-player-video"
                    src={pornhubStreamUrl(video.id)}
                    controls
                    autoPlay
                    playsInline
                />
            </div>
        </div>,
        document.body,
    );
}

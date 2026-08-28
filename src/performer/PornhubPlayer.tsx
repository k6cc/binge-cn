import { useState } from "react";
import { createPortal } from "react-dom";
import { isPornhubHost, safeExternalUrl } from "../util/externalUrl";
import {
    pornhubStreamUrl,
    saveToStash,
    type PornhubVideo,
} from "../api/bingeServer";

// Fullscreen inline player for a PornHub video — plays the stream proxy
// (extracted + relayed mp4, no download) and offers a one-tap "Save to
// Stash" (which downloads the full video server-side via yt-dlp).
// The daemon only knows how to fetch PornHub watch pages from this
// route, so anything else is a scrape that went wrong rather than
// something to hand a downloader.
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

    const handleSave = async () => {
        if (saveState === "saving" || saveState === "saved") return;
        // The daemon runs yt-dlp on whatever URL this sends, and the URL
        // came from a scrape - so it is checked here rather than trusted
        // for being in a typed field. Same guard the story viewer's
        // external links use.
        const watchPage = safeExternalUrl(video.sourceUrl);
        if (!watchPage || !isPornhubHost(watchPage)) {
            setSaveState("error");
            return;
        }
        setSaveState("saving");
        // try/finally, because saveToStash reads the daemon URL from
        // localStorage OUTSIDE its own try - so a storage failure
        // rejects rather than returning, and with no handler here the
        // button stayed on "Saving…" and disabled for good, with
        // nothing said.
        try {
            const res = await saveToStash({
                performerStashId: performerId,
                source: "pornhub",
                id: video.id,
                // yt-dlp downloads from the watch page.
                mediaUrl: watchPage,
                kind: "video",
                sourceUrl: watchPage,
                text: video.title ?? undefined,
                createdUtc: video.createdUtc || undefined,
            });
            setSaveState(res.ok ? "saved" : "error");
        } catch {
            setSaveState("error");
        }
    };

    return createPortal(
        <div
            className="binge-ph-player-root"
            role="dialog"
            aria-label="PornHub video"
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
                                ? "Save failed — tap to retry"
                                : "Download into Stash"
                        }
                    >
                        {saveState === "saved"
                            ? "✓ Saved"
                            : saveState === "saving"
                              ? "Saving…"
                              : saveState === "error"
                                ? "Retry"
                                : "Save to Stash"}
                    </button>
                    <button
                        type="button"
                        className="binge-ph-player-close"
                        onClick={onClose}
                        aria-label="Close"
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

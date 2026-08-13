import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
    fetchSceneFileDetails,
    type BingeScene,
    type SceneFileDetails,
} from "../api/queries";
import { formatDate, formatDuration } from "../utils/date";
import { basenameNoExt, toHashtag } from "../utils/file"; // New import

interface SceneDetailsSheetProps {
    scene: BingeScene;
    onClose: () => void;
}

// Instagram caption/details modal — slides up from the bottom. Header
// shows studio + date; body shows the full title + description; footer
// is a wrap of tag chips rendered as Instagram-style hashtags.
//
// Portalled to <body> for the same stacking-context reason as
// PerformerSheet — the slide's `.binge-overlay` would otherwise cap
// our z-index beneath the action stack.
export function SceneDetailsSheet({ scene, onClose }: SceneDetailsSheetProps) {
    const { t, i18n } = useTranslation();
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // Lazy-load tech details only when the sheet is open. The
    // BingeScene selection that powers the reel intentionally
    // omits these fields (they're useless until the user opens
    // the sheet); fetching here keeps the reel's per-slide
    // payload small.
    const [tech, setTech] = useState<SceneFileDetails | null>(null);
    useEffect(() => {
        let alive = true;
        fetchSceneFileDetails(scene.id)
            .then((details) => {
                if (alive) setTech(details);
            })
            .catch(() => {
                /* silent — section just doesn't render */
            });
        return () => {
            alive = false;
        };
    }, [scene.id]);

    const title = scene.title?.trim() || "";
    // Fallback when no scraped title: derive from the first file's path,
    // strip directory + extension. Lets every scene have something
    // clickable that opens it in Stash.
    const filenameTitle = !title ? basenameNoExt(scene.files?.[0]?.path) : "";
    const displayTitle = title || filenameTitle;
    const details = scene.details?.trim() || "";
    const studioName = scene.studio?.name;
    const dateLabel = formatDate(scene.date, i18n);

    return createPortal(
        <div className="binge-sheet-root">
            <div className="binge-sheet-backdrop" onClick={onClose} />
            <div
                className="binge-sheet binge-details-sheet"
                role="dialog"
                aria-label={t("nav.scene_details")}
            >
                <div className="binge-sheet-handle" aria-hidden="true" />
                <div className="binge-details-body-scroll">
                    <div className="binge-details-meta">
                        {studioName && (
                            <span className="binge-details-studio">
                                {studioName}
                            </span>
                        )}
                        {studioName && dateLabel && (
                            <span className="binge-details-dot">·</span>
                        )}
                        {dateLabel && (
                            <span className="binge-details-date">{dateLabel}</span>
                        )}
                    </div>
                    {displayTitle && (
                        <h2
                            className={
                                "binge-details-title" +
                                (filenameTitle ? " is-filename" : "")
                            }
                        >
                            <a
                                href={`/scenes/${scene.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="binge-details-title-link"
                                title={t("action.open_in_stash")}
                            >
                                {displayTitle}
                            </a>
                        </h2>
                    )}
                    {details && (
                        <p className="binge-details-body">{details}</p>
                    )}
                    {scene.tags && scene.tags.length > 0 && (
                        <ul className="binge-hashtag-list">
                            {scene.tags.map((t) => (
                                <li key={t.id}>
                                    <span className="binge-hashtag">
                                        #{toHashtag(t.name)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {tech && <TechSection tech={tech} />}
                    {!displayTitle &&
                        !details &&
                        (!scene.tags || scene.tags.length === 0) && (
                            <p className="binge-details-empty">
                                {t("status.no_description")}
                            </p>
                        )}
                </div>
            </div>
        </div>,
        document.body
    );
}

// Drag the sheet up to .large on iOS, scroll further on web —
// either way this section is below the fold for a quick glance.
// Mirrors the iOS SceneDetailsSheet's tech block: path, resolution,
// duration, size, codecs, frame rate, bit rate.
function TechSection({ tech }: { tech: SceneFileDetails }) {
    const { t } = useTranslation();
    const rows: { label: string; value: string; mono?: boolean }[] = [];
    if (tech.path) {
        rows.push({ label: t("scene.path"), value: tech.path, mono: true });
    }
    // Inlined helper functions for TechSection
    const formatResolution = (t: SceneFileDetails): string | null => {
        if (!t.width || !t.height) return null;
        return `${t.width} × ${t.height}`;
    };
    const formatSize = (bytes: number | null): string | null => {
        if (!bytes || bytes <= 0) return null;
        if (bytes >= 1024 ** 3) {
            return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
        }
        if (bytes >= 1024 ** 2) {
            return `${Math.round(bytes / 1024 ** 2)} MB`;
        }
        return `${Math.round(bytes / 1024)} KB`;
    };
    const formatFrameRate = (fps: number | null): string | null => {
        if (!fps || fps <= 0) return null;
        if (Math.abs(fps - Math.round(fps)) < 0.01) {
            return `${Math.round(fps)} fps`;
        }
        return `${fps.toFixed(2)} fps`;
    };
    const formatBitRate = (bps: number | null): string | null => {
        if (!bps || bps <= 0) return null;
        const mbps = bps / 1_000_000;
        if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
        return `${Math.round(bps / 1000)} kbps`;
    };

    const res = formatResolution(tech);
    if (res) rows.push({ label: t("scene.resolution"), value: res });
    const dur = formatDuration(tech.duration);
    if (dur) rows.push({ label: t("scene.duration"), value: dur });
    const size = formatSize(tech.size);
    if (size) rows.push({ label: t("scene.size"), value: size });
    if (tech.video_codec) rows.push({ label: t("scene.video"), value: tech.video_codec });
    if (tech.audio_codec) rows.push({ label: t("scene.audio"), value: tech.audio_codec });
    const fr = formatFrameRate(tech.frame_rate);
    if (fr) rows.push({ label: t("scene.frame_rate"), value: fr });
    const br = formatBitRate(tech.bit_rate);
    if (br) rows.push({ label: t("scene.bit_rate"), value: br });
    if (rows.length === 0) return null;
    return (
        <div className="binge-details-tech">
            <div className="binge-details-tech-heading">{t("scene.technical_info")}</div>
            <dl className="binge-details-tech-list">
                {rows.map((row) => (
                    <div key={row.label} className="binge-details-tech-row">
                        <dt className="binge-details-tech-label">
                            {row.label}
                        </dt>
                        <dd
                            className={
                                "binge-details-tech-value" +
                                (row.mono ? " is-mono" : "")
                            }
                        >
                            {row.value}
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PackFeedItem, SceneFeedItem } from "./useFeed";
import { useTab } from "../tabs/TabContext";
import { openPackAtScene } from "./packHandoff";

// Fullscreen sheet shown when the user taps a Pack feed card.
// Lists every scene in the pack as a 3-column grid; tapping a
// tile drops into the For You reel pre-pinned to that scene with
// the pack's scene set queued behind it.
//
// Portalled to <body> for the same z-index reasons SaveSheet and
// PerformerSheet use — the parent feed has its own stacking
// context that would otherwise cap the sheet beneath the action
// stack.
export function PackDetailSheet({
    pack,
    onClose,
}: {
    pack: PackFeedItem;
    onClose: () => void;
}) {
    const { setTab, setPinFirstSceneId, setPinnedQueue } = useTab();

    // Esc dismisses on desktop — matches the rest of the sheets.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // Paged, because every tile carries a background-image and the
    // browser fetches all of them as soon as they are laid out. The
    // card's own mosaic caps itself at nine for this reason; the sheet
    // rendered the whole pack, so opening a 944-scene pack issued 944
    // screenshot requests at once - which also starves the scene
    // fetches the tap is about to make.
    const PAGE = 60;
    const [shownCount, setShownCount] = useState(PAGE);
    const shown = pack.scenes.slice(0, shownCount);

    const handlePick = (scene: SceneFeedItem) => {
        openPackAtScene(
            { setTab, setPinFirstSceneId, setPinnedQueue },
            pack,
            scene.sceneId,
        );
        onClose();
    };

    return createPortal(
        <div className="binge-sheet-root">
            <div className="binge-sheet-backdrop" onClick={onClose} />
            <div
                className="binge-sheet binge-pack-sheet"
                role="dialog"
                aria-label={`${pack.label} — pack`}
            >
                <div className="binge-sheet-handle" aria-hidden="true" />
                <header className="binge-pack-sheet-header">
                    <div className="binge-pack-sheet-title">{pack.label}</div>
                    <div className="binge-pack-sheet-sub">
                        {pack.sceneCount} new scenes
                    </div>
                </header>
                <div className="binge-pack-sheet-grid">
                    {shown.map((scene) => (
                        <button
                            type="button"
                            key={scene.sceneId}
                            className="binge-pack-sheet-tile"
                            onClick={() => handlePick(scene)}
                            aria-label={scene.title ?? "Open scene"}
                            style={
                                scene.screenshot
                                    ? {
                                          backgroundImage: `url(${scene.screenshot})`,
                                      }
                                    : undefined
                            }
                        />
                    ))}
                </div>
                {shown.length < pack.scenes.length && (
                    <button
                        type="button"
                        className="binge-pack-sheet-more"
                        onClick={() => setShownCount((n) => n + PAGE)}
                    >
                        Show more ({pack.scenes.length - shown.length} left)
                    </button>
                )}
            </div>
        </div>,
        document.body,
    );
}

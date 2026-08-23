import { useEffect, useRef, useState } from "react";
import {
    createCollection,
    deleteCollection,
    FAVOURITES_TAG_NAME,
    getCollections,
    subscribeCollections,
    type CollectionDef,
} from "../api/collections";
import {
    findRecentScenesForTag,
    findScenesByTag,
    type CollectionCover,
} from "../api/queries";
import { useFilter } from "../filter/FilterContext";
import { useTab } from "./TabContext";
import { useAutoHideTabBar } from "../hooks/useAutoHideTabBar";
import { SceneCardGrid } from "../components/SceneCardGrid";

// IG-style "Saved" page. Grid of collection tiles with cover
// thumbnails (latest scene tagged with the collection). Per-tile
// long-press → delete confirmation. "+" in the header opens an
// inline create-input. Tap a tile → drops into the For You reel
// filtered to that tag.
//
// Mounted via the hidden `saved` tab — Home's header has a small
// bookmark button that calls setTab("saved"). The Saved tab is NOT
// shown in the TabBar; Home is the only entry point.
//
// 700ms hold → delete confirmation (matches the multiview-button
// long-press threshold).
// How far a press may travel and still count as a hold. Roughly the
// browser's own scroll slop, so an intentional hold survives a shaky
// thumb and a scroll does not reach the delete dialog.
const HOLD_SLOP_PX = 10;
const LONG_PRESS_MS = 700;

interface CollectionWithCover {
    def: CollectionDef;
    cover: CollectionCover | null; // null while loading
}

export function SavedPage() {
    const { setTab, setPinFirstSceneId } = useTab();
    const { replace } = useFilter();
    const scrollRef = useRef<HTMLDivElement>(null);
    useAutoHideTabBar(scrollRef);

    const [items, setItems] = useState<CollectionWithCover[]>([]);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [submitBusy, setSubmitBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // tag-name of the row currently showing the delete confirm sheet
    const [confirmDelete, setConfirmDelete] = useState<CollectionDef | null>(
        null,
    );
    // When set, the page shows the collection's scene grid instead of
    // the tile overview. Cleared by the in-detail Back button.
    const [openCollection, setOpenCollection] = useState<CollectionDef | null>(
        null,
    );

    // Tag id per collection, learned as each cover query resolves. State
    // rather than a ref because the detail view reads it while rendering:
    // a ref written after the covers land wouldn't re-render the page, so
    // the grid could sit there with an empty tag id.
    const [tagIds, setTagIds] = useState<ReadonlyMap<string, string>>(
        new Map(),
    );
    function tagIdFromCachedCovers(tagName: string): string {
        return tagIds.get(tagName) ?? "";
    }

    async function resolveCover(
        tagName: string,
    ): Promise<CollectionCover | null> {
        // The collections module owns the tag-id map. Defer to it.
        const { getCollectionTagIds } = await import("../api/collections");
        // false: rendering the Saved page is a read. This was missed
        // when the reel and the feed card were converted, so opening
        // the tab still created the default tags.
        const map = await getCollectionTagIds(false);
        const id = map.get(tagName);
        if (!id) return null;
        setTagIds((prev) => new Map(prev).set(tagName, id));
        return await findRecentScenesForTag(id, 4);
    }

    // Load collections + each cover. Subscribes so create/delete
    // mutations trigger a re-render with the fresh list.
    useEffect(() => {
        let alive = true;
        const reload = async () => {
            try {
                const collections = await getCollections();
                if (!alive) return;
                // Show structure immediately; covers populate as their
                // queries resolve.
                setItems(collections.map((def) => ({ def, cover: null })));
                const covers = await Promise.all(
                    collections.map((c) =>
                        // Use the cached tag-id map indirectly via the
                        // collection module's own lookup so we don't
                        // refetch tag ids per call.
                        resolveCover(c.tagName),
                    ),
                );
                if (!alive) return;
                setItems(
                    collections.map((def, i) => ({
                        def,
                        cover: covers[i],
                    })),
                );
            } catch (e) {
                if (alive) setError(e instanceof Error ? e.message : String(e));
            }
        };
        void reload();
        const off = subscribeCollections(() => void reload());
        return () => {
            alive = false;
            off();
        };
    }, []);

    const handleOpenCollection = (c: CollectionDef) => {
        // Tile tap → enter the collection's grid view (NOT the reel).
        // The reel entry is now driven from inside that view, when the
        // user taps an individual scene tile.
        setOpenCollection(c);
    };

    // Picked from inside the collection detail. Replaces the filter
    // with this collection's tag + pins the picked scene, then drops
    // into the reel.
    const handlePickSceneInCollection = (c: CollectionDef, sceneId: string) => {
        replace({
            performers: [],
            tags: [{ id: tagIdFromCachedCovers(c.tagName), name: c.name }],
            studios: [],
        });
        setPinFirstSceneId(sceneId);
        setTab("foryou");
    };

    const handleCreate = async () => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        setSubmitBusy(true);
        setError(null);
        try {
            await createCollection(trimmed);
            setNewName("");
            setCreating(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitBusy(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!confirmDelete) return;
        try {
            await deleteCollection(confirmDelete);
            setConfirmDelete(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setConfirmDelete(null);
        }
    };

    // Detail view: scene grid for a single collection. Renders inside
    // the same Saved pane (not a new tab) so back-stack behaves
    // naturally.
    if (openCollection) {
        // The id the collection was listed with, falling back to
        // whatever the covers pass resolved. A DEFAULT collection that
        // has never been used has no tag yet, so this is legitimately
        // empty - and rendering a spinner for it meant tapping
        // "Watch Later" on a fresh install span forever with no
        // timeout, no retry and no exit but the back chevron.
        const tagId =
            openCollection.id || tagIdFromCachedCovers(openCollection.tagName);
        return (
            <div className="binge-tab-scroll" ref={scrollRef}>
                <header className="binge-saved-header">
                    <button
                        type="button"
                        className="binge-saved-back"
                        onClick={() => setOpenCollection(null)}
                        aria-label="Back to Saved"
                        title="Back"
                    >
                        <ChevronLeft />
                    </button>
                    <h1 className="binge-saved-title">{openCollection.name}</h1>
                    <span className="binge-saved-spacer" />
                </header>
                {!tagId ? (
                    <p className="binge-saved-empty">
                        No scenes saved to this collection yet.
                    </p>
                ) : (
                    <SceneCardGrid
                        resetKey={openCollection.tagName}
                        fetcher={(page, perPage) =>
                            findScenesByTag(tagId, page, perPage)
                        }
                        onPick={(scene) =>
                            handlePickSceneInCollection(
                                openCollection,
                                scene.id,
                            )
                        }
                        emptyMessage="No scenes saved to this collection yet."
                    />
                )}
            </div>
        );
    }

    return (
        <div className="binge-tab-scroll" ref={scrollRef}>
            <header className="binge-saved-header">
                <button
                    type="button"
                    className="binge-saved-back"
                    onClick={() => setTab("home")}
                    aria-label="Back to Home"
                    title="Back"
                >
                    <ChevronLeft />
                </button>
                <h1 className="binge-saved-title">Saved</h1>
                <button
                    type="button"
                    className="binge-saved-add"
                    onClick={() => setCreating((v) => !v)}
                    aria-label="New collection"
                    title="New collection"
                >
                    <PlusIcon />
                </button>
            </header>

            {creating && (
                <form
                    className="binge-saved-create-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void handleCreate();
                    }}
                >
                    <input
                        type="text"
                        className="binge-saved-create-input"
                        placeholder="Collection name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        autoFocus
                        maxLength={60}
                        disabled={submitBusy}
                    />
                    <button
                        type="submit"
                        className="binge-saved-create-confirm"
                        disabled={submitBusy || !newName.trim()}
                    >
                        Create
                    </button>
                    <button
                        type="button"
                        className="binge-saved-create-cancel"
                        onClick={() => {
                            setCreating(false);
                            setNewName("");
                            setError(null);
                        }}
                        disabled={submitBusy}
                    >
                        Cancel
                    </button>
                </form>
            )}

            {error && <div className="binge-saved-error">{error}</div>}

            <div className="binge-saved-grid">
                {items.map((it) => (
                    <CollectionTile
                        key={it.def.tagName}
                        def={it.def}
                        cover={it.cover}
                        onOpen={() => handleOpenCollection(it.def)}
                        onLongPress={() => setConfirmDelete(it.def)}
                    />
                ))}
            </div>

            {confirmDelete && (
                <DeleteConfirm
                    name={confirmDelete.name}
                    // Identity, not a character. Testing for "★"
                    // anywhere in the name blocked deleting a user's own
                    // "5 ★ Picks" - telling them it was shared with ASR,
                    // which it was not, and leaving them no way to
                    // remove it - while letting Watch Later through.
                    isProtected={confirmDelete.tagName === FAVOURITES_TAG_NAME}
                    onConfirm={handleConfirmDelete}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </div>
    );
}

function CollectionTile({
    def,
    cover,
    onOpen,
    onLongPress,
}: {
    def: CollectionDef;
    cover: CollectionCover | null;
    onOpen: () => void;
    onLongPress: () => void;
}) {
    const holdRef = useRef<number | null>(null);
    const heldRef = useRef(false);
    // Where the press started, and whether this tile saw the
    // pointerdown at all.
    const originRef = useRef<{ x: number; y: number } | null>(null);

    const cancelHold = () => {
        if (holdRef.current !== null) {
            window.clearTimeout(holdRef.current);
            holdRef.current = null;
        }
    };

    // Clear a pending hold on unmount. Without this the timer outlives
    // the tile and fires onLongPress against a gone component.
    useEffect(() => cancelHold, []);

    const onPointerDown = (e: React.PointerEvent) => {
        heldRef.current = false;
        originRef.current = { x: e.clientX, y: e.clientY };
        holdRef.current = window.setTimeout(() => {
            heldRef.current = true;
            holdRef.current = null;
            onLongPress();
        }, LONG_PRESS_MS);
    };
    // A slow scroll that starts on a tile stays within the browser's
    // own scroll slop for a while, so it never sends pointercancel -
    // and after 700ms of that, this opened the delete confirmation. Its
    // buttons are right-aligned with Delete outermost, which puts the
    // destructive one under the thumb that was scrolling. Movement past
    // a small threshold is not a hold.
    const onPointerMove = (e: React.PointerEvent) => {
        const o = originRef.current;
        if (!o || holdRef.current === null) return;
        if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > HOLD_SLOP_PX) {
            cancelHold();
        }
    };
    const onPointerUp = () => {
        const started = originRef.current !== null;
        cancelHold();
        originRef.current = null;
        // Only open if the press STARTED here. A drag released over a
        // different tile used to open whichever tile it landed on.
        if (started && !heldRef.current) onOpen();
    };
    const onPointerLeave = () => {
        cancelHold();
        originRef.current = null;
    };

    const scenes = cover?.scenes ?? [];
    return (
        <button
            type="button"
            className="binge-saved-tile"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            // A 700ms hold on mobile also raises the OS selection
            // callout, which lands on top of the delete dialog.
            onContextMenu={(e) => e.preventDefault()}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerLeave}
            onPointerCancel={onPointerLeave}
            aria-label={`Open ${def.name}`}
            title="Tap to open · hold to delete"
        >
            <div
                className={
                    "binge-saved-tile-cover" +
                    (scenes.length === 0
                        ? " is-empty"
                        : scenes.length === 1
                          ? " is-single"
                          : " is-mosaic")
                }
            >
                {scenes.length === 0 ? (
                    <span className="binge-saved-tile-empty">empty</span>
                ) : scenes.length === 1 ? (
                    <div
                        className="binge-saved-tile-single"
                        style={
                            scenes[0].screenshot
                                ? {
                                      backgroundImage: `url(${scenes[0].screenshot})`,
                                  }
                                : undefined
                        }
                    />
                ) : (
                    // 2×2 mosaic; fewer than 4 scenes leaves remaining
                    // cells as dark placeholders.
                    [0, 1, 2, 3].map((i) => {
                        const s = scenes[i];
                        return (
                            <div
                                key={i}
                                className="binge-saved-tile-cell"
                                style={
                                    s?.screenshot
                                        ? {
                                              backgroundImage: `url(${s.screenshot})`,
                                          }
                                        : undefined
                                }
                            />
                        );
                    })
                )}
            </div>
            <div className="binge-saved-tile-meta">
                <span className="binge-saved-tile-name">{def.name}</span>
                {cover && (
                    <span className="binge-saved-tile-count">
                        {cover.count}
                    </span>
                )}
            </div>
        </button>
    );
}

function DeleteConfirm({
    name,
    isProtected,
    onConfirm,
    onCancel,
}: {
    name: string;
    isProtected: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onCancel();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onCancel]);

    return (
        <div className="binge-saved-confirm-root">
            <div className="binge-saved-confirm-backdrop" onClick={onCancel} />
            <div className="binge-saved-confirm-card" role="dialog">
                <h3 className="binge-saved-confirm-title">Delete "{name}"?</h3>
                <p className="binge-saved-confirm-body">
                    {isProtected
                        ? "This collection is shared with ASR and can't be deleted from binge. Use Stash's tag manager if you really want to remove it."
                        : "The collection's Stash tag will be deleted. Scenes inside it stay in your library; only the tag association goes away."}
                </p>
                <div className="binge-saved-confirm-actions">
                    <button
                        type="button"
                        className="binge-saved-confirm-cancel"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="binge-saved-confirm-destroy"
                        onClick={onConfirm}
                        disabled={isProtected}
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

function ChevronLeft() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}
function PlusIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 5v14M5 12h14" />
        </svg>
    );
}

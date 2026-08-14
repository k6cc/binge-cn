import { useEffect, useRef, useState } from "react";
import {
    getStashDBBox,
    getLinkedPerformers,
    getTrendingStashDBPerformers,
    type StashDBTrendingPerformer,
} from "../api/stashdb";
import { usePerformerProfile } from "../performer/PerformerProfileContext";
import { useTab } from "./TabContext";
import { PerformerHoverCard } from "../home/PerformerHoverCard";
import {
    useAllowedGenders,
    orderedGenders,
    useIncludeStashDB,
} from "../home/pluginSettings";

// Horizontal scroll-snap row of StashDB performer bubbles, mirroring
// the homepage stories row. Mounts at the top of Explore. Data comes
// from stashdb.org's "trending" surface (queryPerformers sorted by
// LAST_SCENE) — same set the StashDB homepage shows.
//
// Each bubble:
//   - tap → opens their profile (LOCAL profile if they're already in
//     the user's library, otherwise the StashDB-only profile that
//     surfaces their StashDB scenes and a Follow CTA).
//   - hover → mini-profile card (same hover card the discovery feed
//     uses), with Follow + Open profile buttons inside.
export function DiscoverPerformersBar() {
    const { openProfile, openStashDBProfile } = usePerformerProfile();
    const allowedGenders = useAllowedGenders();
    // This row is nothing but StashDB, so the StashDB setting governs
    // it. Turning the integration off used to leave the row on Explore,
    // still fetching. Read here rather than in Explore so the rule sits
    // with the thing it governs.
    const includeStashDB = useIncludeStashDB();
    // Explore stays mounted while the user is on Home — it is hidden
    // with CSS, not unmounted — so this row used to fire five StashDB
    // trending queries on boot, up to 7.6s each, competing for
    // connections with the requests Home is actually waiting on. It
    // fetches when it is the tab being looked at, and not before.
    const { tab } = useTab();
    const visible = tab === "explore";
    const [state, setState] = useState<
        | { kind: "loading" }
        | { kind: "ready"; performers: BarItem[] }
        | { kind: "error" }
    >({ kind: "loading" });
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    // Stable cache key so flipping a gender toggle re-runs the
    // effect (the Set reference changes on every render).
    const genderKey = orderedGenders(allowedGenders).join(",");
    useEffect(() => {
        if (!includeStashDB || !visible) return;
        let alive = true;
        (async () => {
            try {
                const box = await getStashDBBox();
                if (!box) {
                    if (!alive) return;
                    setState({ kind: "error" });
                    return;
                }
                const [trending, linked] = await Promise.all([
                    getTrendingStashDBPerformers(
                        box.api_key,
                        30,
                        orderedGenders(allowedGenders),
                    ),
                    getLinkedPerformers(),
                ]);
                if (!alive) return;
                const linkedByStashId = new Map<string, string>();
                for (const lp of linked) {
                    linkedByStashId.set(lp.stashId, lp.localId);
                }
                const performers: BarItem[] = trending.map((p) => ({
                    ...p,
                    localId: linkedByStashId.get(p.id) ?? null,
                }));
                setState({ kind: "ready", performers });
            } catch {
                if (!alive) return;
                setState({ kind: "error" });
            }
        })();
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [genderKey, includeStashDB, visible]);

    // Track scroll edges to show/hide chevrons.
    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        const update = () => {
            setCanScrollLeft(el.scrollLeft > 4);
            setCanScrollRight(
                el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
            );
        };
        update();
        el.addEventListener("scroll", update, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => {
            el.removeEventListener("scroll", update);
            ro.disconnect();
        };
    }, [state.kind]);

    const scrollBy = (delta: number) => {
        const el = scrollerRef.current;
        if (!el) return;
        el.scrollBy({ left: delta, behavior: "smooth" });
    };

    // After every hook, so the hook order cannot change with the
    // setting.
    if (!includeStashDB) return null;
    if (state.kind === "error") return null; // graceful no-op
    return (
        <section className="binge-discover-bar">
            <h2 className="binge-discover-bar-title">Discover performers</h2>
            <div className="binge-discover-bar-row">
                <button
                    type="button"
                    className={
                        "binge-discover-bar-chevron is-prev" +
                        (canScrollLeft ? "" : " is-hidden")
                    }
                    onClick={() => scrollBy(-300)}
                    aria-label="Scroll left"
                    tabIndex={canScrollLeft ? 0 : -1}
                >
                    <ChevronLeft />
                </button>
                <div className="binge-discover-bar-scroll" ref={scrollerRef}>
                    {state.kind === "loading"
                        ? Array.from({ length: 8 }).map((_, i) => (
                              <span
                                  key={`s${i}`}
                                  className="binge-discover-bar-skeleton"
                              />
                          ))
                        : state.performers.map((p) => (
                              <PerformerBubble
                                  key={p.id}
                                  performer={p}
                                  onOpenStashDB={() => openStashDBProfile(p.id)}
                                  onOpenLocal={(localId) =>
                                      openProfile(localId)
                                  }
                              />
                          ))}
                </div>
                <button
                    type="button"
                    className={
                        "binge-discover-bar-chevron is-next" +
                        (canScrollRight ? "" : " is-hidden")
                    }
                    onClick={() => scrollBy(300)}
                    aria-label="Scroll right"
                    tabIndex={canScrollRight ? 0 : -1}
                >
                    <ChevronRight />
                </button>
            </div>
        </section>
    );
}

interface BarItem extends StashDBTrendingPerformer {
    localId: string | null;
}

function PerformerBubble({
    performer,
    onOpenStashDB,
    onOpenLocal,
}: {
    performer: BarItem;
    onOpenStashDB: () => void;
    onOpenLocal: (localId: string) => void;
}) {
    const handleOpen = () => {
        if (performer.localId) onOpenLocal(performer.localId);
        else onOpenStashDB();
    };
    return (
        <PerformerHoverCard
            name={performer.name}
            image={performer.image}
            gender={performer.gender}
            birthDate={performer.birthDate}
            inLibrary={performer.localId !== null}
            onOpenProfile={handleOpen}
            stashDBPerformerId={performer.id}
            stashBoxIndex={0 /* not used here unless follow is tapped */}
        >
            <span className="binge-discover-bubble">
                <span
                    className={
                        "binge-discover-bubble-img" +
                        (performer.localId !== null ? " is-in-library" : "")
                    }
                    style={
                        performer.image
                            ? {
                                  backgroundImage: `url(${performer.image})`,
                              }
                            : undefined
                    }
                >
                    {!performer.image && (
                        <span className="binge-discover-bubble-initial">
                            {performer.name.charAt(0).toUpperCase()}
                        </span>
                    )}
                </span>
                <span className="binge-discover-bubble-name">
                    {performer.name}
                </span>
            </span>
        </PerformerHoverCard>
    );
}

function ChevronLeft() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M15 6l-6 6 6 6" />
        </svg>
    );
}
function ChevronRight() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M9 6l6 6-6 6" />
        </svg>
    );
}

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useFeed, type FeedItem, type FeedState } from "./useFeed";
import { SceneFeedCard } from "./SceneFeedCard";
import { GalleryFeedCard } from "./GalleryFeedCard";
import { DiscoveryFeedCard } from "./DiscoveryFeedCard";
import { invalidateStashDBCache } from "../api/stashdb";
import { BingeLoading } from "../components/BingeLoading";
import { PackFeedCard } from "./PackFeedCard";
import { useTranslation } from "react-i18next";
import {
    useHiddenFeedCategories,
    type FeedCategory,
} from "./pluginSettings";

// Maps a feed item to the filter category the Home filter menu
// controls. Galleries return null — they're governed by the separate
// "Show galleries" setting, not this filter.
function feedCategory(it: FeedItem): FeedCategory | null {
    switch (it.kind) {
        case "discovery":
            return it.source === "trending" ? "trending" : "discover";
        case "scene":
            // Nobody linked: its own category, so a library full of
            // unidentified imports can turn them off without also
            // losing everything else.
            if (it.performers.length === 0) return "unidentified";
            return it.isRepost ? "reposts" : "posts";
        case "pack":
            if (!it.primaryPerformer) return "unidentified";
            return it.isRepost ? "reposts" : "posts";
        default:
            return null;
    }
}

// What to say when there is nothing to show. The distinction matters on
// a library that has been scanned but not tagged: there IS plenty new,
// none of it is identified, and "nothing new in your recent window"
// would send the reader looking for a bug that is not there.
function emptyMessage(
    state: FeedState,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    if (state.kind !== "ready") return t("status.no_new_content");
    if (state.items.length > 0) return t("status.all_filtered_out");
    const scenes = state.unidentifiedCount;
    const galleries = state.unidentifiedGalleryCount;
    if (scenes === 0 && galleries === 0)
        return t("status.no_new_content");
    // Scenes and galleries are held to the same bar (a linked
    // performer) but named apart: the reasons differ, and the reader
    // needs to know which thing to go and tag.
    if (galleries === 0)
        return t("status.unidentified_scenes", { count: scenes });
    if (scenes === 0)
        return t("status.unidentified_galleries", { count: galleries });
    const parts = [
        t("status.unidentified_count_scenes", { count: scenes }),
        t("status.unidentified_count_galleries", { count: galleries }),
    ].join(t("status.unidentified_joiner"));
    return t("status.unidentified_scenes_and_galleries", { parts });
}

interface FeedProps {
    // The scrollable container this feed lives inside — usually
    // <Home>'s `.binge-tab-scroll`. The virtualizer needs to attach
    // to the real scroll element, not the feed itself.
    scrollContainerRef: RefObject<HTMLDivElement | null>;
}

// Vertical mixed-media post feed for the Home tab. Sits below the
// StoriesRow inside the Home scroll container; shares recent-scenes /
// recent-galleries fetches via recentScenesCache.
//
// Virtualized via @tanstack/react-virtual — only the cards near the
// viewport are mounted. Avoids 50+ <video> elements + carousels piling
// up in the DOM as the user infinite-scrolls.
export function Feed({ scrollContainerRef }: FeedProps) {
    const { state, retry } = useFeed();
    const hidden = useHiddenFeedCategories();
    const feedRef = useRef<HTMLElement>(null);
    const [scrollMargin, setScrollMargin] = useState(0);
    const { t } = useTranslation();

    const rawItems = state.kind === "ready" ? state.items : [];
    const items = useMemo(
        () =>
            rawItems.filter((it) => {
                const cat = feedCategory(it);
                return cat === null || !hidden.has(cat);
            }),
        [rawItems, hidden]
    );

    // The feed isn't at the top of its scroll container — there's a
    // page title and the stories row above it. Tell the virtualizer
    // about that offset so it computes visibility correctly. Re-measure
    // on resize because the stories row height settles as performer
    // avatars finish loading.
    useEffect(() => {
        const scrollEl = scrollContainerRef.current;
        const feedEl = feedRef.current;
        if (!scrollEl || !feedEl) return;

        const updateMargin = () => {
            // display:none（切到其他标签页）时 rect/scrollTop 全为
            // 0，会把 margin 清成错误的中间态；恢复显示后 RO 会重
            // 新测出正确值。隐藏期间跳过更新。
            if (!scrollEl.clientWidth && !scrollEl.clientHeight) return;
            const scrollRect = scrollEl.getBoundingClientRect();
            const feedRect = feedEl.getBoundingClientRect();
            // feedRect.top is viewport-relative; convert to
            // scroll-content-relative by adding the container's current
            // scrollTop. scrollRect.top accounts for the container's
            // own viewport position (e.g., header above).
            const next = feedRect.top - scrollRect.top + scrollEl.scrollTop;
            setScrollMargin(next);
        };

        updateMargin();
        const ro = new ResizeObserver(updateMargin);
        ro.observe(scrollEl);
        ro.observe(feedEl);
        return () => ro.disconnect();
    }, [scrollContainerRef]);

    // ── 隐藏期间的测量冻结 ──────────────────────────────────────
    // 标签页用 display:none 隐藏（见 App.tsx TabContent 注释）。TanStack
    // Virtual 的 ResizeObserver 对 display:none 元素仍会派发 0×0 尺寸
    // 回调（元素 isConnected 为 true，库的守卫拦不住），把可见区附近
    // ~7 张卡片的缓存尺寸清零。恢复显示后：
    //   1. 清零条目按 0 高度参与布局 → 后续卡片 start 前移 → 切回时
    //      停留位置显示的是别的卡片；
    //   2. 滚动经过这些条目时 0→真实高度 的 resizeItem 触发滚动校正
    //      （item.start < scrollOffset 即校正）→ 内容连续跳动（下划
    //      不停闪动的来源）。
    // 这里在测量结果为 0 时改返回上次已知尺寸：resizeItem 的 delta 为
    // 0，不写缓存、不触发滚动校正——隐藏期间布局状态完全冻结，恢复
    // 显示后按原尺寸原位置挂载。key 对齐 getItemKey（items[i].key）。
    const lastSizesRef = useRef(new Map<string, number>());
    const measureGuarded = useCallback(
        (
            element: Element,
            entry: ResizeObserverEntry | undefined,
        ): number => {
            let size = 0;
            const box = entry?.borderBoxSize?.[0];
            if (box) {
                size = Math.round(box.blockSize);
            }
            if (size <= 0) {
                size = (element as HTMLElement).offsetHeight || 0;
            }
            const idx = Number(element.getAttribute("data-index"));
            const key = items[idx]?.key;
            if (size > 0) {
                if (key) lastSizesRef.current.set(key, size);
                return size;
            }
            // display:none：返回上次已知尺寸（从未测过的条目不会被
            // observe，走不到这里；万一走到，用 estimateSize 兜底）。
            return lastSizesRef.current.get(key) ?? 720;
        },
        [items],
    );

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scrollContainerRef.current,
        // Initial guess — measureElement refines each card's real
        // height as it mounts. Wildly off estimates lead to scrollbar
        // jumps during initial layout; 720px is a reasonable middle
        // between a short scene card (~520px) and a tall gallery
        // card with carousel (~900px).
        estimateSize: () => 720,
        overscan: 2,
        scrollMargin,
        getItemKey: (i) => items[i]?.key ?? i,
        measureElement: measureGuarded,
    });

    if (state.kind === "loading") {
        return (
            <section className="binge-feed binge-feed-loading">
                <BingeLoading minHeight="60vh" />
            </section>
        );
    }
    if (state.kind === "error") {
        return (
            <section className="binge-feed">
                <div className="binge-feed-empty binge-status-error">
                    <div>{t("status.feed_load_failed", { message: state.message })}</div>
                    <button
                        type="button"
                        className="binge-feed-retry"
                        onClick={retry}
                    >
                        {t("status.try_again")}
                    </button>
                </div>
            </section>
        );
    }
    if (items.length === 0) {
        return (
            <section className="binge-feed">
                <div className="binge-feed-empty">
                    {emptyMessage(state, t)}
                </div>
            </section>
        );
    }

    return (
        <section
            className="binge-feed"
            aria-label={t("nav.new_scenes_and_galleries")}
            ref={feedRef}
            style={{
                position: "relative",
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
            }}
        >
            {virtualizer.getVirtualItems().map((vi) => {
                const item = items[vi.index];
                if (!item) return null;
                return (
                    <div
                        key={vi.key}
                        data-index={vi.index}
                        ref={virtualizer.measureElement}
                        className="binge-feed-card-wrapper"
                        style={{
                            // Position the absolute child relative to
                            // the virtual list. scrollMargin already
                            // tells the virtualizer about the offset
                            // ABOVE the list, so vi.start is correctly
                            // 0-based against this container.
                            transform: `translate(-50%, ${vi.start}px)`,
                        }}
                    >
                        {item.kind === "scene" ? (
                            <SceneFeedCard item={item} />
                        ) : item.kind === "gallery" ? (
                            <GalleryFeedCard item={item} />
                        ) : item.kind === "pack" ? (
                            <PackFeedCard item={item} />
                        ) : (
                            <DiscoveryFeedCard
                                item={item}
                                onFollowed={() => {
                                    // Drop the StashDB cache so the
                                    // next useFeed refetch picks the
                                    // performer up as a library
                                    // performer and stops surfacing
                                    // them as a discovery suggestion.
                                    invalidateStashDBCache();
                                }}
                            />
                        )}
                    </div>
                );
            })}

            {/* End-of-feed marker positioned at the end of the
                virtualized region. */}
            <div
                className="binge-feed-tail"
                style={{
                    position: "absolute",
                    top: `${virtualizer.getTotalSize()}px`,
                    left: 0,
                    right: 0,
                }}
            >
                <div className="binge-feed-empty">
                    {t("status.reached_bottom_count", { count: items.length })}
                </div>
            </div>
        </section>
    );
}

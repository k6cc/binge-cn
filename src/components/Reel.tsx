import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    buildSceneFilter,
    findSceneById,
    findScenes,
    findScenesByIds,
} from "../api/queries";
import { transformObjectFilter } from "../api/savedFilterTransform";
import type { BingeScene } from "../api/queries";
import { SceneSlide } from "./SceneSlide";
import { useFilter } from "../filter/FilterContext";
import { useTab } from "../tabs/TabContext";
import { createChainAlgo, type ChainAlgo } from "../reel/chainAlgo";
import { useAutoHideTabBar } from "../hooks/useAutoHideTabBar";
import { BingeLoading } from "./BingeLoading";

import { useTranslation } from "react-i18next";

type LoadState =
    | { kind: "loading" }
    | {
          kind: "ready";
          scenes: BingeScene[];
          total: number;
          page: number;
          hasMore: boolean;
      }
    | { kind: "error"; message: string };

// How many scenes to request per page.
const PAGE_SIZE = 20;

// When the active slide is within this many of the end of the loaded list,
// fire the next page so the user doesn't reach the wall.
const PAGINATE_TRIGGER_DISTANCE = 5;

// Hard ceiling on accumulated scenes to keep memory bounded. The user
// would have to scroll past 500 slides to hit this; well past binge limits.
const MAX_LOADED = 500;

// Virtualizer overscan: how many off-screen slides to keep mounted on
// each side of the visible window. 1 gives ~3 mounted total (one ahead,
// one behind, one active) — well under Chrome's hardware decoder pool.
const OVERSCAN = 1;

export function Reel() {
    const [state, setState] = useState<LoadState>({ kind: "loading" });
    const [activeIndex, setActiveIndex] = useState(0);
    // Lifted O-counts keyed by scene id. SceneSlide writes here on every
    // optimistic update + server confirm; reading from here on remount
    // means a scrolled-past liked scene comes back with the right count.
    const [oOverrides, setOOverrides] = useState<Record<string, number>>({});
    const setOOverride = useCallback((sceneId: string, value: number) => {
        setOOverrides((prev) => ({ ...prev, [sceneId]: value }));
    }, []);
    // Same lifted-override pattern for rating and favourite status —
    // each scene's most-recent value survives virtualizer unmount.
    const [ratingOverrides, setRatingOverrides] = useState<
        Record<string, number | null>
    >({});
    const setRatingOverride = useCallback(
        (sceneId: string, value: number | null) => {
            setRatingOverrides((prev) => ({ ...prev, [sceneId]: value }));
        },
        [],
    );
    // Collection memberships keyed first by sceneId, then by tagName.
    // Generalises the old single-favourite override so the bookmark
    // menu's multiple folders all survive virtualizer unmount.
    const [collectionOverrides, setCollectionOverrides] = useState<
        Record<string, Record<string, boolean>>
    >({});
    const setCollectionOverride = useCallback(
        (sceneId: string, tagName: string, value: boolean) => {
            setCollectionOverrides((prev) => ({
                ...prev,
                [sceneId]: { ...(prev[sceneId] ?? {}), [tagName]: value },
            }));
        },
        [],
    );
    const { filter, activeSavedFilter } = useFilter();
    const {
        pinFirstSceneId,
        setPinFirstSceneId,
        pinnedQueue,
        setPinnedQueue,
        reelMode,
        setReelMode,
        setTab,
        setTabBarVisible,
        tabBarVisible,
    } = useTab();
    const scrollRef = useRef<HTMLDivElement>(null);
    // Chained-mode algo instance. Created on entry to chained mode in
    // the initial-load effect; torn down (set to null) on exit. Pure
    // module — see src/reel/chainAlgo.ts.
    const chainAlgoRef = useRef<ChainAlgo | null>(null);
    // Track which scene ids have already been fed into the algo's
    // onPlay so we don't double-count if the user scrolls back and
    // forward across the same slide.
    const playedSeenRef = useRef<Set<string>>(new Set());

    // Filter takeover: any user-driven chip change while in chained
    // mode snaps us back to random + bounces to the For You tab. The
    // tab move matters because the chained reel renders under the
    // Explore tab — without the bounce, the user would suddenly see
    // the Explore grid mid-watch when their chip flips reelMode back
    // to random. The Explore handler's clear-to-empty replace doesn't
    // trigger this — only a non-empty filter does.
    useEffect(() => {
        if (reelMode !== "chained") return;
        const empty =
            filter.performers.length === 0 &&
            filter.tags.length === 0 &&
            filter.studios.length === 0;
        if (!empty) {
            setReelMode("random");
            setTab("foryou");
        }
    }, [reelMode, filter, setReelMode, setTab]);

    // 修复：queue 路径下用户点 × 清除 performer 筛选 chip 时，pinnedQueue
    // 仍然活跃 — Reel 的 queue 路径优先级高于 filter，会继续播放包内场景，
    // 用户看到筛选 chip 消失但内容没变。这里监听 filter 变化：当 queue 活跃
    // 且 performers 被清空时，清除 queue 让 Reel 走 random 路径，用空 filter
    // 重新加载场景（随机推荐）。tags/studios 同理 — 任何筛选维度被清空都
    // 视为用户想退出包模式。不清除 pinFirstSceneId（chained 模式有自己的
    // filter-takeover effect 处理）。
    useEffect(() => {
        if (!pinnedQueue) return;
        const empty =
            filter.performers.length === 0 &&
            filter.tags.length === 0 &&
            filter.studios.length === 0;
        if (empty) {
            setPinnedQueue(null);
        }
    }, [filter, pinnedQueue, setPinnedQueue]);

    const sceneCount = state.kind === "ready" ? state.scenes.length : 0;
    const virtualizer = useVirtualizer({
        count: sceneCount,
        getScrollElement: () => scrollRef.current,
        // 关键：必须用 .binge-reel 的 clientHeight（= 100vh = mobile Chrome
        // 的 large viewport height），不能用 window.innerHeight（地址栏显示时
        // 比 100vh 小）。否则 vi.size < .binge-reel height，最后一部 wrapper
        // 顶部无法完全对齐视口顶部（max scrollTop 不够），导致最后一部
        // 不能达到 IO active 阈值，activeIndex 不更新，全屏退出会跳到
        // 倒数第三部。scrollRef.current 在首次 render 时可能为 null，用
        // window.innerHeight 作 fallback，measure() 后会修正。
        estimateSize: () => scrollRef.current?.clientHeight ?? window.innerHeight,
        overscan: OVERSCAN,
        getItemKey: (i) => (state.kind === "ready" ? state.scenes[i].id : i),
    });

    // Hide the tab/header chrome when scrolling down, reveal it on any
    // scroll-up. See useAutoHideTabBar — shared with the other tabs.
    // suppressAutoHideRef 在全屏退出的位置校正期间置 true，避免
    // scrollToIndex 产生的程序性滚动触发导航自动隐藏（闪烁）。
    // heightBeforeFsRef 记录进入全屏前的视口高度（px），供退出时
    // 判断"布局是否变化"（电脑端快速路径）及退出校正的目标高度。
    const suppressAutoHideRef = useRef(false);
    const heightBeforeFsRef = useRef(0);
    // tabBarVisible 的 ref 镜像 + 进全屏前的导航显隐记录：退出全屏
    // 恢复到进全屏前的状态（原本隐藏就保持隐藏，不强制弹出）。
    const tabBarVisibleRef = useRef(tabBarVisible);
    tabBarVisibleRef.current = tabBarVisible;
    const navVisibleBeforeFsRef = useRef(true);
    useAutoHideTabBar(scrollRef, suppressAutoHideRef);

    // Scroll-end tracker — drives the SceneSlide deferred-load behaviour.
    // 5px deadzone is critical: scroll-snap fires a stream of tiny
    // post-snap adjustment events; without the deadzone, the 200ms
    // settle timer would reset on every micro-event and `isScrolling`
    // would stay true forever, locking out video src assignment.
    const [isScrolling, setIsScrolling] = useState(false);
    const lastScrollTopRef = useRef(0);
    const scrollEndTimerRef = useRef<number | null>(null);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        lastScrollTopRef.current = el.scrollTop;
        const onScroll = () => {
            const current = el.scrollTop;
            const delta = Math.abs(current - lastScrollTopRef.current);
            lastScrollTopRef.current = current;
            // Sub-deadzone deltas are scroll-snap settling motion, not
            // user-driven scrolling. Ignore.
            if (delta < 5) return;
            setIsScrolling(true);
            if (scrollEndTimerRef.current !== null) {
                window.clearTimeout(scrollEndTimerRef.current);
            }
            scrollEndTimerRef.current = window.setTimeout(() => {
                setIsScrolling(false);
                scrollEndTimerRef.current = null;
            }, 200);
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (scrollEndTimerRef.current !== null) {
                window.clearTimeout(scrollEndTimerRef.current);
                scrollEndTimerRef.current = null;
            }
        };
    }, []);
    // 全屏/退出全屏后修复 scroll position：
    // 进入全屏：innerHeight 变大 → virtualizer 重新 measure → 卡片位置
    // 移动 → 当前卡片不在可见范围 → 卸载 → 浏览器检测到全屏元素从 DOM
    // 移除 → 自动退出全屏（"闪屏"）。
    // 根本修复：进入全屏前在 SceneSlide.handleToggleFullscreen 中固定
    // .binge-reel 的 height，防止 virtualizer 重新 measure。
    //
    // 退出全屏分两个阶段恢复，修复 Android Chrome 上的累积漂移：
    // 退出瞬间方向解锁、地址栏返回，100dvh 在几百毫秒内反复变化；
    // 若立即恢复动态高度并在中途只校正一次，之后的 dvh 变化会让
    // virtualizer 再次 re-measure → 卡片位置整体偏移 activeIndex×Δh，
    // 越往后偏得越多（十几部后超过一屏）→ IO 不再激活当前卡片 →
    // 视频停播、上下卡片内容串位。
    //   阶段1：orientationchange 完成 + 250ms 后，把高度换成显式 px
    //     （window.innerHeight，过渡期稳定不随地址栏动画抖动），
    //     measure + scrollToIndex 校正，并恢复播放。
    //   阶段2：再等 350ms（地址栏动画完成、dvh 稳定）恢复动态高度
    //     ("")，再次 measure + scrollToIndex 清掉残余漂移，并重新
    //     显示底部导航（阶段校正的向下滚动会触发自动隐藏）。
    //
    // 电脑端快速路径：进入全屏时记录固定 px 高度（= 进入前视口高度），
    // 退出时若视口高度未变（桌面端无地址栏/方向变化），布局完全没变
    // ——只恢复动态高度即可，跳过 pause + 位置校正，视频保持连续播放
    // （消除桌面端退出全屏时的"短暂暂停后继续"）。
    useEffect(() => {
        let cancelled = false;
        // 稳定引用：清理函数里避免直接读 scrollRef.current（lint 警告）。
        // .binge-reel 容器跨渲染持久存在，effect 创建时捕获即可。
        const scrollEl = scrollRef.current;
        const onChange = () => {
            const el = scrollEl;
            const fs = !!document.fullscreenElement;
            if (fs) {
                // 进入全屏：height 已在 SceneSlide.handleToggleFullscreen
                // 中固定为进入前视口高度的 px 值（requestFullscreen 之前
                // 设置）。此刻 clientHeight 即进入前视口高度，记录之供
                // 退出时比较/作为退出校正的目标高度。同时记录导航显隐，
                // 退出后恢复原状态（不强制弹出）。
                heightBeforeFsRef.current = el?.clientHeight ?? 0;
                navVisibleBeforeFsRef.current = tabBarVisibleRef.current;
            } else {
                // 快速路径：视口高度与进入前一致（电脑端典型）→ 布局
                // 没变，恢复动态高度直接返回，视频保持播放（导航状态
                // 未被改动，无需恢复）。
                if (
                    heightBeforeFsRef.current > 0 &&
                    Math.abs(window.innerHeight - heightBeforeFsRef.current) < 1
                ) {
                    heightBeforeFsRef.current = 0;
                    if (el) el.style.height = "";
                    return;
                }
                // 退出后的目标高度 = 进入全屏前的高度（退出最终会回到
                // 该布局：方向回正、地址栏状态一致）。过渡期的
                // window.innerHeight 不可信（快速退出时仍是全屏高度，
                // 偏大 → 容器比视口高 → 卡片底部 UI 沉到导航栏下面，
                // phase2 恢复后又归位 = 状态c 的"UI 被遮挡然后恢复"）。
                const targetH =
                    heightBeforeFsRef.current > 0
                        ? heightBeforeFsRef.current
                        : window.innerHeight;
                heightBeforeFsRef.current = 0;
                // 手机端：整个校正窗口内抑制导航自动隐藏，避免
                // scrollToIndex 的程序性滚动触发"先隐藏再弹出"。
                suppressAutoHideRef.current = true;
                // 退出全屏：先保持固定 px 高度，避免在方向/地址栏
                // 过渡期引入 dvh 抖动。
                // A. 立即暂停当前 active video，避免 scrollToIndex 期间
                //    orientationchange 触发的 IO 误激活上一部（双声/跳上一部）
                const pauseActive = () => {
                    const v = el?.querySelector<HTMLVideoElement>(
                        '.binge-slide[data-active="true"] video'
                    );
                    if (v && !v.paused) v.pause();
                };
                pauseActive();

                // 位置校正：等布局稳定后 measure + scrollToIndex。
                // then 在 scrollToIndex 落位后回调。
                const correctPosition = (then?: () => void) => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            if (cancelled) return;
                            virtualizer.measure();
                            requestAnimationFrame(() => {
                                if (cancelled) return;
                                const el2 = scrollRef.current;
                                if (!el2) return;
                                const original = el2.style.scrollBehavior;
                                el2.style.scrollBehavior = "auto";
                                virtualizer.scrollToIndex(activeIndex, {
                                    align: "start",
                                });
                                requestAnimationFrame(() => {
                                    el2.style.scrollBehavior = original;
                                    then?.();
                                });
                            });
                        });
                    });
                };

                // 阶段1：显式 px 高度（= 退出后的目标布局高度）+
                // 首次校正 + 恢复播放
                const phase1 = () => {
                    if (cancelled) return;
                    const el2 = scrollRef.current;
                    if (el2) {
                        el2.style.height = `${targetH}px`;
                    }
                    correctPosition(() => {
                        if (cancelled) return;
                        // scrollToIndex 完成后让 IO 重新激活。
                        // IO 在转换期间可能因 pause 守卫没触发 play，
                        // 这里主动恢复当前 active video 播放。
                        const el3 = scrollRef.current;
                        const v = el3?.querySelector<HTMLVideoElement>(
                            '.binge-slide[data-active="true"] video'
                        );
                        if (v && v.paused) {
                            v.play().catch(() => {});
                        }
                        // 阶段2：等地址栏动画完成、dvh 稳定后再恢复
                        // 动态高度并复校位置。
                        window.setTimeout(phase2, 350);
                    });
                };
                // 阶段2：恢复动态高度 + 二次校正 + 恢复导航原状态
                const phase2 = () => {
                    if (cancelled) return;
                    const el2 = scrollRef.current;
                    if (el2) {
                        el2.style.height = "";
                    }
                    correctPosition(() => {
                        // 延迟到滚动稳定后再恢复（避免校正产生的
                        // scroll 事件又被自动隐藏逻辑覆盖），恢复到进
                        // 全屏前的显隐状态（原本隐藏就保持隐藏），
                        // 随后解除自动隐藏抑制。
                        window.setTimeout(() => {
                            if (cancelled) return;
                            setTabBarVisible(navVisibleBeforeFsRef.current);
                            suppressAutoHideRef.current = false;
                        }, 300);
                    });
                };

                // screen.orientation 解锁会触发 orientationchange（约 300-500ms 后）
                // B. scrollToIndex 必须等 orientationchange 完成（如果横屏 → 竖屏）
                //    再执行，否则在方向变化中途 measure 会得到错误尺寸
                const orient = screen.orientation;
                if (orient && typeof orient.addEventListener === "function") {
                    let orientationChanged = false;
                    const onOrientChange = () => {
                        orientationChanged = true;
                        orient.removeEventListener("change", onOrientChange);
                        // orientationchange 后 layout 还要 200-300ms 稳定
                        setTimeout(phase1, 250);
                    };
                    orient.addEventListener("change", onOrientChange);
                    // 兜底：如果 400ms 内没 orientationchange（非横屏视频或 iOS）
                    // 直接执行
                    setTimeout(() => {
                        if (!orientationChanged) {
                            orient.removeEventListener("change", onOrientChange);
                            phase1();
                        }
                    }, 400);
                } else {
                    phase1();
                }
            }
        };
        document.addEventListener("fullscreenchange", onChange);
        return () => {
            cancelled = true;
            document.removeEventListener("fullscreenchange", onChange);
            // 阶段中途被取消（依赖变化/卸载）时，避免把容器留在显式
            // px 高度：非全屏状态下恢复动态高度。同时解除自动隐藏
            // 抑制，防止卡在"导航永不自动隐藏"的状态。
            if (scrollEl && !document.fullscreenElement && scrollEl.style.height.endsWith("px")) {
                scrollEl.style.height = "";
            }
            suppressAutoHideRef.current = false;
        };
    }, [virtualizer, activeIndex, setTabBarVisible]);
    // Latest in-flight fetch token. Stale responses (from a previous
    // filter set, or duplicate next-page calls) compare and bail.
    const fetchTokenRef = useRef(0);

    // Sort seed: with sort=random Stash returns a different shuffle every
    // call. Pinning a seed makes pages 2,3,4… stay consistent with page 1.
    // New filter set → new seed → new shuffle. When a Stash saved
    // filter is active, we use its sort directly (which may be a
    // pinned random_<seed> already, or rating/date/etc).
    const sortSeed = useMemo(
        () => `random_${Math.floor(Math.random() * 1e9)}`,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [filter, activeSavedFilter],
    );

    // scene_filter — either binge's chip-derived filter or the saved
    // filter's object_filter (after transforming from Stash's UI
    // storage shape to the GraphQL input shape; see
    // savedFilterTransform.ts).
    const sceneFilter = useMemo(() => {
        if (activeSavedFilter) {
            return transformObjectFilter(activeSavedFilter.object_filter);
        }
        return buildSceneFilter(
            filter.performers.map((p) => p.id),
            filter.tags.map((t) => t.id),
            filter.studios.map((s) => s.id),
        );
    }, [filter, activeSavedFilter]);

    // find_filter sort + direction — saved filter overrides binge's
    // random when active. `q` is dropped (Stash's text search isn't
    // meaningful in the reel).
    const findFilterBase = useMemo<{
        sort: string;
        direction: "ASC" | "DESC";
    }>(() => {
        if (activeSavedFilter?.find_filter?.sort) {
            return {
                sort: activeSavedFilter.find_filter.sort,
                direction: activeSavedFilter.find_filter.direction ?? "DESC",
            };
        }
        return { sort: sortSeed, direction: "DESC" };
    }, [activeSavedFilter, sortSeed]);

    // Initial load (and reload on filter/mode change).
    //
    // Random mode (the default — current behaviour): fetch a random
    // page 1 plus the pinned scene if one is set; hoist the pinned
    // scene to position 0.
    // 
    // Chained mode (set by an Explore tile tap): fetch ONLY the pinned
    // scene. Build a fresh ChainAlgo seeded with that scene id in the
    // `visited` set so the algo never picks it again. Subsequent
    // scenes are produced by algoRef.nextBatch() in the pagination
    // effect below.
    const { t } = useTranslation();
    useEffect(() => {
        const token = ++fetchTokenRef.current;
        setState({ kind: "loading" });
        const pin = pinFirstSceneId;
        const queue = pinnedQueue;
        playedSeenRef.current = new Set();

        // Queue path: deterministic ordered playlist, no
        // pagination — the reel renders exactly these scenes in
        // this order and bottoms out at the last one. Used by
        // PerformerSceneGrid so tapping a scene plays the grid in
        // sequence rather than dropping into a random feed.
        if (queue) {
            chainAlgoRef.current = null;
            findScenesByIds(queue.ids)
                .then((scenes) => {
                    if (token !== fetchTokenRef.current) return;
                    setState({
                        kind: "ready",
                        scenes,
                        total: scenes.length,
                        page: 1,
                        hasMore: false,
                    });
                    // startIndex indexes the ORIGINAL id list, but
                    // findScenesByIds can drop deleted scenes (and
                    // isn't guaranteed to preserve order), so locate
                    // the tapped scene by id in the fetched list
                    // rather than trusting the raw index — otherwise a
                    // missing earlier scene shifts everything and the
                    // reel opens on the wrong scene.
                    const targetId = queue.ids[queue.startIndex];
                    const found = scenes.findIndex((s) => s.id === targetId);
                    const idx =
                        found >= 0
                            ? found
                            : Math.min(
                                  Math.max(0, queue.startIndex),
                                  Math.max(0, scenes.length - 1),
                              );
                    setActiveIndex(idx);
                    setOOverrides({});
                    setRatingOverrides({});
                    setCollectionOverrides({});
                    // Defer scroll until the slides are laid out:
                    // before commit, scrollHeight is still 0 and
                    // scrollTo floors to top.
                    //
                    // Retrying across frames because one is not always
                    // enough while the slides are still committing.
                    //
                    // The "opens on the wrong scene" bug this block used
                    // to describe as open was diagnosed and fixed in
                    // this same function - see the comment on settle()
                    // below. Leaving it as a KNOWN BUG with a "next
                    // step is to log scrollTop" sent the next reader
                    // chasing something already solved.
                    const settle = (tries: number) => {
                        if (token !== fetchTokenRef.current) return;
                        const el = scrollRef.current;
                        if (!el) return;
                        const want = idx * el.clientHeight;
                        // "instant", not "auto".
                        //
                        // .binge-reel sets scroll-behavior: smooth, and
                        // per CSSOM-View "auto" defers to that property
                        // - so every call here was a SMOOTH scroll, and
                        // the spec's first step for a scroll is to abort
                        // any ongoing one. The rAF loop therefore
                        // restarted the eased animation every frame and
                        // only ever advanced by the first frame of a
                        // fresh ease-in-out curve. Measured: 31 frames
                        // reached scrollTop 1814 of a wanted 9284, and
                        // the leftover animation plus snap landed on
                        // index 4 - the same index whatever was asked
                        // for, which is exactly the wrong-scene report.
                        //
                        // The convergence check below could not fire
                        // either: a smooth scrollTo never moves
                        // scrollTop synchronously, so the loop always
                        // burned all 30 tries.
                        //
                        // Snap is suspended for the jump as well. With
                        // mandatory snap the browser can only land on a
                        // snap area that is MOUNTED, and the
                        // virtualizer keeps about four - so one call
                        // advanced at most two slides however it was
                        // behaved, and the 30-try budget capped the
                        // whole jump at roughly 62. Tapping tile 70 of
                        // a pack opened scene 63. With snap off the
                        // same jump lands exactly, first try.
                        el.style.scrollSnapType = "none";
                        el.scrollTo({ top: want, behavior: "instant" });
                        const done = Math.abs(el.scrollTop - want) < 2;
                        if (done || tries >= 30) {
                            // Restored on the next frame, so the browser
                            // does not re-snap mid-assignment.
                            window.requestAnimationFrame(() => {
                                const cur = scrollRef.current;
                                if (cur) cur.style.scrollSnapType = "";
                            });
                            return;
                        }
                        window.requestAnimationFrame(() => settle(tries + 1));
                    };
                    window.requestAnimationFrame(() => settle(0));
                    // Bug 5 修复：不要在这里清除 queue。pinnedQueue 在依赖
                    // 数组中，清除会立即触发 effect 重跑 → 走 random 路径
                    // → 用随机场景覆盖 queue 场景。queue 由 setTab 在用户
                    // 离开时清除。
                })
                .catch((err: Error) => {
                    if (token !== fetchTokenRef.current) return;
                    setState({ kind: "error", message: err.message });
                    setPinnedQueue(null);
                });
            return;
        }

        if (reelMode === "chained" && pin) {
            // Chained path: fetch the pinned scene, build the algo,
            // FEED THE PINNED SCENE INTO THE CONTEXT via onPlay BEFORE
            // calling setState. The pagination effect fires
            // synchronously off the state transition, which then calls
            // algo.nextBatch — and that batch is only useful if the
            // context already reflects the seeded scene's performers
            // and tags. (The IntersectionObserver-driven onPlay only
            // fires later, after the next paint.)
            const algo = createChainAlgo();
            chainAlgoRef.current = algo;
            findSceneById(pin)
                .then((pinnedScene) => {
                    if (token !== fetchTokenRef.current) return;
                    if (!pinnedScene) {
                        setState({
                            kind: "error",
                            message: t("status.pinned_scene_not_found"),
                        });
                        return;
                    }
                    // Prime the context with the seed scene's attributes.
                    algo.onPlay(pinnedScene);
                    // Mark the seed as already-played so handleActive's
                    // dedupe doesn't double-count when the IO fires.
                    playedSeenRef.current.add(pinnedScene.id);
                    setState({
                        kind: "ready",
                        scenes: [pinnedScene],
                        total: 1,
                        page: 1,
                        // Chained mode never "runs out" — set hasMore
                        // true so the pagination effect always tries
                        // to produce the next batch.
                        hasMore: true,
                    });
                    setActiveIndex(0);
                    setOOverrides({});
                    setRatingOverrides({});
                    setCollectionOverrides({});
                    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
                    // Bug 5 修复：不要在这里清除 pin。pinFirstSceneId 在依赖
                    // 数组中，清除会立即触发 effect 重跑 → 落入 random 路径
                    // → 用随机场景覆盖 chained 场景。pin 由 setTab 或
                    // filter-takeover 在用户离开 chained 模式时清除。
                })
                .catch((err: Error) => {
                    if (token !== fetchTokenRef.current) return;
                    setState({ kind: "error", message: err.message });
                    setPinFirstSceneId(null);
                });
            return;
        }

        // Bug 5 修复：chained 模式下若 pin 已被清除（例如 chained 路径
        // 完成后 effect 重跑），不要落入 random 路径，否则会用随机场景
        // 覆盖已加载的 chained 场景。等待 pin 重新设置或用户退出
        // chained 模式（filter-takeover 会 setReelMode("random")）。
        if (reelMode === "chained") {
            return;
        }

        // Random path (existing behaviour). Drop any prior chained
        // algo so it gets GC'd.
        chainAlgoRef.current = null;
        const firstPage = findScenes({
            filter: {
                page: 1,
                per_page: PAGE_SIZE,
                sort: findFilterBase.sort,
                direction: findFilterBase.direction,
            },
            scene_filter: sceneFilter,
        });
        const pinned = pin ? findSceneById(pin) : Promise.resolve(null);
        Promise.all([firstPage, pinned])
            .then(([data, pinnedScene]) => {
                if (token !== fetchTokenRef.current) return;
                let scenes = data.findScenes.scenes;
                if (pinnedScene) {
                    scenes = [
                        pinnedScene,
                        ...scenes.filter((s) => s.id !== pinnedScene.id),
                    ];
                }
                setState({
                    kind: "ready",
                    scenes,
                    total: data.findScenes.count,
                    page: 1,
                    hasMore:
                        data.findScenes.scenes.length === PAGE_SIZE &&
                        data.findScenes.scenes.length < data.findScenes.count,
                });
                setActiveIndex(0);
                // New scene population — drop any optimistic O-counts from
                // the previous filter set so we don't apply them to
                // unrelated scenes.
                setOOverrides({});
                scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
                // Bug 修复：原先在这里 setPinFirstSceneId(null) 清除 pin，
                // 但 pinFirstSceneId 在依赖数组中 → 清除会立即触发 effect
                // 重跑 → 第二次跑时 pin 为 null → 走 random 路径重新拉
                // 一页随机场景覆盖掉刚放好的 pin 场景 → 用户看到随机影片
                // 而非点击的影片。改为不清除 pin，让 pin 留在 state 里。
                // 下次 effect 重跑（filter/tab 变化）时会读到同一个 pin
                // 并重新 fetch — 结果一致（pin 场景仍在 index 0）。pin
                // 最终由 setTab（用户切走时）或 chained 模式的 filter-
                // takeover 清除。
            })
            .catch((err: Error) => {
                if (token !== fetchTokenRef.current) return;
                setState({ kind: "error", message: err.message });
                if (pin) setPinFirstSceneId(null);
            });
        // 硬约束：依赖数组必须包含 pinnedQueue 和 pinFirstSceneId。
        // 原实现故意排除它们（通过闭包读取），但当调用方在 setTab 之后
        // 才设置 pin/queue 时，effect 不会重跑，导致种子场景丢失。
        // 显式加入依赖可保证任一变化都重新加载。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortSeed, sceneFilter, findFilterBase, reelMode, pinnedQueue, pinFirstSceneId]);

    // Auto-paginate: when the active slide is near the tail, fetch the
    // next batch and append. Branches on reelMode — random mode keeps
    // its page-based pagination; chained mode pulls from the algo.
    const loadingMoreRef = useRef(false);
    useEffect(() => {
        if (state.kind !== "ready") return;
        if (!state.hasMore) return;
        if (loadingMoreRef.current) return;
        if (state.scenes.length >= MAX_LOADED) return;

        const distanceToEnd = state.scenes.length - 1 - activeIndex;
        if (distanceToEnd > PAGINATE_TRIGGER_DISTANCE) return;

        loadingMoreRef.current = true;
        const token = fetchTokenRef.current;

        if (reelMode === "chained" && chainAlgoRef.current) {
            const algo = chainAlgoRef.current;
            algo.nextBatch(PAGE_SIZE)
                .then((fresh) => {
                    if (token !== fetchTokenRef.current) return;
                    setState((s) => {
                        if (s.kind !== "ready") return s;
                        const existingIds = new Set(s.scenes.map((x) => x.id));
                        const deduped = fresh.filter(
                            (x) => !existingIds.has(x.id),
                        );
                        return {
                            ...s,
                            scenes: [...s.scenes, ...deduped],
                            page: s.page + 1,
                            // If the algo couldn't produce any new
                            // scenes (library exhausted relative to
                            // visited set), stop paginating.
                            hasMore: deduped.length > 0,
                        };
                    });
                })
                .catch((err) => {
                    // Pagination retries on next scroll; just surface
                    // in DevTools so the failure is debuggable.
                    console.error(
                        "[binge] chained-mode pagination failed",
                        err,
                    );
                })
                .finally(() => {
                    loadingMoreRef.current = false;
                });
            return;
        }

        // Random mode (existing behaviour).
        const nextPage = state.page + 1;
        findScenes({
            filter: {
                page: nextPage,
                per_page: PAGE_SIZE,
                sort: findFilterBase.sort,
                direction: findFilterBase.direction,
            },
            scene_filter: sceneFilter,
        })
            .then((data) => {
                if (token !== fetchTokenRef.current) return;
                setState((s) => {
                    if (s.kind !== "ready") return s;
                    // Dedup by id — safety against random sort edge cases.
                    const existingIds = new Set(s.scenes.map((x) => x.id));
                    const fresh = data.findScenes.scenes.filter(
                        (x) => !existingIds.has(x.id),
                    );
                    return {
                        ...s,
                        scenes: [...s.scenes, ...fresh],
                        page: nextPage,
                        hasMore:
                            fresh.length > 0 &&
                            s.scenes.length + fresh.length <
                                data.findScenes.count,
                    };
                });
            })
            .catch(() => {
                /* leave hasMore alone — the user can retry by scrolling back into the trigger zone */
            })
            .finally(() => {
                loadingMoreRef.current = false;
            });
    }, [activeIndex, state, sortSeed, sceneFilter, findFilterBase, reelMode]);

    // Stable handleActive — keep state in a ref so callback identity
    // doesn't churn on every pagination, which would otherwise tear down
    // every SceneSlide's IntersectionObserver mid-scroll.
    const stateRef = useRef(state);
    useEffect(() => {
        stateRef.current = state;
    }, [state]);
    const handleActive = useCallback((sceneId: string) => {
        const s = stateRef.current;
        if (s.kind !== "ready") return;
        const idx = s.scenes.findIndex((x) => x.id === sceneId);
        if (idx >= 0) setActiveIndex(idx);

        // Chained mode: feed each newly-played scene into the algo so
        // its weighted context evolves with what the user is actually
        // watching. Guard against double-counting on scroll back +
        // forward via playedSeenRef.
        if (chainAlgoRef.current && !playedSeenRef.current.has(sceneId)) {
            const scene = s.scenes.find((x) => x.id === sceneId);
            if (scene) {
                playedSeenRef.current.add(sceneId);
                chainAlgoRef.current.onPlay(scene);
            }
        }
    }, []);

    // Always render the scroll container so scrollRef stays attached
    // across loading/empty/ready transitions. Without this, the virtualizer
    // (initialised on first render while loading) can latch onto a null
    // scroll element and never re-wire when .binge-reel later appears —
    // observed as "tab away, come back, nothing loads."
    const scenes = state.kind === "ready" ? state.scenes : [];
    const errorOrEmpty =
        state.kind === "error"
            ? t("status.error_message", { message: state.message })
            : state.kind === "ready" && state.scenes.length === 0
              ? t("status.no_scenes_matched")
              : null;
    return (
        <div className="binge-reel" ref={scrollRef}>
            {state.kind === "loading" && (
                <div className="binge-status-overlay binge-reel-loading">
                    <BingeLoading />
                </div>
            )}
            {errorOrEmpty && (
                <div
                    className={
                        "binge-status binge-status-overlay" +
                        (state.kind === "error" ? " binge-status-error" : "")
                    }
                >
                    {errorOrEmpty}
                </div>
            )}
            <div
                className="binge-reel-virtual"
                style={{
                    height: `${virtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                }}
            >
                {virtualizer.getVirtualItems().map((vi) => {
                    const scene = scenes[vi.index];
                    if (!scene) return null;
                    return (
                        <div
                            key={vi.key}
                            className="binge-slide-wrapper"
                            style={{
                                transform: `translateY(${vi.start}px)`,
                                height: `${vi.size}px`,
                            }}
                        >
                            <SceneSlide
                                scene={scene}
                                preload="auto"
                                onActive={handleActive}
                                oCountOverride={oOverrides[scene.id]}
                                onOCountChange={setOOverride}
                                ratingOverride={ratingOverrides[scene.id]}
                                onRatingChange={setRatingOverride}
                                collectionsOverride={
                                    collectionOverrides[scene.id]
                                }
                                onCollectionChange={setCollectionOverride}
                                currentlyScrolling={isScrolling}
                                onAutoAdvance={() => {
                                    // Smooth-scroll to the next slide.
                                    // The virtualizer routes through
                                    // the snap container so this stays
                                    // consistent with how user swipes
                                    // update scroll position.
                                    const next = vi.index + 1;
                                    if (next < scenes.length) {
                                        virtualizer.scrollToIndex(next, {
                                            align: "start",
                                            behavior: "smooth",
                                        });
                                    }
                                }}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

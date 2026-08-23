import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BingeScene } from "../api/queries";
import { ActionStack } from "./ActionStack";
import { PerformerRow } from "./PerformerRow";
import {
    buildTranscodeSeekUrl,
    isWebCompatible,
    pickStreamUrl,
} from "../util/pickStream";
import { MuteToggle } from "./MuteToggle";
import { SceneProgress } from "./SceneProgress";
import { useMuteState } from "../hooks/useMuteState";
import {
    PLAYBACK_LAYER,
    isPlaybackGated,
    subscribePlaybackGate,
} from "../util/playbackStack";
import {
    sceneDecrementO,
    sceneIncrementO,
    setSceneRating,
} from "../api/mutations";
import { recordTagInteractions } from "../api/interactedTags";
import {
    getCollections,
    getCollectionTagIds,
    setSceneInCollection,
    subscribeCollections,
} from "../api/collections";
import {
    isInMultiviewQueue,
    toggleMultiviewQueueScene,
    openMultiviewPlayer,
    subscribeMultiviewQueue,
    startMultiviewSync,
} from "../api/multiview";
import { HeartBurst } from "./HeartBurst";
import { SceneDetailsSheet } from "./SceneDetailsSheet";
import { CriterionRatingModal } from "./CriterionRatingModal";
import { MoreSheet } from "./MoreSheet";
import {
    useAutoScroll,
    useAutoLoadCaptions,
    useTranscodeType,
    useRandomStart,
    useRandomStartSeconds,
    parseRandomStartSeconds,
} from "../home/pluginSettings";
import { useScribeModal } from "../scribe/ScribeContext";

interface SceneSlideProps {
    scene: BingeScene;
    // Whether this slide should aggressively buffer (preload="auto"). With
    // virtualization mounting only ~3 slides at a time, "auto" is safe.
    preload?: "auto" | "metadata" | "none";
    // Called when this slide becomes the dominant intersecting one (>= 0.6).
    // Used by the parent Reel to track activeIndex for pagination triggers.
    onActive?: (sceneId: string) => void;
    // Lifted O-count: Reel owns the canonical optimistic value so it
    // survives unmount/remount when the slide scrolls out of the
    // virtualizer's overscan window. If undefined, falls back to the
    // server-shipped scene.o_counter.
    oCountOverride?: number;
    onOCountChange?: (sceneId: string, next: number) => void;
    // Same lifted-override pattern for rating + favourite — Reel owns
    // the canonical state, SceneSlide reads override-or-server-value.
    ratingOverride?: number | null;
    onRatingChange?: (sceneId: string, next: number | null) => void;
    // Per-collection membership for the bookmark menu — keys are
    // tagName values from BINGE_COLLECTIONS. Reel owns the canonical
    // map across virtualizer mount/unmount.
    collectionsOverride?: Record<string, boolean>;
    onCollectionChange?: (
        sceneId: string,
        tagName: string,
        next: boolean
    ) => void;
    // True while the parent Reel is mid-scroll. We defer assigning
    // video.src until scroll settles — without this, every transient
    // slide allocated during a fast flick takes a hardware decoder
    // slot. Managed IMPERATIVELY via useEffect (not a React prop on
    // <video>), because toggling the src prop between undefined and
    // a URL doesn't reliably re-trigger load() in any browser.
    currentlyScrolling?: boolean;
    // Auto-scroll: when the user has it enabled in MoreSheet, the
    // active slide's video should NOT loop and should advance to the
    // next slide on its `ended` event.
    onAutoAdvance?: () => void;
}

// One slide of the reel. Owns:
//   - its <video> element
//   - an IntersectionObserver that plays when on-screen and pauses off-screen
//   - the overlay (title, performers, tags)
//
// Why each slide owns its own observer instead of a parent-managed "current
// index": scroll-snap doesn't guarantee a single visible item at the moment
// of snap; with one observer per slide we get clean transitions even mid-snap.
// One burst per like-trigger. Auto-cleaned BURST_LIFETIME_MS after spawn.
interface Burst {
    id: number;
}
const BURST_LIFETIME_MS = 2700;
// Window in which a second tap counts as a double-tap. 280ms is the
// browser convention. Single-click play/pause is delayed by this amount.
const DOUBLE_TAP_WINDOW_MS = 280;

// 随机时段：计算本次播放的 A→B 窗口（影片绝对时间）。
//   seconds = null（输入框空）→ 随机起点，播放到影片结束（end=null）
//   seconds = N → 窗口恰好 N 秒（end = start + N），随机放置在影片内
// 影片时长不足 N 秒时退化为"随机起点 + 播到结束"。
function computeRandomWindow(
    duration: number,
    seconds: number | null
): { start: number; end: number | null } {
    if (seconds !== null && seconds > 0 && seconds < duration) {
        const start = Math.random() * (duration - seconds);
        return { start, end: start + seconds };
    }
    // 无明确时长（或时长 ≥ 影片）：随机起点 + 播放到结束。留 2 秒
    // 余量，避免随机点落在片尾导致"一开就结束"。
    const start = duration > 2 ? Math.random() * (duration - 2) : 0;
    return { start, end: null };
}

// ── 竖屏播放横屏视频的位置优化 ──────────────────────────────
// 非全屏时若上下黑边（letterbox）过大，视频内容上移黑边的 40%，
// 缓解"上半屏纯空、内容整体偏下"的观感；全屏保持居中（标准播放
// 器行为）。
//
// 内容定位由 CSS object-position: 50% 30% 完成（见 .binge-video 注
// 释）：把剩余空间按 30%/70% 上下分配，数学上等同 translateY(-40%
// 黑边)。竖版内容撑满容器高度时 Y 百分比无效果（天然居中）；poster
// 与视频内容遵循同一规则，无首帧错位，场景切换值恒定不触发过渡。
// 本文件只测量 px 上移量（shift），供字幕定位与按钮组跟随消费。
const LETTERBOX_SHIFT_RATIO = 0.4; // 上移单侧黑边的 40%

// poster 自然尺寸记忆（sceneId → {w, h}）。无文件场景的内容尺寸唯一
// 来源是 poster 图（异步资源）；首次测量后在此缓存，同会话内滑回该
// 场景时 useLayoutEffect 的首次同步 update() 即拿到尺寸——按钮组/
// 转圈首帧直接在最终位置（与有元数据场景一致的"新居中位置直达"），
// 零隐藏期。条目为几百字节的纯数据（上限随 MAX_LOADED 500 场景），
// 无需清理。
const posterSizeCache = new Map<string, { w: number; h: number }>();

// 测量 object-fit: contain 下视频内容的渲染尺寸与上移量。
// allowShift=false（全屏）时 shift 恒为 0。
// fallbackVw/Vh：视频元数据未到（poster 阶段）时用 Stash 元数据里的
// 分辨率回退，让按钮组/字幕从首帧就落在内容实际位置。
function measureVideoContent(
    video: HTMLVideoElement,
    allowShift: boolean,
    fallbackVw = 0,
    fallbackVh = 0
): { rw: number; rh: number; shift: number } {
    let vw = video.videoWidth;
    let vh = video.videoHeight;
    if ((!vw || !vh) && fallbackVw > 0 && fallbackVh > 0) {
        vw = fallbackVw;
        vh = fallbackVh;
    }
    const cw = video.clientWidth;
    const ch = video.clientHeight;
    if (!vw || !vh || !cw || !ch) return { rw: 0, rh: 0, shift: 0 };
    const ratio = vw / vh;
    const cr = cw / ch;
    let rw: number, rh: number;
    if (ratio > cr) {
        rw = cw;
        rh = cw / ratio;
    } else {
        rh = ch;
        rw = ch * ratio;
    }
    let shift = 0;
    if (allowShift && ratio > cr) {
        // 横版内容才有上下黑边；竖版（ratio ≤ cr）shift=0，
        // 与 object-position 对竖版无效果的行为一致。
        shift = Math.round(((ch - rh) / 2) * LETTERBOX_SHIFT_RATIO);
    }
    return { rw, rh, shift };
}

export function SceneSlide({
    scene,
    preload = "metadata",
    onActive,
    oCountOverride,
    onOCountChange,
    ratingOverride,
    onRatingChange,
    collectionsOverride,
    onCollectionChange,
    currentlyScrolling = false,
    onAutoAdvance,
}: SceneSlideProps) {
    const { t } = useTranslation();
    const autoScroll = useAutoScroll();
    const autoLoadCaptions = useAutoLoadCaptions();
    // 随机时段（MoreSheet 开关 + 秒数输入框）。seconds 为 null 表示
    // 输入框为空 = 随机起点播放到影片结束。
    const randomStart = useRandomStart();
    const randomStartSecondsRaw = useRandomStartSeconds();
    const randomSeconds = useMemo(
        () => parseRandomStartSeconds(randomStartSecondsRaw),
        [randomStartSecondsRaw]
    );
    // Stash's authoritative duration. Falls back to video.duration inside
    // SceneProgress when this is null.
    const stashDuration = scene.files?.[0]?.duration ?? null;
    // Caption <track> src — only when the toggle is on AND Stash reported
    // at least one caption for this scene. We always pick the first;
    // local libraries typically have a single subtitle file and the
    // Stash scan already ordered them. language_code may be "" (no lang
    // tag in filename) — passed through as-is; srclang falls back to
    // "und" so the <track> stays valid HTML.
    const captionTrack = useMemo(() => {
        if (!autoLoadCaptions) return null;
        const c = scene.captions?.[0];
        if (!c) return null;
        const lang = c.language_code ?? "";
        return {
            src: `/scene/${scene.id}/caption?lang=${encodeURIComponent(lang)}&type=${encodeURIComponent(c.caption_type)}`,
            srclang: lang || "und",
            label: lang || t("action.captions"),
        };
    }, [autoLoadCaptions, scene.id, scene.captions, t]);

    // Custom caption rendering: we hide the native <track> display
    // (mode=hidden) and render the active cue's text in a positioned
    // <div> instead. This gives us full control over:
    //   - position: anchored to the video CONTENT bottom (not the
    //     element bottom), so 16:9 video on a portrait screen shows
    //     captions above the letterbox area where the binge overlay
    //     lives — no UI overlap.
    //   - font size: scales with the rendered video width (not the
    //     viewport), so captions shrink on narrow phones and grow on
    //     fullscreen desktops.
    //   - style: text-shadow outline instead of the default black box.
    const captionRef = useRef<HTMLDivElement>(null);
    const [captionText, setCaptionText] = useState("");
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !captionTrack) return;
        const setup = () => {
            for (let i = 0; i < video.textTracks.length; i++) {
                const tr = video.textTracks[i];
                if (tr.kind !== "subtitles") continue;
                tr.mode = "hidden";
                tr.oncuechange = () => {
                    const cue = tr.activeCues?.[0] as VTTCue | undefined;
                    setCaptionText(cue?.text ?? "");
                };
            }
        };
        setup();
        video.addEventListener("loadstart", setup);
        return () => video.removeEventListener("loadstart", setup);
    }, [captionTrack, scene.id]);

    // Reactive — re-points mounted <video> src when the user changes
    // the stream type in Settings (the old getTranscodeType() read was
    // non-reactive, so mounted slides kept the stale stream).
    const transcodeType = useTranscodeType();
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isActive, setIsActive] = useState(false);
    // isActive 的 ref 镜像：seekToTime / error 重连的恢复播放回调里
    // 读取，避免卡片已划走（IO 已 pause）后重连完成又自动播放造成
    // 声音泄漏；用 ref 避免 seekToTime 因依赖 isActive 频繁重建。
    const isActiveRef = useRef(false);
    isActiveRef.current = isActive;
    // scene.files 的 ref 镜像：handleToggleFullscreen（依赖数组为空，
    // 引用固定）读取实时分辨率做转码预热期的横竖判断回退。
    const sceneFilesRef = useRef(scene.files);
    sceneFilesRef.current = scene.files;
    const [isPlaying, setIsPlaying] = useState(false);
    const [muted, setMuted, setMutedSession] = useMuteState();
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [advancedRatingOpen, setAdvancedRatingOpen] = useState(false);
    const [moreOpen, setMoreOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [fullscreenUIVisible, setFullscreenUIVisible] = useState(true);
    const fullscreenUITimerRef = useRef<number | null>(null);
    // 视频内容测量是否完成（--binge-video-shift 已写入）。无文件场景
    // 的宽高要等 poster 异步测量，期间居中元素（暂停按钮组/转码转
    // 圈）保持隐藏（.binge-slide:not(.has-video-shift)），就绪后直接
    // 在最终位置淡入——否则会先出现在屏幕中心、再动画上移到画面
    // 中心。有元数据的场景在 useLayoutEffect（paint 前）即完成测量，
    // 首帧就带 class，无感知。
    const [shiftReady, setShiftReady] = useState(false);

    // 视频内容的上移定位由 CSS object-position 完成（.binge-video），
    // 本 effect 只把测得的 px 上移量写入容器 CSS 变量
    // --binge-video-shift，供需要跟随视频内容移动的元素（暂停时
    // 居中的播放/静音按钮组、转码加载指示）用 calc 消费。
    // useLayoutEffect：首帧 paint 前写入，按钮组从挂载起就在最终位置。
    // 宽高回退链（poster 阶段元数据未到时）：
    //   ① Stash 元数据 files[0].width/height
    //   ② poster 图自然尺寸——无文件场景（仅 Stash 添加记录）①永远
    //     缺失，poster 是唯一宽高来源；poster 本来就在加载（<video
    //     poster>），Image 兜底命中浏览器缓存，无额外网络请求。
    useLayoutEffect(() => {
        const video = videoRef.current;
        const container = containerRef.current;
        if (!video) return;
        const mf = scene.files?.[0];
        // poster 自然尺寸：优先取模块级记忆缓存（同会话滑回该场景时
        // 首帧直接就位）；否则等异步测量。局部变量随 effect 重跑重置，
        // 不跨场景串值。
        const cached = posterSizeCache.get(scene.id);
        let posterW = cached?.w ?? 0;
        let posterH = cached?.h ?? 0;
        let disposed = false;
        const update = () => {
            const { shift, rw } = measureVideoContent(
                video,
                !isFullscreen,
                mf?.width || posterW,
                mf?.height || posterH
            );
            // rw>0 = 测量有效（容器有布局 + 拿到宽高）。无效时不写
            // 变量、不置就绪（居中元素保持隐藏），等 ResizeObserver /
            // loadedmetadata / poster onload 重试。
            if (rw > 0) {
                container?.style.setProperty(
                    "--binge-video-shift",
                    `${shift}px`
                );
                setShiftReady(true);
            }
        };
        update();
        video.addEventListener("loadedmetadata", update);
        const ro = new ResizeObserver(update);
        ro.observe(video);
        if (!mf?.width || !mf?.height) {
            const img = new Image();
            img.onload = () => {
                // 尺寸记忆无条件写入：组件已滑走（disposed）的迟到
                // onload 也预热缓存，用户滑回该场景时受益。
                if (img.naturalWidth > 0) {
                    posterSizeCache.set(scene.id, {
                        w: img.naturalWidth,
                        h: img.naturalHeight,
                    });
                }
                if (disposed) return;
                posterW = img.naturalWidth;
                posterH = img.naturalHeight;
                update();
            };
            // poster 加载失败（网络异常等）：无尺寸可用，按屏幕中心
            // 处理（shift=0），至少让居中元素显示出来。
            img.onerror = () => {
                if (disposed) return;
                container?.style.setProperty("--binge-video-shift", "0px");
                setShiftReady(true);
            };
            img.src = scene.paths.screenshot;
            // 同步快路径：poster 已在内存缓存（如 <video poster> 已先
            // 行加载完）时，src 赋值后 complete 立即为 true——无需等
            // 异步 onload，直接测量并置就绪，首帧 paint 前完成（与
            // object-position 常量直达同等效果）。
            if (img.complete && img.naturalWidth > 0) {
                posterW = img.naturalWidth;
                posterH = img.naturalHeight;
                posterSizeCache.set(scene.id, {
                    w: posterW,
                    h: posterH,
                });
                update();
            }
        }
        return () => {
            disposed = true;
            video.removeEventListener("loadedmetadata", update);
            ro.disconnect();
            container?.style.removeProperty("--binge-video-shift");
        };
    }, [scene.id, scene.files, isFullscreen, scene.paths.screenshot]);

    // 字幕定位 + 字号：recompute whenever the video element resizes
    // (orientation change, fullscreen toggle, virtualizer re-measure)。
    // ResizeObserver covers all cases。复用 measureVideoContent 的测量，
    // bottom 计入视频上移量——字幕始终贴着视频内容底部（视频上移后
    // 跟随，不留在原黑边位置）。
    useEffect(() => {
        if (!captionTrack) return;
        const video = videoRef.current;
        const el = captionRef.current;
        if (!video || !el) return;
        // 与内容上移 effect 相同的元数据回退：字幕位置在 poster 阶段
        // 即可按最终内容区定位。
        const mf = scene.files?.[0];
        const update = () => {
            const { rw, rh, shift } = measureVideoContent(
                video,
                !isFullscreen,
                mf?.width ?? 0,
                mf?.height ?? 0
            );
            if (!rw) return;
            // Bottom offset = distance from element bottom to content
            // bottom (letterbox gap + 上移量) + 8px padding.
            el.style.bottom = `${Math.max(8, (video.clientHeight - rh) / 2 + 8 + shift)}px`;
            // Font size ~3% of rendered video width, clamped ≥10px.
            el.style.fontSize = `${Math.max(10, rw * 0.03)}px`;
        };
        update();
        video.addEventListener("loadedmetadata", update);
        const ro = new ResizeObserver(update);
        ro.observe(video);
        return () => {
            video.removeEventListener("loadedmetadata", update);
            ro.disconnect();
        };
    }, [captionTrack, scene.id, scene.files, isFullscreen]);

    // ── Touch gesture state: horizontal swipe seek + long-press 2× ──
    const touchStartRef = useRef<{ x: number; y: number; time: number; videoTime: number } | null>(null);
    const isSwipeRef = useRef(false);
    const longPressTimerRef = useRef<number | null>(null);
    const isLongPressRef = useRef(false);
    const [seekIndicator, setSeekIndicator] = useState<{ delta: number; current: number } | null>(null);
    const [showSpeedBadge, setShowSpeedBadge] = useState(false);

    // Like state. Optimistic value lives here AND in the parent Reel
    // (oCountOverride) so a remount after scroll-away inherits the
    // user's most recent like rather than the stale server value.
    const [oCount, setOCount] = useState<number>(
        oCountOverride ?? scene.o_counter ?? 0
    );
    const [oError, setOError] = useState(false);
    const [bursts, setBursts] = useState<Burst[]>([]);
    const oBusyRef = useRef(false);

    // Rating (0–100). Same lifted-override pattern as oCount — Reel
    // owns the canonical value across virtualizer mount/unmount.
    const [rating100, setRating100Local] = useState<number | null>(
        ratingOverride !== undefined ? ratingOverride : scene.rating100
    );
    useEffect(() => {
        if (ratingOverride !== undefined && ratingOverride !== rating100) {
            setRating100Local(ratingOverride);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ratingOverride]);

    // Per-collection membership map keyed by tagName. Derived from
    // (collectionsOverride ?? scene.tags + the resolved collection
    // tag-id map). The collection list itself is dynamic (the user
    // can create new ones via the SaveSheet) — we subscribe to the
    // collections module so a new collection's row appears here
    // unchecked the moment it's created.
    const [inCollections, setInCollections] = useState<
        Record<string, boolean>
    >(() => collectionsOverride ?? {});
    useEffect(() => {
        if (collectionsOverride) {
            setInCollections(collectionsOverride);
            return;
        }
        let alive = true;
        const resync = async () => {
            try {
                const [collections, tagIdMap] = await Promise.all([
                    getCollections(),
                    getCollectionTagIds(),
                ]);
                if (!alive) return;
                const result: Record<string, boolean> = {};
                for (const c of collections) {
                    const id = tagIdMap.get(c.tagName);
                    result[c.tagName] = id
                        ? scene.tags.some((t) => t.id === id)
                        : false;
                }
                setInCollections(result);
            } catch {
                /* leave previous map; user can retry */
            }
        };
        void resync();
        // Refresh when a new collection is created mid-session.
        const off = subscribeCollections(() => void resync());
        return () => {
            alive = false;
            off();
        };
    }, [collectionsOverride, scene.id, scene.tags]);

    // Multiview queue membership — read from the local cache, resynced on
    // every queue change (this tab, other tabs, AND other clients via the
    // config poll started by startMultiviewSync).
    const [inMVQueue, setInMVQueue] = useState<boolean>(() =>
        isInMultiviewQueue(scene.id)
    );
    useEffect(() => {
        startMultiviewSync();
        setInMVQueue(isInMultiviewQueue(scene.id));
        return subscribeMultiviewQueue(() =>
            setInMVQueue(isInMultiviewQueue(scene.id))
        );
    }, [scene.id]);

    // Mutation guards — ignore concurrent taps while a request is in flight.
    const ratingBusyRef = useRef(false);
    // Per-collection busy ref so concurrent taps on the same row are
    // ignored. Keyed by tagName.
    const collectionBusyRef = useRef<Record<string, boolean>>({});

    // Attempt playback at the user's mute preference, with the
    // autoplay-policy fallback. Centralised so the IO observer,
    // the tap handler, and the src-settle effect all behave the same.
    // muted 的 ref 镜像（同 seekOffsetRef 模式）：让 playPreferred 可以
    // 用 useCallback 固定引用（依赖 setMutedSession——useCallback 稳定
    // 引用），避免 seekToTime 因依赖不稳定的 playPreferred 每次渲染
    // 重建、连带 loadedmetadata 监听器反复解绑/重绑。撤销静音联动后
    // 各表面独立持有状态，播放偏好读本实例的 muted（而非全局持久值，
    // 否则图标与本实例状态脱节——图标显示开启、视频实际静音）。
    const mutedRef = useRef(muted);
    mutedRef.current = muted;
    const playPreferred = useCallback(
        (video: HTMLVideoElement) => {
            // 播放层栈：story 弹窗/演员详情/PH 播放器打开期间拒绝
            // 自动播放（正在播放的由下方 gate 订阅 effect 暂停）。
            if (isPlaybackGated(PLAYBACK_LAYER.base)) return;
            const pref = mutedRef.current;
            video.muted = pref;
            void video
                .play()
                .catch((err: unknown) => {
                    // A play() interrupted by pause()/load() (scroll-away,
                    // src swap) rejects with AbortError — NOT an autoplay
                    // block, so don't flip to muted or force a replay.
                    if ((err as DOMException | null)?.name === "AbortError") {
                        return;
                    }
                    video.muted = true;
                    if (!mutedRef.current) setMutedSession(true);
                    void video.play().catch(() => {});
                });
        },
        [setMutedSession]
    );

    // 覆盖层（story 弹窗/演员详情/PH 播放器）打开时暂停本卡片视
    // 频——任一时刻只有一层出声。关闭覆盖层不自动恢复，用户点击
    // 播放再出声（playPreferred 的 gate 检查覆盖所有自动播放路径）。
    useEffect(() => {
        return subscribePlaybackGate(() => {
            const video = videoRef.current;
            if (
                video &&
                isPlaybackGated(PLAYBACK_LAYER.base) &&
                !video.paused
            ) {
                video.pause();
            }
        });
    }, []);

    // Imperative <video src> management. We do this in a useEffect
    // instead of binding `src` as a React prop because:
    //   (1) we want to defer loading while the reel is mid-scroll —
    //       toggling the React `src` between a URL and undefined does
    //       NOT reliably trigger load() across browsers, so the second
    //       state where you'd expect "load now" silently stays blank.
    //   (2) we need an explicit `video.load()` call right after setting
    //       src to force the browser to actually start fetching.
    // 视频 poster 懒加载：useEffect 增加 !isActive 守卫，视频源只在
    // 卡片进入视口时才请求并加载。不在视口的卡片仅显示 poster 封面，
    // 离开视口时由 IntersectionObserver 触发 pause()。大幅减少不可见
    // 卡片的带宽与内存占用。
    //
    // 记录 base stream URL（不含 ?start=）到 ref，供 seekToTime 重建
    // 带 ?start=N 的转码 seek URL。
    const baseStreamUrlRef = useRef<string>("");
    // 已加载签名（"sceneId|transcodeType|随机设置"）与已赋值 src 的镜像：
    // 退出全屏的位置修正会引发 scroll/IO 抖动 → isActive 与
    // currentlyScrolling 反复变化 → 本 effect 重跑。重跑时绝不能重建
    // src——转码流会从 ?start=（A 点）重载、直连流从 0 重载，播放位置
    // 丢失。用签名区分"设置/场景真的变了"与"仅仅是抖动重跑"。
    // 注意不能用 video.src 做比较：DOM 属性读回的是解析后的绝对
    // URL，与相对 URL 永不相等。loadedUrlRef 记录我们自己赋的值。
    const loadedSigRef = useRef("");
    const loadedUrlRef = useRef("");
    const needsTranscodeSeek = !isWebCompatible(scene);
    // 转码硬 seek 偏移量：硬 seek 用 ?start=N 重建 src 后，新流的
    // currentTime 从 0 重新计起，进度条需知道偏移量才能显示真实位置。
    // 加载新基础流（换场景/重进视口）时重置为 0。
    const [seekOffset, setSeekOffset] = useState(0);
    // seekOffset 的 ref 镜像：onTimeUpdate 闭包里读取最新值，避免
    // setSeekOffset 触发重渲染前旧闭包拿过期偏移量误判 B 点。
    const seekOffsetRef = useRef(0);
    seekOffsetRef.current = seekOffset;
    // 转码流加载指示：转码冷启动 / 硬 seek 重建 / 断点重连 / 播放中
    // 数据不足期间，画面中央显示半透明弧形转圈告知"正在转码"。
    // 直连流本地缓冲快，不显示。
    const [transcodeLoading, setTranscodeLoading] = useState(false);
    // 本次加载的随机播放窗口（A→B）。null = 未计算（随机时段关闭，
    // 或 Stash 元数据缺失、等 loadedmetadata 用 video.duration 计算）。
    const randomWindowRef = useRef<{ start: number; end: number | null } | null>(
        null
    );
    // 随机设置的签名（"0" / "1:{秒数}"）：区分真实的设置变化与
    // isActive/currentlyScrolling 引起的 effect 重跑，避免滑动返回时
    // 重新随机一个正在加载的视频。
    const randomSigRef = useRef("");
    // 用户已手动 seek（进度条点击/手势滑动）标记：本场景的随机时段
    // 已被取消。阻止 loadedmetadata 回退路径在转码硬 seek 重载后
    // 把已清除的窗口重新计算回来。新设置周期（reroll）时重置。
    const userSeekedRef = useRef(false);
    // B 点已触发自动切换的一次性守卫：timeupdate 每 ~250ms 一次，
    // scrollToIndex 平滑滚动完成前可能重复触发 onAutoAdvance。
    const randomAdvancedRef = useRef(false);
    // 上一次硬 seek 注册的事件监听清理函数。新一轮 seek 前先清理上一轮，
    // 避免快速连续 seek 时监听器堆积；卸载时也调用。
    const seekCleanupRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        if (currentlyScrolling) return;
        // 仅视口内（active）卡片加载视频源。
        if (!isActive) return;
        // 抖动重跑（isActive/currentlyScrolling 变化，场景与设置未变）：
        // 视频源已加载，直接返回。IO / 退出全屏的恢复逻辑自己负责
        // pause→play 对称恢复，这里重建 src 只会丢播放位置。
        const sig = randomStart ? `1:${randomSeconds}` : "0";
        const loadedSig = `${scene.id}|${transcodeType}|${sig}`;
        if (loadedSigRef.current === loadedSig) {
            return;
        }
        loadedSigRef.current = loadedSig;
        // 随机时段：签名变化（开关/秒数提交）才算新的加载周期；
        // isActive 抖动等重跑沿用已计算的窗口，不重新随机。
        const reroll = randomSigRef.current !== sig;
        randomSigRef.current = sig;
        let win = randomWindowRef.current;
        if (reroll) {
            win = null;
            randomAdvancedRef.current = false;
            // 新的设置周期：用户手动 seek 的取消标记随之复位。
            userSeekedRef.current = false;
            if (randomStart) {
                const d = stashDuration;
                if (d !== null && Number.isFinite(d) && d > 0) {
                    win = computeRandomWindow(d, randomSeconds);
                }
                // Stash 时长缺失时留 null，由 loadedmetadata 监听用
                // video.duration 计算后补一次 seek。
            }
            randomWindowRef.current = win;
        }
        let url = pickStreamUrl(scene, transcodeType);
        let initialOffset = 0;
        // 转码流直接用 ?start= 预置随机起点，避免"先从头转码再硬
        // seek"的双重等待；直连流在 loadedmetadata 后原生 seek。
        if (win && needsTranscodeSeek && win.start > 0.5) {
            url = buildTranscodeSeekUrl(url, win.start);
            initialOffset = win.start;
        }
        baseStreamUrlRef.current = url;
        if (loadedUrlRef.current !== url) {
            loadedUrlRef.current = url;
            video.src = url;
            video.load();
            randomAdvancedRef.current = false;
            // 新基础流：从 0 开始或已预置起点，同步转码 seek 偏移量。
            setSeekOffset(initialOffset);
        } else {
            setSeekOffset(initialOffset);
            // URL 未变：设置变化发生在已加载的直连流上 → 原地重掷
            // 起点位置（转码流的 ?start= 变化会走上面的重载分支）。
            if (
                reroll &&
                win &&
                !needsTranscodeSeek &&
                video.readyState >= 1 &&
                win.start > 0.5
            ) {
                try {
                    video.currentTime = win.start;
                } catch {
                    /* 尚不可 seek，忽略 */
                }
            }
        }
        // Kick playback for the active slide once src is settled. If
        // the IO fired play() mid-scroll (before src was assigned) it
        // rejected and won't re-fire, so the slide would otherwise sit
        // frozen on its poster. Guarded by paused (don't double-play);
        // isActive 已在上方守卫，无需重复判断。
        if (video.paused) {
            playPreferred(video);
        }
    }, [currentlyScrolling, scene.id, isActive, transcodeType, needsTranscodeSeek, randomStart, randomSeconds, stashDuration]);

    // 转码流（avi/wmv/mkv/...）的 seek 处理。
    // 原生 <video>.currentTime = N 依赖 HTTP Range 请求，而 Stash 的 live
    // MP4 transcode 不稳定支持 Range → 快进会从头播放。改为"硬 seek"：
    // 用 ?start={秒} 参数重建 src，触发 ffmpeg 从该时间点重新转码。
    // web 兼容容器（mp4/webm/...）走直连流，原生 seek 正常，无需此路径。
    const seekToTime = useCallback(
        (time: number, opts?: { keepPaused?: boolean }) => {
            const video = videoRef.current;
            if (!video) return;
            if (!needsTranscodeSeek) {
                // 原生 seek：直接设 currentTime
                video.currentTime = time;
                return;
            }
            // 转码硬 seek：重建 src 带 ?start=N
            const baseUrl = baseStreamUrlRef.current;
            if (!baseUrl) {
                return;
            }
            const seekUrl = buildTranscodeSeekUrl(baseUrl, time);
            // 记录偏移量：新流 currentTime 从 0 计起，进度条需加偏移量。
            setSeekOffset(time);
            // 同步已赋值 src 镜像（video.src 读回的是绝对 URL，不能
            // 用于比较），供 src effect 的重载判断使用。
            loadedUrlRef.current = seekUrl;
            // 先清理上一轮 seek 注册的监听器，避免快速连续 seek 时堆积。
            seekCleanupRef.current?.();
            // 先暂停当前播放，避免 seek 期间继续解码旧流
            video.pause();
            video.src = seekUrl;
            video.load();
            // error 断点重连（keepPaused）：保持用户暂停时的状态，
            // 只重建连接不恢复播放。
            if (opts?.keepPaused) return;
            // 自动恢复播放（数据就绪后）。两个关键门槛：
            // 1. readyState ≥ 3（HAVE_FUTURE_DATA）才 play——低功耗设备
            //    上 wmv/mpeg4 视频解码远慢于音频，数据不足时强行 play
            //    会让音频先出声（音画不同步）。宁可等转码出数据（与
            //    Stash 播放器一致的"等转码"体验）。
            // 2. 300ms 周期重试兜底 canplay 触发过早时 play() 以
            //    AbortError 失败、再无事件可等的情况（wmv 尤其明显）。
            // playing 事件确认播放成功后（cleanup）重试自动停止。
            let done = false;
            let retryTimer: number | null = null;
            const cleanup = () => {
                if (done) return;
                done = true;
                video.removeEventListener("canplay", onReady);
                video.removeEventListener("playing", onPlaying);
                if (retryTimer !== null) {
                    window.clearTimeout(retryTimer);
                    retryTimer = null;
                }
                seekCleanupRef.current = null;
            };
            const onPlaying = () => {
                cleanup();
            };
            const onReady = () => {
                if (done || !video.paused || !isActiveRef.current) return;
                if (video.readyState < 3) return;
                playPreferred(video);
            };
            // 周期重试：canplay 触发过早时 play() 以 AbortError 失败，
            // playPreferred 内部不会重试 AbortError。这里每 300ms 检查
            // 一次（同样受 readyState ≥ 3 门槛约束），给转码流"追上"的时间。
            const retryPlay = () => {
                if (done || !video.paused || !isActiveRef.current) return;
                if (video.readyState >= 3) playPreferred(video);
                retryTimer = window.setTimeout(retryPlay, 300);
            };
            seekCleanupRef.current = cleanup;
            video.addEventListener("canplay", onReady);
            video.addEventListener("playing", onPlaying);
            // 首次延迟 300ms 启动周期重试（让 canplay 先有机会触发）
            retryTimer = window.setTimeout(retryPlay, 300);
            // 安全兜底：30 秒后若仍未播放，移除监听器避免泄漏（低功耗
            // 设备转码冷启动可达 ~15s，8s 会过早放弃；卸载时
            // seekCleanupRef 亦会清理）。
            window.setTimeout(cleanup, 30000);
        },
        [needsTranscodeSeek, playPreferred]
    );

    // 加载失败处理：
    // - 转码流（live transcode）：播放/暂停期间连接可能被服务端断开
    //   （反代读超时、转码跟不上播放、ffmpeg 崩溃）→ video 触发
    //   error。此时记录断点绝对位置，1s 后用 ?start=断点 重建连接
    //   无缝续播（暂停中则保持暂停）。若不处理，视频会黑屏卡死，
    //   且下一次 src effect 重跑（全屏退出的位置校正抖动等）会从
    //   随机 A 点重载、B 点循环复活——正是"播放一段时间后全屏退出
    //   从 A 点重播"的根因。
    // - 直连流：清空签名，让下一次 effect 重跑重新加载。
    // 连续快速失败 3 次后放弃（源文件损坏等确定性错误），稳定播放
    // 5s 后计数归零。
    const transcodeRetryRef = useRef(0);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        let retryTimer: number | null = null;
        let stableTimer: number | null = null;
        let hiddenAt = 0;
        const clearTimers = () => {
            if (retryTimer !== null) {
                window.clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (stableTimer !== null) {
                window.clearTimeout(stableTimer);
                stableTimer = null;
            }
        };
        const onError = () => {
            // 空源（卸载清理 / 尚未加载）触发的 error 不处理。
            if (!video.currentSrc) return;
            if (!needsTranscodeSeek) {
                loadedSigRef.current = "";
                loadedUrlRef.current = "";
                return;
            }
            if (transcodeRetryRef.current >= 3) return;
            const t = video.currentTime;
            if (!Number.isFinite(t)) return;
            const wasPaused = video.paused;
            const absPos = t + seekOffsetRef.current;
            transcodeRetryRef.current++;
            clearTimers();
            // 退避 1s：给服务端清理旧 ffmpeg 进程的时间。
            retryTimer = window.setTimeout(() => {
                retryTimer = null;
                const v = videoRef.current;
                if (!v || !v.isConnected) return;
                seekToTime(Math.max(0, absPos), {
                    keepPaused: wasPaused,
                });
            }, 1000);
        };
        const onPlaying = () => {
            // 稳定播放 5s 才归零重连计数：快速失败循环会累加到上限
            // 停止重连，偶发瞬断则不影响后续重连能力。
            if (stableTimer !== null) window.clearTimeout(stableTimer);
            stableTimer = window.setTimeout(() => {
                stableTimer = null;
                transcodeRetryRef.current = 0;
            }, 5000);
        };
        // 锁屏/切后台（>20s）后转码连接大概率已被服务端杀掉。回到
        // 前台时不赌旧连接：立即从断点重建转码流（丢弃已失效缓冲），
        // 让 ffmpeg 尽早启动——总等待时间不会比"播完缓冲再冷启动"更
        // 长，且不会出现播到一半卡死再重启的割裂体验。
        // - 暂停中（锁屏场景）：keepPaused 重建预热转码；用户点播放
        //   时数据就绪则立即出画面，未就绪则由浏览器等数据到达后再
        //   开始（与 Stash 播放器一致的"等转码"体验）。
        // - 播放中（切应用场景，切回时处于冻结的播放态）：重建后由
        //   seekToTime 的重试循环在数据就绪（readyState ≥ 3）时自动
        //   恢复播放——就绪门槛保证了不会音画不同步。
        const onVisibility = () => {
            if (document.visibilityState === "hidden") {
                hiddenAt = Date.now();
                return;
            }
            const wasLongHidden =
                !!hiddenAt && Date.now() - hiddenAt >= 20000;
            hiddenAt = 0;
            if (!wasLongHidden || !needsTranscodeSeek) return;
            if (!video.currentSrc || video.ended) return;
            const absPos = video.currentTime + seekOffsetRef.current;
            if (!Number.isFinite(absPos)) return;
            clearTimers();
            seekToTime(Math.max(0, absPos), { keepPaused: video.paused });
        };
        video.addEventListener("error", onError);
        video.addEventListener("playing", onPlaying);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            video.removeEventListener("error", onError);
            video.removeEventListener("playing", onPlaying);
            document.removeEventListener("visibilitychange", onVisibility);
            clearTimers();
        };
    }, [needsTranscodeSeek, seekToTime]);

    // 随机时段：元数据就绪后应用随机起点。
    //   - 直连流：原生 currentTime = A。
    //   - 转码流：src 已用 ?start= 预置起点（seekOffset 已同步为 A）
    //     时无需再 seek；仅在回退路径（设置 src 时 Stash 时长未知、
    //     窗口此刻才算出）补一次 seekToTime 硬 seek。
    // 窗口已存在时的重载（B 点循环 / error 断点重连），seekOffset 反映
    // 当前意图位置（B 循环 = A，error 重连 = 断点），不得拉回 A 点。
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !randomStart) return;
        const onMeta = () => {
            let win = randomWindowRef.current;
            if (!win) {
                // 用户手动 seek 过（转码硬 seek 重载也会触发本事件）：
                // 随机时段已取消，不重新计算窗口。
                if (userSeekedRef.current) return;
                const d = video.duration;
                if (!Number.isFinite(d) || d <= 0) return;
                win = computeRandomWindow(d, randomSeconds);
                // 先进入全屏、元数据后到才算出窗口：循环时长同样立即
                // 中断（与 fullscreenchange 路径行为一致）。
                if (document.fullscreenElement === containerRef.current) {
                    win = { ...win, end: null };
                }
                randomWindowRef.current = win;
            } else {
                // 窗口已存在：
                // - 转码流：初始加载 ?start= 已预置（seekOffset 与 A 一
                //   致），B 循环 / error 重连时 seekOffset 是当前意图
                //   位置——都不需要再 seek。
                // - 直连流：初始 src 无 ?start= 预置，必须在此原生
                //   seek 到 A（stashDuration 先于元数据到达时窗口已
                //   存在，不走上面的计算分支）。B 循环/手势 seek 用
                //   currentTime 不重触发本事件；src 重载（error 后
                //   effect 重建）后回到 A 是既有行为。
                if (needsTranscodeSeek) return;
                if (win.start > 0.5) {
                    try {
                        video.currentTime = win.start;
                    } catch {
                        /* 尚不可 seek，忽略 */
                    }
                }
                return;
            }
            if (win.start <= 0.5) return;
            if (needsTranscodeSeek) {
                if (Math.abs(seekOffsetRef.current - win.start) > 0.5) {
                    seekToTime(win.start);
                }
            } else {
                try {
                    video.currentTime = win.start;
                } catch {
                    /* 尚不可 seek，忽略 */
                }
            }
        };
        video.addEventListener("loadedmetadata", onMeta);
        return () => video.removeEventListener("loadedmetadata", onMeta);
    }, [randomStart, randomSeconds, scene.id, needsTranscodeSeek, seekToTime]);

    // Explicit decoder cleanup on unmount. The browser doesn't release
    // hardware decoder slots aggressively — they linger until GC. Calling
    // pause + removeAttribute("src") + load() forces release.
    // Empty deps: runs once on mount, cleanup fires on unmount only.
    useEffect(() => {
        const video = videoRef.current;
        return () => {
            // 清理可能残留的转码 seek 事件监听器。
            seekCleanupRef.current?.();
            seekCleanupRef.current = null;
            if (!video) return;
            try {
                video.pause();
                video.removeAttribute("src");
                video.load();
            } catch {
                /* element may already be detached; ignore */
            }
        };
    }, []);

    // If the parent's override changes (e.g. another slide of the same
    // scene id mutated it — currently impossible but cheap defense), keep
    // local state in sync.
    useEffect(() => {
        if (oCountOverride !== undefined && oCountOverride !== oCount) {
            setOCount(oCountOverride);
        }
        // We deliberately don't depend on oCount — that would clobber
        // an in-flight optimistic update.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [oCountOverride]);

    // Stable ref to onOCountChange so we can call it from mutation handlers
    // without re-wiring callbacks on every parent re-render.
    const onOCountChangeRef = useRef(onOCountChange);
    useEffect(() => {
        onOCountChangeRef.current = onOCountChange;
    });
    const reportOCount = (next: number) => {
        onOCountChangeRef.current?.(scene.id, next);
    };

    const triggerLike = () => {
        // Visual burst is always immediate and independent of the mutation.
        const burstId = Date.now() + Math.floor(Math.random() * 1000);
        setBursts((prev) => [...prev, { id: burstId }]);
        window.setTimeout(() => {
            setBursts((prev) => prev.filter((b) => b.id !== burstId));
        }, BURST_LIFETIME_MS);

        if (oBusyRef.current) return;
        oBusyRef.current = true;
        setOError(false);
        // Optimistically record the scene's tags into the recency ring
        // even before the mutation succeeds — the like-burst already
        // gives the user a "you did the thing" signal and the ring is
        // cheap localStorage; rolling back on failure is fine but
        // overkill.
        recordTagInteractions(scene.tags);
        const previous = oCount;
        const optimistic = previous + 1;
        setOCount(optimistic);
        reportOCount(optimistic);
        sceneIncrementO(scene.id)
            .then((next) => {
                setOCount(next);
                reportOCount(next);
            })
            .catch((err) => {
                console.error("[binge] sceneIncrementO failed", err);
                setOCount(previous);
                reportOCount(previous);
                setOError(true);
                window.setTimeout(() => setOError(false), 1500);
            })
            .finally(() => {
                oBusyRef.current = false;
            });
    };

    const triggerUnlike = () => {
        if (oCount <= 0) return; // nothing to remove
        if (oBusyRef.current) return;
        oBusyRef.current = true;
        setOError(false);
        const previous = oCount;
        const optimistic = previous - 1;
        setOCount(optimistic);
        reportOCount(optimistic);
        sceneDecrementO(scene.id)
            .then((next) => {
                setOCount(next);
                reportOCount(next);
            })
            .catch((err) => {
                console.error("[binge] sceneDecrementO failed", err);
                setOCount(previous);
                reportOCount(previous);
                setOError(true);
                window.setTimeout(() => setOError(false), 1500);
            })
            .finally(() => {
                oBusyRef.current = false;
            });
    };

    // ── Rate ──────────────────────────────────────────────────────
    const handleSetRating = (stars: number | null) => {
        if (ratingBusyRef.current) return;
        ratingBusyRef.current = true;
        const previous = rating100;
        const next = stars === null ? null : stars * 20;
        setRating100Local(next);
        onRatingChange?.(scene.id, next);
        setSceneRating(scene.id, next)
            .then((confirmed) => {
                setRating100Local(confirmed);
                onRatingChange?.(scene.id, confirmed);
            })
            .catch(() => {
                setRating100Local(previous);
                onRatingChange?.(scene.id, previous);
            })
            .finally(() => {
                ratingBusyRef.current = false;
            });
    };

    // ── Save / collection toggle ─────────────────────────────────
    const handleToggleCollection = (tagName: string) => {
        if (collectionBusyRef.current[tagName]) return;
        collectionBusyRef.current[tagName] = true;
        const currently = inCollections[tagName] ?? false;
        const next = !currently;
        setInCollections((prev) => ({ ...prev, [tagName]: next }));
        onCollectionChange?.(scene.id, tagName, next);
        // Saving signals strong intent — feed it into the recency ring
        // so the user's favourite-collection tag preferences surface on
        // Explore as chip shortcuts. Only on saves (not removes) so
        // un-bookmarking doesn't pollute taste data.
        if (next) recordTagInteractions(scene.tags);
        setSceneInCollection(
            scene.id,
            scene.tags.map((t) => t.id),
            tagName,
            next
        )
            .then((confirmed) => {
                setInCollections((prev) => ({
                    ...prev,
                    [tagName]: confirmed,
                }));
                onCollectionChange?.(scene.id, tagName, confirmed);
            })
            .catch(() => {
                // Roll back on failure.
                setInCollections((prev) => ({
                    ...prev,
                    [tagName]: currently,
                }));
                onCollectionChange?.(scene.id, tagName, currently);
            })
            .finally(() => {
                collectionBusyRef.current[tagName] = false;
            });
    };

    // ── Multiview ────────────────────────────────────────────────
    const handleToggleMultiview = () => {
        const next = toggleMultiviewQueueScene(scene.id);
        setInMVQueue(next);
    };
    const handleOpenMultiview = () => {
        openMultiviewPlayer();
    };

    // ── Scribe ───────────────────────────────────────────────────
    // Opens binge's inline Scribe modal — same plugin backend
    // (runPluginOperation → stashScribe.py → Ollama), same storage
    // format (custom_fields.stashScribe_review + Advanced-Rating tag
    // scores), so reviews authored here roundtrip with stash-scribe.
    const scribeModal = useScribeModal();
    const handleOpenScribe = () => {
        scribeModal.openScene(scene.id);
    };

    // Single-vs-double-tap discriminator. First tap arms a 280ms timer; a
    // second tap inside that window cancels the timer and triggers the
    // like. If no second tap arrives, the timer fires and we toggle
    // play/pause.
    const tapTimerRef = useRef<number | null>(null);
    useEffect(() => {
        return () => {
            if (tapTimerRef.current !== null) {
                window.clearTimeout(tapTimerRef.current);
            }
            if (longPressTimerRef.current !== null) {
                window.clearTimeout(longPressTimerRef.current);
            }
        };
    }, []);

    // Reflect muted state onto the underlying element. We cannot rely on
    // React's `muted` attribute alone — it doesn't always update post-mount.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = muted;
    }, [muted]);

    // Stable ref to onActive so the IO effect below doesn't tear down +
    // rebuild every time the parent re-creates its callback.
    const onActiveRef = useRef(onActive);
    useEffect(() => {
        onActiveRef.current = onActive;
    });

    useEffect(() => {
        const container = containerRef.current;
        const video = videoRef.current;
        if (!container || !video) return;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    // 阈值 0.7：略严于 0.6，避免最后一部视频滑到边界时
                    // 上一部仍 ≥0.6 触发双 active（同时播放两部声音）
                    const active = entry.intersectionRatio >= 0.7;
                    setIsActive(active);
                    if (active) {
                        onActiveRef.current?.(scene.id);
                        // Reset to the user's persisted preference on each
                        // activation. If a prior slide had to fall back to
                        // muted, this gives us a fresh attempt to play
                        // unmuted — and once it succeeds (user gesture is
                        // typically available by slide #2), we sync the
                        // effective state back to that success.
                        playPreferred(video);
                    } else {
                        video.pause();
                    }
                }
            },
            { threshold: [0, 0.7, 1] }
        );

        observer.observe(container);
        return () => observer.disconnect();
    }, [scene.id]);

    // Track playing state for the tap indicator + accessibility
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        return () => {
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
        };
    }, []);

    const togglePlayPause = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            // Tap IS a gesture, so we can confidently try the user's
            // preference here even if a prior autoplay failed.
            playPreferred(video);
        } else {
            video.pause();
        }
    };

    // ── Fullscreen toggle ──────────────────────────────────────────
    const showFullscreenUI = useCallback(() => {
        setFullscreenUIVisible(true);
        if (fullscreenUITimerRef.current !== null) {
            window.clearTimeout(fullscreenUITimerRef.current);
        }
        fullscreenUITimerRef.current = window.setTimeout(() => {
            setFullscreenUIVisible(false);
        }, 3000);
    }, []);

    const handleToggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const fsEl = document.fullscreenElement;
        const isMine = fsEl === el;
        if (!isMine) {
            const reel = el.closest(".binge-reel") as HTMLElement | null;
            if (reel) {
                reel.style.height = `${reel.clientHeight}px`;
            }
            void el.requestFullscreen?.().then(() => {
                // 横屏视频 → 锁定横屏方向（Android only，iOS 静默失败）。
                // 转码预热期元数据未到（videoWidth=0）时回退 Stash 元数据
                // 里的分辨率，避免横版视频首次全屏被当竖版处理（播放后
                // 元数据到达、再次全屏才正确翻转）。
                const video = videoRef.current;
                const mf = sceneFilesRef.current?.[0];
                const vw = video
                    ? video.videoWidth || mf?.width || 0
                    : 0;
                const vh = video
                    ? video.videoHeight || mf?.height || 0
                    : 0;
                if (video && vw > vh) {
                    const orient = screen.orientation;
                    if (orient && typeof orient.lock === "function") {
                        orient.lock("landscape").catch(() => {});
                    }
                }
            }).catch(() => {
                if (reel) reel.style.height = "";
            });
        } else {
            void document.exitFullscreen?.().then(() => {
                const orient = screen.orientation;
                if (orient && typeof orient.unlock === "function") {
                    orient.unlock();
                }
            }).catch(() => {});
        }
    }, []);

    useEffect(() => {
        const onChange = () => {
            // 关键修复：判断全屏元素是否是当前卡片，而不是全局
            // document.fullscreenElement。虚拟列表中多个 SceneSlide 实例
            // 都监听 fullscreenchange，若不区分归属，任一卡片进入全屏
            // 会让所有渲染中的卡片 isFullscreen=true，导致：
            //   1. 非全屏卡片也应用全屏样式
            //   2. 在其他卡片上点全屏时 document.fullscreenElement 已存在
            //      → 调用 exitFullscreen → "闪一下退出" → resize → 视频重载
            const fsEl = document.fullscreenElement;
            const isMine = fsEl === containerRef.current;
            // 进入全屏：立即中断本场景的"循环时长"计时——把 B 点置
            // null（保留随机起点；转码流 URL 含 ?start= 不变、视频不
            // 重载）。此后无论全屏中还是退出后都持续播放到影片结
            // 尾，再按"输入框空"的语义收尾：自动滚动开则切换下一
            // 部，关则回随机起点循环。这样全屏期间看过了 B 点、退
            // 出时不会立刻跳下一部。
            if (isMine) {
                const win = randomWindowRef.current;
                if (win && win.end !== null) {
                    randomWindowRef.current = { ...win, end: null };
                }
            }
            setIsFullscreen(isMine);
            if (isMine) {
                showFullscreenUI();
            } else if (!fsEl) {
                // 完全退出全屏（无任何元素全屏）：清理 UI 定时器。
                // 仅在真正退出全屏时触发，避免其他卡片进入全屏时
                // 误触 resize 导致 Reel 重算、视频重载。
                if (fullscreenUITimerRef.current !== null) {
                    window.clearTimeout(fullscreenUITimerRef.current);
                    fullscreenUITimerRef.current = null;
                }
                setFullscreenUIVisible(true);
            }
        };
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, [showFullscreenUI, scene.id]);

    // Mouse move in fullscreen → show UI
    useEffect(() => {
        if (!isFullscreen) return;
        const onMove = () => showFullscreenUI();
        const el = containerRef.current;
        if (el) el.addEventListener("mousemove", onMove);
        return () => {
            if (el) el.removeEventListener("mousemove", onMove);
        };
    }, [isFullscreen, showFullscreenUI]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (fullscreenUITimerRef.current !== null) {
                window.clearTimeout(fullscreenUITimerRef.current);
            }
        };
    }, []);

    // ── Touch: swipe seek + long-press 2× ──────────────────────────
    // touch-action: pan-y on the tap target lets the browser handle
    // vertical scroll (Reel slide navigation) while delivering
    // horizontal swipes to us.
    const TOUCH_SWIPE_THRESHOLD = 12; // px before deciding horizontal vs vertical
    const SEEK_PX_TO_SEC = 0.6; // each pixel = 0.6 seconds of seek
    const LONG_PRESS_MS = 500;

    const handleTouchStart: React.TouchEventHandler = (e) => {
        if (e.touches.length !== 1) return;
        const video = videoRef.current;
        const touch = e.touches[0];
        touchStartRef.current = {
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now(),
            // 手势 seek 的基准必须是影片绝对时间（与进度条点击一致）。
            // 转码流的 currentTime 是相对时间（从 ?start= 计起），
            // 需加 seekOffset 还原，否则快进从 0s 附近重新计起。
            videoTime:
                (video?.currentTime ?? 0) +
                (needsTranscodeSeek ? seekOffsetRef.current : 0),
        };
        isSwipeRef.current = false;
        isLongPressRef.current = false;
        // Start long-press timer
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
        }
        longPressTimerRef.current = window.setTimeout(() => {
            if (!isSwipeRef.current && touchStartRef.current) {
                isLongPressRef.current = true;
                if (video) video.playbackRate = 2;
                setShowSpeedBadge(true);
            }
        }, LONG_PRESS_MS);
    };

    const handleTouchMove: React.TouchEventHandler = (e) => {
        if (!touchStartRef.current || e.touches.length !== 1) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchStartRef.current.x;
        const dy = touch.clientY - touchStartRef.current.y;
        if (!isSwipeRef.current) {
            if (Math.abs(dx) < TOUCH_SWIPE_THRESHOLD && Math.abs(dy) < TOUCH_SWIPE_THRESHOLD) {
                return; // not enough movement yet
            }
            // Decide direction once
            if (Math.abs(dx) > Math.abs(dy)) {
                isSwipeRef.current = true;
                // Cancel long-press
                if (longPressTimerRef.current !== null) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
            } else {
                // Vertical — let browser handle scroll, cancel long-press
                if (longPressTimerRef.current !== null) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
                touchStartRef.current = null;
                return;
            }
        }
        // Horizontal swipe: seek
        // 注意：不能在这里 preventDefault——React 将 touchmove 注册为
        // passive 监听，调用无效且每次横滑都报
        // "Unable to preventDefault inside passive event listener"。
        // 横滑在 Reel 里没有需要阻止的浏览器默认行为（无横向滚动
        // 容器），手势本身由 pointer 坐标差驱动，无需阻止默认。
        const video = videoRef.current;
        if (!video) return;
        const deltaSec = dx * SEEK_PX_TO_SEC;
        // clamp 用绝对时长：优先 Stash 元数据；转码流的 video.duration
        // 是相对值（若有效需加偏移还原）。
        const duration =
            stashDuration && stashDuration > 0
                ? stashDuration
                : video.duration > 0
                  ? video.duration +
                    (needsTranscodeSeek ? seekOffsetRef.current : 0)
                  : 0;
        let target = touchStartRef.current.videoTime + deltaSec;
        if (target < 0) target = 0;
        if (duration > 0 && target > duration) target = duration;
        setSeekIndicator({ delta: deltaSec, current: target });
    };

    const handleTouchEnd: React.TouchEventHandler = (e) => {
        // Cancel long-press timer
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        // Restore 2× speed
        if (isLongPressRef.current) {
            const video = videoRef.current;
            if (video) video.playbackRate = 1;
            setShowSpeedBadge(false);
            isLongPressRef.current = false;
            // Prevent click from firing (don't toggle play/pause)
            e.preventDefault();
            e.stopPropagation();
            touchStartRef.current = null;
            return;
        }
        // If horizontal swipe: perform the seek and prevent click
        if (isSwipeRef.current && touchStartRef.current) {
            const video = videoRef.current;
            if (video) {
                const dx = (e.changedTouches[0]?.clientX ?? touchStartRef.current.x) - touchStartRef.current.x;
                const deltaSec = dx * SEEK_PX_TO_SEC;
                // 与 handleTouchMove 相同的绝对时长 clamp。
                const duration =
                    stashDuration && stashDuration > 0
                        ? stashDuration
                        : video.duration > 0
                          ? video.duration +
                            (needsTranscodeSeek ? seekOffsetRef.current : 0)
                          : 0;
                let target = touchStartRef.current.videoTime + deltaSec;
                if (target < 0) target = 0;
                if (duration > 0 && target > duration) target = duration;
                // 用户手势 seek 与进度条点击同理：取消本场景随机时段，
                // 之后播放到影片结束。
                randomWindowRef.current = null;
                userSeekedRef.current = true;
                seekToTime(target);
            }
            setSeekIndicator(null);
            isSwipeRef.current = false;
            // Prevent click from firing
            e.preventDefault();
            e.stopPropagation();
            touchStartRef.current = null;
            return;
        }
        // Simple tap — let click event fire normally for handleTap
        touchStartRef.current = null;
    };

    const handleTap = () => {
        // In fullscreen, first tap shows UI; if UI already visible, toggle play/pause
        if (isFullscreen && !fullscreenUIVisible) {
            showFullscreenUI();
            return;
        }
        if (isFullscreen) showFullscreenUI();
        if (tapTimerRef.current !== null) {
            // Second tap inside the window → double-tap like.
            window.clearTimeout(tapTimerRef.current);
            tapTimerRef.current = null;
            triggerLike();
            return;
        }
        tapTimerRef.current = window.setTimeout(() => {
            tapTimerRef.current = null;
            togglePlayPause();
        }, DOUBLE_TAP_WINDOW_MS);
    };

    // Title is recomputed on every render today; memoise so scrubbing
    // through neighbouring slides doesn't re-join the performer name
    // list 60 times per second.
    const displayTitle = useMemo(
        () =>
            scene.title ||
            scene.performers.map((p) => p.name).join(", ") ||
            t("scene.scene_id", { id: scene.id }),
        // t 必须在依赖里：语言切换时 t 引用变化触发重算，无标题场景
        // 的占位文案才能跟随切换语言。
        [scene.id, scene.title, scene.performers, t]
    );
    const detailsLine = scene.details?.trim() || "";

    return (
        <article
            ref={containerRef}
            className={
                "binge-slide" +
                (isFullscreen ? " is-fullscreen" : "") +
                (isFullscreen && !fullscreenUIVisible ? " fs-ui-hidden" : "") +
                (shiftReady ? " has-video-shift" : "")
            }
            data-scene-id={scene.id}
            data-active={isActive ? "true" : "false"}
        >
            <video
                ref={videoRef}
                className="binge-video"
                /* src managed imperatively in a useEffect above — toggling
                   via React prop doesn't reliably re-trigger load(). */
                poster={scene.paths.screenshot}
                preload={preload}
                playsInline
                /* When auto-scroll is enabled we disable loop so `ended`
                   actually fires; otherwise videos loop forever like
                   Instagram Reels and the user advances manually.
                   随机时段同样需要 loop=false：ended 是"播放到影片结
                   束"时回 A 点（A→B 循环）或自动切换的触发点。 */
                loop={!autoScroll && !randomStart}
                muted={muted}
                /* 转码流加载指示的事件驱动：
                   - loadstart：src（重）载入（初始加载 / 硬 seek 重建 /
                     断点重连）→ 按流类型置位，直连流恒 false（顺带
                     复位残留状态）；
                   - waiting：播放中数据不足（转码跟不上播放）→ 点亮；
                   - canplay / playing：数据就绪、真正出画面 → 熄灭；
                   - error：连接断开 → 先熄灭；重连逻辑 1s 后重建 src
                     会再次触发 loadstart 点亮（重连耗尽则不再常驻
                     误导用户）。 */
                onLoadStart={() => setTranscodeLoading(needsTranscodeSeek)}
                onWaiting={() => {
                    if (needsTranscodeSeek) setTranscodeLoading(true);
                }}
                onCanPlay={() => setTranscodeLoading(false)}
                onPlaying={() => setTranscodeLoading(false)}
                onError={() => setTranscodeLoading(false)}
                onTimeUpdate={() => {
                    // 随机时段：到达明确 B 点（输入了秒数）时按模式
                    // 处理——自动滚动切换下一场景，否则回 A 点循环。
                    // 输入框为空（end=null）的结尾处理走 ended 事件。
                    if (!randomStart) return;
                    const video = videoRef.current;
                    const win = randomWindowRef.current;
                    if (!video || !win || win.end === null) return;
                    const abs = needsTranscodeSeek
                        ? video.currentTime + seekOffsetRef.current
                        : video.currentTime;
                    if (abs < win.end - 0.3) return;
                    if (autoScroll) {
                        if (isActive && !randomAdvancedRef.current) {
                            randomAdvancedRef.current = true;
                            onAutoAdvance?.();
                        }
                    } else {
                        // A→B 循环：回到随机起点。转码流由 seekToTime
                        // 硬 seek 重建 src，直连流原生 seek 瞬时完成。
                        seekToTime(win.start);
                    }
                }}
                onEnded={() => {
                    // 随机时段 + 播到影片结尾（输入框空）：结束后
                    // A→B 循环或自动切换，与 timeupdate 的显式 B 点
                    // 逻辑保持一致。
                    if (randomStart && randomWindowRef.current) {
                        // 假 ended 防御：转码流被服务端断开时（反代
                        // 读超时等），浏览器会把已缓冲的末尾当结尾触
                        // 发 ended。绝对播放位置明显未到影片总时长 →
                        // 不是真结尾，从断点重连续播而不是回 A 点。
                        const v = videoRef.current;
                        const abs = v
                            ? v.currentTime +
                              (needsTranscodeSeek
                                  ? seekOffsetRef.current
                                  : 0)
                            : 0;
                        const total =
                            stashDuration && stashDuration > 0
                                ? stashDuration
                                : v && Number.isFinite(v.duration) && v.duration > 0
                                  ? v.duration +
                                    (needsTranscodeSeek
                                        ? seekOffsetRef.current
                                        : 0)
                                  : 0;
                        if (
                            needsTranscodeSeek &&
                            total > 0 &&
                            abs < total - 5 &&
                            transcodeRetryRef.current < 3
                        ) {
                            transcodeRetryRef.current++;
                            seekToTime(Math.max(0, abs));
                            return;
                        }
                        if (autoScroll) {
                            if (isActive && !randomAdvancedRef.current) {
                                randomAdvancedRef.current = true;
                                onAutoAdvance?.();
                            }
                        } else {
                            seekToTime(randomWindowRef.current.start);
                        }
                        return;
                    }
                    if (!autoScroll || !isActive) return;
                    onAutoAdvance?.();
                }}
            >
                {captionTrack && (
                    <track
                        kind="subtitles"
                        src={captionTrack.src}
                        srcLang={captionTrack.srclang}
                        label={captionTrack.label}
                        default
                    />
                )}
            </video>
            {captionTrack && (
                <div className="binge-caption-track" ref={captionRef}>
                    {captionText}
                </div>
            )}
            {/* Full-frame tap target. Sits above the video but below the
                overlay/action-stack so taps in the video area toggle
                play/pause while UI controls remain hot. */}
            <button
                type="button"
                className="binge-tap-target"
                onClick={handleTap}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                aria-label={isPlaying ? t("action.pause") : t("action.play")}
                tabIndex={-1}
            />
            {/* Seek indicator overlay (horizontal swipe) */}
            {seekIndicator && (
                <div className="binge-seek-indicator" aria-hidden="true">
                    <span className="binge-seek-indicator-dir">
                        {seekIndicator.delta >= 0 ? "▶▶" : "◀◀"}
                    </span>
                    <span className="binge-seek-indicator-time">
                        {String(
                            Math.floor(seekIndicator.current / 60)
                        ).padStart(2, "0")}
                        :
                        {Math.floor(seekIndicator.current % 60)
                            .toString()
                            .padStart(2, "0")}
                    </span>
                </div>
            )}
            {/* 2× speed badge (long press) */}
            {showSpeedBadge && (
                <div className="binge-speed-badge" aria-hidden="true">2×</div>
            )}
            {bursts.length > 0 && (
                <div className="binge-heart-burst-layer" aria-hidden="true">
                    {bursts.map((b) => (
                        <HeartBurst key={b.id} />
                    ))}
                </div>
            )}
            {/* 转码流加载指示：半透明黑底圆 + 弧形转圈居中（跟随视频
                内容区偏移）。加载期间下方 paused overlay 让位隐藏，避免
                两个中央元素叠放——"加载中"比"已暂停"更能描述当前状态。 */}
            {transcodeLoading && (
                <div
                    className="binge-transcode-loading"
                    role="status"
                    aria-label={t("status.video_loading")}
                >
                    <span
                        className="binge-transcode-loading-icon"
                        aria-hidden="true"
                    />
                </div>
            )}
            {/* Centered cluster shown only while the video is paused.
                Mute toggle (small) sits above a large play-glyph circle —
                Instagram-style. Both fade in/out together on play state;
                hidden too while the transcode spinner is up. */}
            <div
                className={
                    "binge-paused-overlay" +
                    (isPlaying || transcodeLoading ? " is-hidden" : "")
                }
            >
                <MuteToggle muted={muted} onToggle={() => setMuted(!muted)} />
                <div className="binge-paused-glyph" aria-hidden="true">
                    <PlayGlyph />
                </div>
            </div>
            <div className="binge-overlay">
                <PerformerRow performers={scene.performers} />
                {scene.studio && (
                    <p className="binge-studio">{scene.studio.name}</p>
                )}
                {/* IG-style caption — single-line, tappable to open the
                    details sheet with full description + tags. */}
                <button
                    type="button"
                    className="binge-caption"
                    onClick={() => setDetailsOpen(true)}
                    aria-label={t("action.view_details")}
                >
                    <span className="binge-caption-line">
                        <span className="binge-caption-title">
                            {displayTitle}
                        </span>
                        {detailsLine && (
                            <>
                                <span className="binge-caption-sep">
                                    {" — "}
                                </span>
                                <span className="binge-caption-details">
                                    {detailsLine}
                                </span>
                            </>
                        )}
                    </span>
                </button>
            </div>
            {detailsOpen && (
                <SceneDetailsSheet
                    scene={scene}
                    onClose={() => setDetailsOpen(false)}
                />
            )}
            {advancedRatingOpen && (
                <CriterionRatingModal
                    target={{ kind: "scene", id: scene.id }}
                    onClose={() => setAdvancedRatingOpen(false)}
                    onRatingChange={(r) => {
                        // Mirror the optimistic-rating channel used by
                        // the inline strip so the action-stack badge
                        // reflects the new value immediately.
                        if (onRatingChange) onRatingChange(scene.id, r);
                    }}
                />
            )}
            {moreOpen && (
                <MoreSheet
                    sceneId={scene.id}
                    onClose={() => setMoreOpen(false)}
                />
            )}
            <ActionStack
                oCount={oCount}
                oError={oError}
                onLike={triggerLike}
                onUnlike={triggerUnlike}
                ratingStars={
                    rating100 === null ? null : Math.round(rating100 / 20)
                }
                onSetRating={handleSetRating}
                onOpenAdvancedRating={() => setAdvancedRatingOpen(true)}
                inCollections={inCollections}
                onToggleCollection={handleToggleCollection}
                inMultiviewQueue={inMVQueue}
                onToggleMultiviewQueue={handleToggleMultiview}
                onOpenMultiviewPlayer={handleOpenMultiview}
                onOpenScribe={handleOpenScribe}
                onOpenMore={() => setMoreOpen(true)}
                isFullscreen={isFullscreen}
                onToggleFullscreen={handleToggleFullscreen}
                fullscreenUIVisible={fullscreenUIVisible}
            />
            <SceneProgress
                videoRef={videoRef}
                duration={stashDuration}
                onSeekToTime={(time) => {
                    // 用户点击进度条主动 seek → 取消本场景的随机时段
                    // （清除 B 点窗口），此后播放到影片结束：自动滚动开
                    // 则切换下一个场景，否则停在结尾。滑走再滑回（组件
                    // 重挂载）后随机时段重新生效。
                    randomWindowRef.current = null;
                    userSeekedRef.current = true;
                    seekToTime(time);
                }}
                seekOffset={seekOffset}
                isFullscreen={isFullscreen}
                fullscreenUIVisible={fullscreenUIVisible}
                onInteract={showFullscreenUI}
            />
        </article>
    );
}

// Centered play glyph shown in the paused-overlay. The icon represents the
// affordance ("tap to play"), not the current state, so we only ever
// render the play arrow — when video is playing the whole overlay hides.
function PlayGlyph() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            <path d="M9 7L18 12L9 17Z" />
        </svg>
    );
}

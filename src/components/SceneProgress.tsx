import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

interface SceneProgressProps {
    videoRef: RefObject<HTMLVideoElement | null>;
    // Authoritative duration from Stash's database (scene.files[0].duration).
    // Far more reliable than video.duration, which is `Infinity`/NaN for
    // progressive transcoded streams until the whole file has loaded.
    duration: number | null;
    // 自定义 seek 回调。提供时由父组件（SceneSlide）决定 seek 方式：
    //   - web 兼容容器（mp4/webm/...）：直接设 video.currentTime（原生 seek）
    //   - 转码容器（avi/wmv/mkv/...）：重建 src 带 ?start=N（硬 seek）
    // 不提供时回退到原生 video.currentTime = N（向后兼容）。
    onSeekToTime?: (time: number) => void;
    // 转码硬 seek 偏移量。硬 seek 用 ?start=N 重建 src 后，新流的
    // video.currentTime 从 0 重新计起（ffmpeg 重置时间戳），因此进度条
    // 需要按 (currentTime + seekOffset) / duration 计算真实进度，否则
    // seek 后进度条会瞬间跳回 0。原生流/web 兼容容器偏移量为 0。
    seekOffset?: number;
    // 全屏状态。仅用于影响交互逻辑：全屏下点击/悬停进度条时
    // 唤出已淡出的 UI（YouTube/B 站式残留细条常驻可点）。
    isFullscreen?: boolean;
    // 全屏 UI 是否已淡出。进度条本体始终可见，UI 淡出时仅剩细条。
    fullscreenUIVisible?: boolean;
    // 用户与进度条交互时的回调（用于唤出全屏 UI）。
    onInteract?: () => void;
    // Stash 原生帧预览资源（Generate Previews 一并生成，官方播放器
    // 进度条 scrub 预览同源）：sprite.jpg 雪碧图 + thumbs.vtt 时间戳
    // 坐标。拖动/悬停进度条到时间 T，按 T 定位雪碧图对应帧显示
    // （拖到哪显示哪的画面）。任一缺失 / 加载失败 → 回退纯时间码气泡。
    previewSprite?: string | null;
    previewVtt?: string | null;
}

// 时间码格式：分钟:秒。分钟补零到至少 2 位（"00:05"），超过 99
// 分钟自然增长到 3 位（"120:00"），与需求示例 "00:00" / "000:00"
// 一致——不换算成小时，纯 分:秒 显示。
function formatTimecode(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── Stash 雪碧图帧预览（sprite.jpg + thumbs.vtt）解析 ──────────────
// thumbs.vtt 形如：
//   WEBVTT
//
//   00:00.000 --> 00:02.500
//   x:0 y:0 w:160 h:96
//
//   00:02.500 --> 00:05.000
//   x:160 y:0 w:160 h:96
// 每个 cue 对应 sprite 上一帧格子：start/end 是该帧代表的视频时间
// 区间（秒），x/y/w/h 是该帧在 sprite 大图中的像素坐标。
interface ThumbCue {
    start: number;
    end: number;
    x: number;
    y: number;
    w: number;
    h: number;
}

// "mm:ss.mmm" 或 "hh:mm:ss.mmm" → 秒
function parseVttTime(s: string): number {
    const parts = s.split(":");
    let sec = 0;
    for (const p of parts) sec = sec * 60 + parseFloat(p);
    return Number.isFinite(sec) ? sec : 0;
}

function parseThumbsVTT(text: string): ThumbCue[] {
    const out: ThumbCue[] = [];
    const blocks = text.replace(/\r\n/g, "\n").split("\n\n");
    for (const block of blocks) {
        const lines = block.trim().split("\n").filter(Boolean);
        if (lines.length < 2) continue;
        let timeIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("-->")) { timeIdx = i; break; }
        }
        if (timeIdx < 0 || timeIdx + 1 >= lines.length) continue;
        const timeMatch = lines[timeIdx].match(/([\d:.]+)\s*-->\s*([\d:.]+)/);
        const xywh = lines[timeIdx + 1].match(/#xywh=(\d+),(\d+),(\d+),(\d+)/i);
        if (!timeMatch || !xywh) continue;
        out.push({
            start: parseVttTime(timeMatch[1]),
            end: parseVttTime(timeMatch[2]),
            x: parseInt(xywh[1], 10),
            y: parseInt(xywh[2], 10),
            w: parseInt(xywh[3], 10),
            h: parseInt(xywh[4], 10),
        });
    }
    return out;
}

// Thin Instagram-style progress bar. Pinned to the bottom of the slide,
// 2px tall by default, expands slightly on hover and while scrubbing.
// Drawn against Stash's known duration so it shows real progress through
// a 2-hour scene, not just how far the buffer has loaded.
// 交互：点按/拖动擦洗（拖动中只更新 UI——气泡 + fill，松手统一提交
// 一次 seek）；桌面鼠标悬停实时预览时间码气泡，不点击不跳转。触摸
// 点按后浏览器合成的 mouseenter 由 pointerenter 的 pointerType 守卫
// 过滤（否则移动端 hover 态置真后永不清除）。
export function SceneProgress({
    videoRef,
    duration,
    onSeekToTime,
    seekOffset = 0,
    isFullscreen = false,
    fullscreenUIVisible = true,
    onInteract,
    previewSprite,
    previewVtt,
}: SceneProgressProps) {
    const { t } = useTranslation();
    const [progress, setProgress] = useState(0);
    const [hovering, setHovering] = useState(false);
    // 拖动擦洗（scrub）：拖动期间只更新 UI（气泡 + fill），松手才
    // commit 一次 seek。转码流走硬 seek 路径（重建 src 杀 ffmpeg 进程
    // 重启），严禁连续 seek——"拖动中只动 UI、松手统一提交"是所有流
    // 类型唯一安全的交互；直连流同样受益（交互统一）。
    const [dragging, setDragging] = useState(false);
    const [dragRatio, setDragRatio] = useState(0);
    // 桌面 hover 预览：鼠标悬停进度条时实时显示对应时间码气泡，
    // 不点击不 seek（点击/拖动提交逻辑不变）。触摸设备无 hover，
    // 恒为 null 不参与渲染。
    const [hoverRatio, setHoverRatio] = useState<number | null>(null);
    // 拖动判定的同步镜像：pointerup 里读 state 可能拿到 setState
    // 尚未生效的旧值，用 ref 精确判定。
    const dragActiveRef = useRef(false);
    const barRef = useRef<HTMLDivElement>(null);
    // 时间码：左侧已播放（含转码 seek 偏移量）、右侧总时长。
    // 优先用 Stash 数据库时长；缺失时回退 video.duration（元数据
    // 加载后由 timeupdate/loadedmetadata 监听补齐）。
    const [elapsed, setElapsed] = useState(0);
    const [total, setTotal] = useState(0);
    // 用 ref 镜像 seekOffset：事件监听器只绑定一次，每次触发时从 ref
    // 读取最新值。避免 seekOffset 变化时旧监听器（闭包固定了旧值 0）
    // 在 React 重新绑定前抢先触发 timeupdate，把进度条瞬间重置为 0。
    const seekOffsetRef = useRef(seekOffset);
    seekOffsetRef.current = seekOffset;
    // 全屏 + UI 已淡出：进度条变为"残留细条"模式（CSS 控制）。
    // 此状态下用户点击/悬停应先唤出完整 UI，再继续 seek 行为。
    const fsCollapsed = isFullscreen && !fullscreenUIVisible;

    // ── 雪碧图帧预览加载（vtt → cues；sprite → natural 尺寸） ──
    const [cues, setCues] = useState<ThumbCue[] | null>(null);
    const [spriteSize, setSpriteSize] = useState<{ w: number; h: number } | null>(null);
    const [previewError, setPreviewError] = useState(false);
    // 预览框实际渲染宽度（ResizeObserver 实测），用于把 sprite 原图
    // 坐标按比例缩放到显示尺寸。callback ref：预览 div 在用户 hover/
    // 拖动后才挂载（此前 popoverRatio 为 null），用 callback ref 在
    // 元素挂载时直接 observe，避免 effect 时机错位导致 observer 永远
    // 挂不上、宽度恒 0。
    const roRef = useRef<ResizeObserver | null>(null);
    const [previewBoxW, setPreviewBoxW] = useState(0);
    const setPreviewRef = useCallback((el: HTMLDivElement | null) => {
        if (roRef.current) {
            roRef.current.disconnect();
            roRef.current = null;
        }
        if (el) {
            const ro = new ResizeObserver((entries) => {
                setPreviewBoxW(entries[0].contentRect.width);
            });
            ro.observe(el);
            roRef.current = ro;
        }
    }, []);

    useEffect(() => {
        setCues(null);
        setSpriteSize(null);
        setPreviewError(false);
        if (!previewVtt || !previewSprite) {
            return;
        }
        let cancelled = false;
        fetch(previewVtt)
            .then((r) => {
                if (!r.ok) throw new Error("vtt fetch failed: " + r.status);
                return r.text();
            })
            .then((text) => {
                if (cancelled) return;
                const parsed = parseThumbsVTT(text);
                if (parsed.length === 0) {
                    setPreviewError(true);
                    return;
                }
                setCues(parsed);
                const img = new Image();
                img.onload = () => {
                    if (cancelled) return;
                    setSpriteSize({ w: img.naturalWidth, h: img.naturalHeight });
                };
                img.onerror = () => {
                    if (cancelled) return;
                    setPreviewError(true);
                };
                img.src = previewSprite;
            })
            .catch(() => {
                if (cancelled) return;
                setPreviewError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [previewVtt, previewSprite]);

    // 预览框就绪条件（元素实际挂载由 hover/拖动 + previewReady 共同决定）。
    const previewReady =
        !previewError &&
        !!previewSprite &&
        !!cues &&
        cues.length > 0 &&
        !!spriteSize;

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handle = () => {
            // 转码硬 seek 后新流的 currentTime 从 0 计起，需加上偏移量
            // 才能得到在整段视频中的真实位置。
            const t = video.currentTime + seekOffsetRef.current;
            setElapsed(t);
            const d =
                duration && duration > 0
                    ? duration
                    : Number.isFinite(video.duration)
                      ? video.duration
                      : 0;
            if (d > 0) {
                setTotal(d);
                setProgress(Math.min(1, t / d));
            }
        };
        video.addEventListener("timeupdate", handle);
        video.addEventListener("seeked", handle);
        video.addEventListener("loadedmetadata", handle);
        return () => {
            video.removeEventListener("timeupdate", handle);
            video.removeEventListener("seeked", handle);
            video.removeEventListener("loadedmetadata", handle);
        };
    }, [videoRef, duration]);

    // 解析时长：优先 Stash 数据库时长；转码流 video.duration 在整段
    // 加载完前是 Infinity，不可用。
    const resolveDuration = () => {
        const video = videoRef.current;
        if (duration && duration > 0) return duration;
        return video && Number.isFinite(video.duration) ? video.duration : 0;
    };

    // 指针横坐标 → 进度比例（0~1）。含左右 0.6rem padding（padding
    // 区域同属命中范围），与原点击路径的计算口径一致。
    const ratioFromClientX = (clientX: number) => {
        const el = barRef.current;
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // 仅主键/触摸/笔。右键等不触发擦洗。
        if (e.pointerType === "mouse" && e.button !== 0) return;
        // 全屏下任何进度条交互即重置 UI 自动隐藏计时（含"UI 已淡出
        // 先唤出"的原路径）：拖动从按下起就保持 UI 可见。
        if (isFullscreen) onInteract?.();
        // 捕获指针：拖出进度条区域（甚至屏幕外）仍持续跟踪。
        e.currentTarget.setPointerCapture(e.pointerId);
        dragActiveRef.current = true;
        setDragging(true);
        setDragRatio(ratioFromClientX(e.clientX));
        // 阻止默认行为（文本选择、鼠标兼容事件）；触摸滚动隔离交给
        // touch-action: pan-y——竖滑继续滚动信息流，横滑才擦洗。
        e.preventDefault();
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragActiveRef.current) {
            setDragRatio(ratioFromClientX(e.clientX));
            // 拖动期间持续重置全屏 UI 隐藏计时：长时间拖动中途 UI 不淡出。
            if (isFullscreen) onInteract?.();
            return;
        }
        // 桌面 hover 预览（非拖动）：鼠标悬停位置实时映射为时间码
        // 气泡，仅展示不 seek——点击/拖动才提交跳转。
        if (e.pointerType === "mouse") {
            setHoverRatio(ratioFromClientX(e.clientX));
        }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragActiveRef.current) return;
        dragActiveRef.current = false;
        setDragging(false);
        // 松手统一提交一次 seek（含转码流硬 seek）。原地点按 = 按下
        // 与抬起同位置 = seek 到该比例，行为与原 onClick 等价。
        const ratio = ratioFromClientX(e.clientX);
        const d = resolveDuration();
        if (d > 0) {
            const targetTime = ratio * d;
            // 优先父组件 seek 回调（转码流硬 seek / 取消随机时段），
            // 无回调回退原生 currentTime。
            if (onSeekToTime) {
                onSeekToTime(targetTime);
            } else {
                const video = videoRef.current;
                if (video) video.currentTime = targetTime;
            }
            setProgress(ratio);
        }
        // 鼠标松手：按指针是否仍在进度条范围内恢复 hover 态——拖动
        // 结束在条内 → 气泡无缝切换为 hover 态继续显示（位置取松手
        // 点，避免闪现拖动前的旧 hover 位置）；拖出条外松手 → 清除
        // （pointerleave 在指针捕获释放后也会兜底触发）。
        if (e.pointerType === "mouse") {
            const r = barRef.current?.getBoundingClientRect();
            const inside =
                !!r &&
                e.clientX >= r.left &&
                e.clientX <= r.right &&
                e.clientY >= r.top &&
                e.clientY <= r.bottom;
            setHovering(inside);
            setHoverRatio(inside ? ratio : null);
        }
    };

    const handlePointerCancel = () => {
        // 浏览器接管手势（如竖滑变成信息流滚动）→ 放弃本次擦洗，
        // 不提交 seek。拖动期间 progress state 未被覆盖，fill 立即被
        // timeupdate 拉回真实播放位置。
        dragActiveRef.current = false;
        setDragging(false);
    };

    // 拖动期间 fill 与 slider 值显示拖动位置；松手后由 timeupdate
    // 自然接管。
    const shownRatio = dragging ? dragRatio : progress;
    // 气泡位置：拖动态取拖动位置；否则取桌面 hover 位置（触摸设备
    // hoverRatio 恒 null，无气泡）。
    const popoverRatio = dragging ? dragRatio : hoverRatio;
    // 气泡时间码用的时长（duration prop 优先，缺失回退 total state）。
    const displayDuration = duration && duration > 0 ? duration : total;

    // 当前时间点对应的 sprite 帧：取 start <= T 的最后一个 cue（vtt
    // cue 时间区间可能不均匀）。拖动时 T 随指针连续变化，仅改
    // backgroundPosition，不触发任何 seek。
    let frame: ThumbCue | null = null;
    let frameScale = 0;
    if (previewReady && cues && popoverRatio !== null) {
        const t = popoverRatio * displayDuration;
        let idx = cues.length - 1;
        for (let i = 0; i < cues.length; i++) {
            if (cues[i].start <= t) idx = i;
            else break;
        }
        frame = cues[idx];
        frameScale = previewBoxW > 0 ? previewBoxW / frame.w : 0;
    }

    return (
        <>
            <div
                ref={barRef}
                className={
                    "binge-progress" +
                    (hovering ? " is-hovering" : "") +
                    (dragging ? " is-dragging" : "") +
                    (fsCollapsed ? " is-fs-collapsed" : "")
                }
                /* hover 态只认真实鼠标指针：触摸点按后浏览器会合成
                   mouseenter/mouseleave 兼容事件（无 pointerType 可辨），
                   若走 mouse 事件路径，移动端点一下进度条就会把 hover 态
                   （放大 + 气泡）置真且永不清除（触摸后 mouseleave 不再
                   触发）——气泡残留 bug 的根因。pointerenter/pointerleave
                   携带 pointerType，天然过滤触摸合成事件。 */
                onPointerEnter={(e) => {
                    if (e.pointerType !== "mouse") return;
                    setHovering(true);
                    // hover 气泡从进入点开始跟随（后续由 pointermove 更新）。
                    setHoverRatio(ratioFromClientX(e.clientX));
                    // 鼠标移入细条时唤出完整 UI（桌面端）。移动端无 hover，
                    // 由 pointerdown 路径唤出。
                    if (fsCollapsed) onInteract?.();
                }}
                onPointerLeave={(e) => {
                    if (e.pointerType !== "mouse") return;
                    setHovering(false);
                    setHoverRatio(null);
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={shownRatio}
                aria-label={t("scene.progress")}
            >
                <div
                    className="binge-progress-fill"
                    style={{ transform: `scaleX(${shownRatio})` }}
                />
                {/* 定位浮层：拖动时显示拖动位置时间码；桌面 hover 时
                    显示悬停位置时间码（仅预览不 seek）。--binge-drag-x
                    为气泡锚点百分比（数值），CSS clamp 防止气泡超出屏幕
                    边缘。有帧预览时预览元素作为本容器首个子元素插入，
                    时间码气泡保持在底部、宽度不撑满预览图、居中。 */}
                {popoverRatio !== null && (
                    <div
                        className={
                            "binge-progress-popover" + (previewReady ? " has-preview" : "")
                        }
                        style={
                            {
                                "--binge-drag-x": `${popoverRatio * 100}`,
                            } as React.CSSProperties
                        }
                    >
                        {/* 帧预览：Stash sprite 雪碧图，按当前时间 T 定位
                            对应帧（拖到哪显示哪的画面）。背景图一次加载，
                            拖动仅改 backgroundPosition，零额外请求。
                            任一资源缺失/加载失败 → 整块不渲染，回退纯
                            时间码气泡。 */}
                        {previewReady && frame && previewSprite && spriteSize && (
                            <div
                                ref={setPreviewRef}
                                className="binge-progress-preview"
                                style={{
                                    /* 高度按帧实际比例；未量到宽度时交给
                                       CSS aspect-ratio 16/9 兜底。 */
                                    height:
                                        frameScale > 0
                                            ? `${(previewBoxW * frame.h) / frame.w}px`
                                            : undefined,
                                    backgroundImage: `url("${previewSprite}")`,
                                    backgroundSize:
                                        frameScale > 0
                                            ? `${spriteSize.w * frameScale}px ${spriteSize.h * frameScale}px`
                                            : undefined,
                                    backgroundPosition:
                                        frameScale > 0
                                            ? `${-frame.x * frameScale}px ${-frame.y * frameScale}px`
                                            : undefined,
                                }}
                            />
                        )}
                        <div className="binge-progress-bubble">
                            {formatTimecode(popoverRatio * displayDuration)}
                        </div>
                    </div>
                )}
            </div>
            {/* 时间码行：进度条下方，左已播放 / 右总时长。aria-hidden
                避免屏幕阅读器随 timeupdate 频繁播报。显示/隐藏（全屏
                UI 淡出）由 CSS 控制。 */}
            <div className="binge-progress-time" aria-hidden="true">
                <span>{formatTimecode(elapsed)}</span>
                <span>{formatTimecode(total)}</span>
            </div>
        </>
    );
}

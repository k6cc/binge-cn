import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

interface SceneProgressProps {
    videoRef: RefObject<HTMLVideoElement | null>;
    // Authoritative duration from Stash's database (scene.files[0].duration).
    // Far more reliable than video.duration, which is `Infinity`/NaN for
    // progressive transcoded streams until the whole file has loaded.
    duration: number | null;
    // 需求2：自定义 seek 回调。提供时由父组件（SceneSlide）决定 seek 方式：
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

// Thin Instagram-style progress bar. Pinned to the bottom of the slide,
// 2px tall by default, expands slightly on hover. Drawn against Stash's
// known duration so it shows real progress through a 2-hour scene, not
// just how far the buffer has loaded.
export function SceneProgress({
    videoRef,
    duration,
    onSeekToTime,
    seekOffset = 0,
    isFullscreen = false,
    fullscreenUIVisible = true,
    onInteract,
}: SceneProgressProps) {
    const { t } = useTranslation();
    const [progress, setProgress] = useState(0);
    const [hovering, setHovering] = useState(false);
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

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        // 全屏 UI 已淡出时，先唤出完整 UI（YouTube/B 站式残留细条
        // 可点：点击细条 → 显示完整进度条 + overlay），仍同步执行
        // seek，避免第二次点击才能跳转的笨拙体验。
        if (fsCollapsed) onInteract?.();
        const video = videoRef.current;
        if (!video) return;
        const d =
            duration && duration > 0
                ? duration
                : Number.isFinite(video.duration)
                  ? video.duration
                  : 0;
        if (d <= 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const targetTime = ratio * d;
        // 需求2：优先用父组件提供的 seek 回调（转码流走硬 seek 路径）。
        // 无回调时回退到原生 currentTime 赋值。
        if (onSeekToTime) {
            onSeekToTime(targetTime);
        } else {
            video.currentTime = targetTime;
        }
        setProgress(ratio);
    };

    return (
        <>
            <div
                className={
                    "binge-progress" +
                    (hovering ? " is-hovering" : "") +
                    (fsCollapsed ? " is-fs-collapsed" : "")
                }
                onMouseEnter={() => {
                    setHovering(true);
                    // 鼠标移入细条时唤出完整 UI（桌面端）。移动端无 hover，
                    // 由 onClick 路径唤出。
                    if (fsCollapsed) onInteract?.();
                }}
                onMouseLeave={() => setHovering(false)}
                onClick={handleSeek}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={progress}
                aria-label={t("scene.progress")}
            >
                <div
                    className="binge-progress-fill"
                    style={{ transform: `scaleX(${progress})` }}
                />
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

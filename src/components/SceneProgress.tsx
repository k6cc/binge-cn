import { useEffect, useState, type RefObject } from "react";

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
}

// Thin Instagram-style progress bar. Pinned to the bottom of the slide,
// 2px tall by default, expands slightly on hover. Drawn against Stash's
// known duration so it shows real progress through a 2-hour scene, not
// just how far the buffer has loaded.
export function SceneProgress({
    videoRef,
    duration,
    onSeekToTime,
}: SceneProgressProps) {
    const [progress, setProgress] = useState(0);
    const [hovering, setHovering] = useState(false);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const handle = () => {
            const t = video.currentTime;
            const d =
                duration && duration > 0
                    ? duration
                    : Number.isFinite(video.duration)
                      ? video.duration
                      : 0;
            if (d > 0) {
                setProgress(Math.min(1, t / d));
            }
        };
        video.addEventListener("timeupdate", handle);
        video.addEventListener("seeked", handle);
        return () => {
            video.removeEventListener("timeupdate", handle);
            video.removeEventListener("seeked", handle);
        };
    }, [videoRef, duration]);

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
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
        <div
            className={
                "binge-progress" + (hovering ? " is-hovering" : "")
            }
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            onClick={handleSeek}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={progress}
            aria-label="场景进度"
        >
            <div
                className="binge-progress-fill"
                style={{ transform: `scaleX(${progress})` }}
            />
        </div>
    );
}

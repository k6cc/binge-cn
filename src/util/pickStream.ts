import type { BingeScene } from "../api/queries";
import type { TranscodeType } from "../config";

// Map a user's transcode preference to a stream URL. The available endpoints
// vary per Stash install (depends on the user's transcode config), so we
// match by label/mime substring and fall back to paths.stream when there's
// no match — that field is the one Stash itself negotiates.
//
// Labels from Stash typically look like: "Direct stream", "MP4", "WEBM",
// "HLS". We do case-insensitive substring matching against label first,
// then mime_type as a fallback.
//
// 需求2：自动模式下，对浏览器无法直接解码的容器（.avi/.wmv/.wma/
// .mkv/.flv/.rmvb/.mpeg/.ts/.m2ts 等）强制走转码流，否则 <video>
// 加载 direct stream 会黑屏失败。web 兼容容器（.mp4/.webm/.mov/
// .m4v/.ogv）继续走 Stash 协商出的 paths.stream。
const WEB_COMPATIBLE_EXTS = new Set([
    ".mp4",
    ".m4v",
    ".mov",
    ".webm",
    ".ogv",
]);

// 浏览器 <video> 无法解码的视频编码（ffprobe 命名）。容器后缀是
// web 兼容（.mp4/.mov）但编码命中此表时仍需走转码流——典型场景：
// 老影片 .mp4 内封装 MPEG-4 Part 2（Xvid/DivX 系），直连播放
// 只有声音没有画面。h264/hevc/vp8/vp9/av1 不在表内（现代浏览器
// 均可硬解或软解）。
const WEB_INCOMPATIBLE_CODECS = new Set([
    "mpeg4", // MPEG-4 Part 2（含 Xvid/DivX 打包）
    "xvid",
    "divx",
    "div3",
    "div4",
    "msmpeg4",
    "msmpeg4v1",
    "msmpeg4v2",
    "msmpeg4v3",
    "wmv1",
    "wmv2",
    "wmv3",
    "flv1",
    "vp6",
    "vp6f",
    "rv30",
    "rv40",
]);

function getPrimaryExtension(scene: BingeScene): string {
    const path = scene.files?.[0]?.path ?? "";
    const lastDot = path.lastIndexOf(".");
    if (lastDot < 0) return "";
    return path.slice(lastDot).toLowerCase();
}

// 需求2：导出 isWebCompatible，让播放器知道当前场景是否走转码流。
// 转码流（MP4 transcode）是渐进式下载，原生 <video>.currentTime = N 依赖
// HTTP Range 请求，而 Stash 的 live transcode 不稳定支持 Range → 快进会
// 从头播放。播放器需要用 ?start=N 参数重建 src 来实现"硬 seek"。
export function isWebCompatible(scene: BingeScene): boolean {
    // files 缺失（老缓存数据/测试夹具）时无从判断容器后缀，回退到
    // 需求2 之前的旧行为：不拦截 direct stream。
    if (!scene.files || scene.files.length === 0) return true;
    if (!WEB_COMPATIBLE_EXTS.has(getPrimaryExtension(scene))) return false;
    // web 容器 + 浏览器不可解编码（.mp4 里的 mpeg4/xvid 等）→ 需转码。
    // video_codec 缺失（老缓存数据）时只按后缀判断，保持旧行为。
    const codec = scene.files?.[0]?.video_codec;
    if (codec && WEB_INCOMPATIBLE_CODECS.has(codec.toLowerCase())) {
        return false;
    }
    return true;
}

// 需求2 修复：为转码流构造 seek URL。
// Stash 的 stream 端点支持 ?start={秒} 参数（HLS 和 MP4 transcode 均支持），
// 传入后 ffmpeg 从该时间点开始转码。这是"硬 seek"——会重新加载视频，但
// 对不支持 Range 的 live transcode 是唯一可靠的 seek 方式。
//
// 已有 query 参数时用 & 拼接；已有 start= 时替换；start 秒数四舍五入到
// 3 位小数（毫秒精度足够，避免 URL 过长）。
export function buildTranscodeSeekUrl(
    streamUrl: string,
    startSeconds: number
): string {
    if (!Number.isFinite(startSeconds) || startSeconds < 0) {
        return streamUrl;
    }
    const start = startSeconds.toFixed(3);
    const url = new URL(streamUrl, window.location.origin);
    url.searchParams.set("start", start);
    // 返回相对 URL（保留 Stash 原始路径，不加 origin）
    return url.pathname + url.search + url.hash;
}


// Pick the best transcode stream for an incompatible file. Prefers
// MP4 (Stash 的转码默认输出 MP4，video.js 在 Stash 自身播放器里也是
// 用 MP4 transcode + VHS 处理 seek), then HLS, then WebM as a last
// resort. Returns null if Stash didn't expose any transcode endpoint
// for this scene — caller falls back to paths.stream in that case.
//
// 需求2 修复：原先只匹配用户指定的 preference，对 auto 模式 + 不兼容
// 容器没有兜底。现在 auto / direct 模式下若文件是浏览器无法原生解码
// 的容器（avi/wmv/wma/mkv/...），自动选择 MP4 转码流激活 Stash 转码。
function pickTranscodeStream(scene: BingeScene): string | null {
    const streams = scene.sceneStreams ?? [];
    const mp4 = streams.find((s) =>
        matches(s.label, s.mime_type, "mp4")
    );
    if (mp4) return mp4.url;
    const hls = streams.find((s) =>
        matches(s.label, s.mime_type, "hls")
    );
    if (hls) return hls.url;
    const webm = streams.find((s) =>
        matches(s.label, s.mime_type, "webm")
    );
    if (webm) return webm.url;
    return null;
}

export function pickStreamUrl(
    scene: BingeScene,
    preference: TranscodeType,
): string {
    // 需求2：需要转码的容器（avi/wma/wmv/mkv/...）无论用户选什么
    // 流媒体类型，都必须跳过 direct stream — 浏览器无法原生解码。
    // auto 模式下自动选择 MP4 转码流；direct 模式同样改走转码流，
    // 否则用户选了"直连"会遇到黑屏。
    if (!isWebCompatible(scene)) {
        if (preference === "auto" || preference === "direct") {
            const transcoded = pickTranscodeStream(scene);
            if (transcoded) return transcoded;
        }
        // mp4/webm/hls: fall through to the label match below; if no
        // match, the fallback at the end still hits paths.stream.
    }

    if (preference === "auto") return scene.paths.stream;

    const streams = scene.sceneStreams ?? [];
    const match = streams.find((s) =>
        matches(s.label, s.mime_type, preference),
    );
    return match?.url ?? scene.paths.stream;
}

function matches(
    label: string | null,
    mime: string | null,
    pref: TranscodeType,
): boolean {
    const l = (label ?? "").toLowerCase();
    const m = (mime ?? "").toLowerCase();
    switch (pref) {
        case "direct":
            return l.includes("direct");
        // The direct exclusion has to cover the mime clause too.
        //
        // Stash lists the direct entry first, and for an .mp4 source its
        // mime_type IS video/mp4 - so `|| m === "video/mp4"` matched the
        // direct stream and Array.find returned it before ever reaching
        // the transcode entry. The setting exists for exactly the person
        // whose direct stream will not decode (HEVC in MP4), and it
        // handed them the same undecodable stream while the settings
        // panel said it would force a transcode. Same hole for webm.
        case "mp4":
            return (
                !l.includes("direct") &&
                (l.includes("mp4") || m === "video/mp4")
            );
        case "webm":
            return (
                !l.includes("direct") &&
                (l.includes("webm") || m === "video/webm")
            );
        case "hls":
            return (
                l.includes("hls") ||
                m.includes("mpegurl") ||
                m.includes("x-mpegurl")
            );
        default:
            return false;
    }
}

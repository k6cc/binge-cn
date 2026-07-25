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

function getPrimaryExtension(scene: BingeScene): string {
    const path = scene.files[0]?.path ?? "";
    const lastDot = path.lastIndexOf(".");
    if (lastDot < 0) return "";
    return path.slice(lastDot).toLowerCase();
}

function isWebCompatible(scene: BingeScene): boolean {
    return WEB_COMPATIBLE_EXTS.has(getPrimaryExtension(scene));
}

// Pick the best transcode stream for an incompatible file. Prefers
// HLS (segment-based, supports seeking via hls.js) over MP4 (continuous
// stream, Stash 的 MP4 转码端点不支持 HTTP range request → 快进会
// 从头播放). WebM 作为最后降级。
//
// 需求2 修复：原先优先 MP4，导致 avi/wmv 转码影片快进时浏览器发
// range request，Stash 的 live transcode 端点无法处理 → 视频重置
// 到开头。HLS 把视频切成 segment，快进只需请求对应 segment，天然
// 支持随机位置访问。非 Safari 浏览器由 SceneSlide 中的 hls.js
// 负责解码。
function pickTranscodeStream(scene: BingeScene): string | null {
    const streams = scene.sceneStreams ?? [];
    const hls = streams.find((s) =>
        matches(s.label, s.mime_type, "hls")
    );
    if (hls) return hls.url;
    const mp4 = streams.find((s) =>
        matches(s.label, s.mime_type, "mp4")
    );
    if (mp4) return mp4.url;
    const webm = streams.find((s) =>
        matches(s.label, s.mime_type, "webm")
    );
    if (webm) return webm.url;
    return null;
}

export function pickStreamUrl(
    scene: BingeScene,
    preference: TranscodeType
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
    const match = streams.find((s) => matches(s.label, s.mime_type, preference));
    return match?.url ?? scene.paths.stream;
}

function matches(
    label: string | null,
    mime: string | null,
    pref: TranscodeType
): boolean {
    const l = (label ?? "").toLowerCase();
    const m = (mime ?? "").toLowerCase();
    switch (pref) {
        case "direct":
            return l.includes("direct");
        case "mp4":
            return (l.includes("mp4") && !l.includes("direct")) || m === "video/mp4";
        case "webm":
            return l.includes("webm") || m === "video/webm";
        case "hls":
            return l.includes("hls") || m.includes("mpegurl") || m.includes("x-mpegurl");
        default:
            return false;
    }
}

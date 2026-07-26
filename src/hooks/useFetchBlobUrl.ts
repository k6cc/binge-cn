import { useEffect, useState } from "react";

// 通过 fetch(referrerPolicy:'no-referrer') 下载资源并转为 blob: URL。
//
// 背景：某些 CDN（twimg.com 等）会检查 Referer，从 stash 插件页面
// （http://192.168.x.x:9999）加载媒体带 Referer 会被 403。<video>
// 元素的 referrerpolicy 属性浏览器实现滞后（Chromium 对 media element
// 长期不实现），而 fetch API 的 referrerPolicy 选项可靠。blob: URL 是
// 同源本地资源，赋给 <video>.src / <img>.src 后不再发网络请求，绕过
// Referer 检查。
//
// 用于：
// - PerformerXGrid 的 XVideoThumb（视频缩略图）
// - StoryViewer 的 X/Reddit 视频场景
//
// 返回 { blobUrl, failed, progress }：
// - blobUrl: string | null（加载完才有值）
// - failed: boolean（加载失败）
// - progress: number | null（0-100，无 Content-Length 时为 null）
//
// 组件卸载或 url 变化时自动 revokeObjectURL 释放内存。
export function useFetchBlobUrl(url: string | null | undefined): {
    blobUrl: string | null;
    failed: boolean;
    progress: number | null;
} {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);

    useEffect(() => {
        if (!url) {
            setBlobUrl(null);
            setFailed(false);
            setProgress(null);
            return;
        }
        let alive = true;
        let createdUrl: string | null = null;
        setFailed(false);
        setBlobUrl(null);
        setProgress(null);
        fetch(url, { referrerPolicy: "no-referrer" })
            .then((r) => {
                if (!r.ok) throw new Error("HTTP " + r.status);
                const total = Number(r.headers.get("content-length"));
                if (total > 0 && r.body) {
                    // 有 Content-Length：读取 stream 计算进度
                    const reader = r.body.getReader();
                    let received = 0;
                    const chunks: BlobPart[] = [];
                    const pump = (): Promise<void> =>
                        reader
                            .read()
                            .then(({ done, value }) => {
                                if (!alive) return;
                                if (done) return;
                                if (value) {
                                    received += value.length;
                                    // TS 6 对 Uint8Array<ArrayBufferLike>
                                    // 类型约束更严，用 new Uint8Array(value)
                                    // 创建副本（buffer 为新分配的
                                    // ArrayBuffer），可赋值给 BlobPart。
                                    chunks.push(new Uint8Array(value));
                                    setProgress(
                                        Math.min(100, (received / total) * 100)
                                    );
                                }
                                return pump();
                            });
                    return pump().then(() => {
                        if (!alive) return;
                        const blob = new Blob(chunks, {
                            type: r.headers.get("content-type") ||
                                "application/octet-stream",
                        });
                        return blob;
                    });
                }
                // 无 Content-Length：退化用 blob()
                setProgress(null);
                return r.blob();
            })
            .then((b) => {
                if (!alive || !b || b.size === 0) return;
                createdUrl = URL.createObjectURL(b);
                if (alive) setBlobUrl(createdUrl);
            })
            .catch(() => {
                if (alive) setFailed(true);
            });
        return () => {
            alive = false;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [url]);

    return { blobUrl, failed, progress };
}

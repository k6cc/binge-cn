import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDragPaging } from "../hooks/useDragPaging";
import { getSourceBox, getStashDBScene } from "../api/stashdb";
import {
    contentIdFromR18Url,
    deriveContentId,
    probeDmmGallery,
} from "./dmmGallery";
import { formatDuration } from "../utils/date";
import { useTranslation } from "react-i18next";

interface ScenePreviewOverlayProps {
    sceneStashId: string;
    coverUrl: string;
    title: string | null;
    // 文件名素材：卡片引用的演员（primary + 库内联合，非场景全量）
    // 与发布日期，供下载按钮命名。
    performerNames: string[];
    releaseDate: string | null;
    onClose: () => void;
}

// 详情会话缓存：重开预览窗不重查 findScene。失败时清除，避免缓存
// rejected promise。
const detailCache = new Map<
    string,
    Promise<Awaited<ReturnType<typeof getStashDBScene>>>
>();
function loadSceneDetail(sceneId: string, apiKey: string) {
    let p = detailCache.get(sceneId);
    if (!p) {
        p = getStashDBScene(sceneId, apiKey).catch((err) => {
            detailCache.delete(sceneId);
            throw err;
        });
        detailCache.set(sceneId, p);
    }
    return p;
}

// 发现页卡片的全屏剧照预览。第 0 页是封面（横版，底部信息栏显示
// 番号（后跟小号工作室·时长）/简介/标签，剧照数底部居中），之后
// 是剧照页（底部居中 n/N，封面不计入）。轨道机制与 ImageLightbox
// 同款：原生横向滚动 + scroll-snap、箭头/方向键/Esc、点空白关闭、
// 桌面拖拽翻页。关闭按钮左侧的下载按钮保存当前页图片，命名"番号
// 演员日期"；CORS 拒绝的图床（DMM）退化为新标签打开。
//
// 剧照按需加载：打开时才发一次 findScene 详情查询（首页 feed 零
// 开销），场景 urls 含 r18.dev 链接时用其 id 参数生成 DMM 图床序
// 列并批量探测——每张确认即追加到轨道，右箭头随之出现。探测结果
// 与详情均会话内缓存，重开秒进。
export function ScenePreviewOverlay({
    sceneStashId,
    coverUrl,
    title,
    performerNames,
    releaseDate,
    onClose,
}: ScenePreviewOverlayProps) {
    const { t } = useTranslation();
    const trackRef = useRef<HTMLDivElement>(null);
    const infoRef = useRef<HTMLDivElement>(null);
    const countRef = useRef<HTMLDivElement>(null);
    const coverRef = useRef<HTMLImageElement>(null);
    const detailsRef = useRef<HTMLParagraphElement>(null);
    const [copied, setCopied] = useState(false);
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const [detailsTruncated, setDetailsTruncated] = useState(false);

    const [detail, setDetail] = useState<Awaited<
        ReturnType<typeof getStashDBScene>
    > | null>(null);
    const [gallery, setGallery] = useState<string[]>([]);
    const [probing, setProbing] = useState(false);

    // 详情 + 剧照探测。alive 防关闭后的迟到 setState。
    useEffect(() => {
        let alive = true;
        (async () => {
            const box = await getSourceBox();
            if (!box || !alive) return;
            const d = await loadSceneDetail(sceneStashId, box.api_key);
            if (!alive) return;
            setDetail(d);
            if (!d) return;
            const r18Url = d.urls.find((u) =>
                u.url.includes("r18.dev"),
            );
            if (!r18Url) return;
            const contentId =
                contentIdFromR18Url(r18Url.url) ?? deriveContentId(d.code);
            if (!contentId) return;
            setProbing(true);
            // 首次探测经 onImage 渐进追加；resolve 值是完整序列，结尾
            // 覆盖一次以覆盖会话缓存命中场景（缓存命中不触发回调）。
            const found = await probeDmmGallery(contentId, (url) => {
                if (alive) setGallery((prev) => [...prev, url]);
            });
            if (alive) setGallery(found);
            if (alive) setProbing(false);
        })();
        return () => {
            alive = false;
        };
    }, [sceneStashId]);

    // 方向键/Esc。stepRef 每渲染指向最新 step（slides.length 随探
    // 测增长），无 stale 上限。
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowLeft") stepRef.current(-1);
            else if (e.key === "ArrowRight") stepRef.current(1);
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    // 翻页：绝对索引 scrollTo（与 ImageLightbox 同款，无 scrollBy
    // 累积误差）。
    const slideCount = gallery.length + 1;
    const step = (delta: 1 | -1) => {
        const el = trackRef.current;
        if (!el || el.clientWidth <= 0) return;
        const cur = Math.round(el.scrollLeft / el.clientWidth);
        const target = Math.min(Math.max(cur + delta, 0), slideCount - 1);
        el.scrollTo({ left: target * el.clientWidth, behavior: "smooth" });
    };
    const stepRef = useRef(step);
    stepRef.current = step;

    // 当前页索引：snap 落定后一屏宽一页。
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const el = trackRef.current;
        if (!el) return;
        let raf = 0;
        const sync = () => {
            raf = 0;
            if (el.clientWidth <= 0) return;
            const i = Math.min(
                Math.max(Math.round(el.scrollLeft / el.clientWidth), 0),
                slideCount - 1,
            );
            setIndex((prev) => (prev === i ? prev : i));
        };
        const onScroll = () => {
            if (!raf) raf = requestAnimationFrame(sync);
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [slideCount]);

    // 点空白关闭 + 桌面拖拽翻页（与 ImageLightbox 同款）。
    const { onPointerDown: dragPagingDown } = useDragPaging(trackRef, {
        pageCount: slideCount,
    });
    const downPosRef = useRef<{ x: number; y: number } | null>(null);
    const handleTrackPointerDown = (e: React.PointerEvent) => {
        downPosRef.current = { x: e.clientX, y: e.clientY };
        dragPagingDown(e);
    };
    // 点击是否落在图片的 object-fit 内容矩形内（与 measureVideoContent
    // 同款几何）。封面用 object-position 50% 30%（内容偏上），剧照默认
    // 50% 50% 居中（元素盒即内容盒，无黑边）。未加载完成时保守视为内容内。
    const isInsideImageContent = (
        e: React.MouseEvent,
        img: HTMLImageElement
    ): boolean => {
        const rect = img.getBoundingClientRect();
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!nw || !nh || !rect.width || !rect.height) return true;
        const ratio = nw / nh;
        const cr = rect.width / rect.height;
        let cw: number, chh: number;
        if (ratio > cr) {
            cw = rect.width;
            chh = rect.width / ratio;
        } else {
            chh = rect.height;
            cw = rect.height * ratio;
        }
        const isCover = img.classList.contains("binge-scene-preview-cover");
        const topOff = isCover
            ? (rect.height - chh) * 0.3
            : (rect.height - chh) * 0.5;
        const leftOff = (rect.width - cw) * 0.5;
        return (
            e.clientX >= rect.left + leftOff &&
            e.clientX <= rect.left + leftOff + cw &&
            e.clientY >= rect.top + topOff &&
            e.clientY <= rect.top + topOff + chh
        );
    };

    // 点击空白关闭（挂在 root 上）。按钮类（下载/关闭/箭头/番号/更多
    // 收起）不关；图片点内容不关、点左右上黑边关闭（几何判定）；
    // 有拖拽位移（>6px）不关（翻页手势）。信息栏本体可点：空白关闭。
    const handleRootClick = (e: React.MouseEvent) => {
        // 先取并清空拖拽起点：排除路径（点图/按钮）也清，避免残留
        // 旧坐标影响后续空白点击的位移判断。
        const down = downPosRef.current;
        downPosRef.current = null;
        const target = e.target as HTMLElement;
        if (
            target.closest(
                ".binge-lightbox-download, " +
                ".binge-lightbox-close, " +
                ".binge-lightbox-nav, " +
                ".binge-scene-preview-code-copy, " +
                ".binge-scene-preview-more"
            )
        ) {
            return;
        }
        const img = target.closest(
            ".binge-scene-preview-image"
        ) as HTMLImageElement | null;
        if (img && isInsideImageContent(e, img)) return;
        if (
            down &&
            (Math.abs(e.clientX - down.x) > 6 ||
                Math.abs(e.clientY - down.y) > 6)
        ) {
            return;
        }
        onClose();
    };

    const code = detail?.code ?? null;
    const studioName = detail?.studio?.name ?? null;
    const duration = detail?.duration ?? null;
    const tags = detail?.tags ?? [];
    const detailsText = detail?.details ?? null;
    const hasMeta = studioName != null || duration != null;

    // 当前页图片：第 0 页封面，其余对应 gallery[index-1]。
    const currentImageUrl =
        index === 0 ? coverUrl : (gallery[index - 1] ?? null);

    // 下载命名：番号 演员列表 发布日期（缺失项跳过，全缺退回标题），
    // 扩展名取自 URL。演员名清理文件系统非法字符。
    const handleDownload = async () => {
        const url = currentImageUrl;
        if (!url) return;
        const sanitize = (s: string) =>
            s.replace(/[\\/:*?"<>|]/g, "").trim();
        const parts = [
            code ? sanitize(code) : null,
            performerNames.length > 0
                ? sanitize(performerNames.join(" "))
                : null,
            releaseDate,
        ].filter(Boolean);
        const base =
            parts.length > 0 ? parts.join(" ") : (title ?? "binge-scene");
        const ext = url.match(/\.(jpe?g|png|webp|gif)$/i)?.[0] ?? ".jpg";
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = base + ext;
            a.click();
            URL.revokeObjectURL(a.href);
        } catch {
            // 图床无 CORS 头（DMM 图床实测 fetch 拒绝）：新标签打开，
            // 由用户手动另存。javstash 等允许 CORS 的源直接落盘。
            window.open(url, "_blank", "noopener");
        }
    };

    // 信息栏定位：紧跟封面内容底部（封面用 .binge-scene-preview-cover
    // 的 object-position 50% 30% 上移后，内容底部 = 30% 黑边 + 内容高），
    // 内容超高时上移侵入封面区域（触底保护，渐变背景保留）。
    // 触底上限是「n 张剧照」行（countRef 顶部）：信息栏底部不越过
    // 剧照数，计数始终底部居中。与 SceneSlide.measureVideoContent
    // 同一几何：contain 内容高 rh，顶部偏移 = 0.3 × 垂直剩余空间
    // （横版才有；竖版撑满高度无效果）。
    useLayoutEffect(() => {
        const root = trackRef.current?.parentElement;
        const info = infoRef.current;
        const cover = coverRef.current;
        if (!root || !info || !cover) return;
        let raf = 0;
        const measure = () => {
            raf = 0;
            const cw = root.clientWidth;
            const ch = root.clientHeight;
            if (!cw || !ch) return;
            const nw = cover.naturalWidth;
            const nh = cover.naturalHeight;
            // 封面自然尺寸未就绪时按发现页固定横版 16:9 假设，
            // 加载完成后由 load 事件重测精确位置。
            const ratio = nw && nh ? nw / nh : 16 / 9;
            const cr = cw / ch;
            const rh = ratio > cr ? cw / ratio : ch;
            const topOff = ratio > cr ? 0.3 * (ch - rh) : 0;
            const coverBottom = topOff + rh;
            const infoH = info.offsetHeight;
            // 触底边界 = 「n 张剧照」行顶部（相对视口）；未渲染时
            // 退回视口底（计数缺失场景 info 贴底）。
            const countTop =
                countRef.current?.getBoundingClientRect().top ?? ch;
            const top = Math.max(0, Math.min(coverBottom, countTop - infoH));
            // 变量供信息栏与单一渐变层（.binge-scene-preview-fade）共用：
            // 渐变从信息栏顶部（--binge-preview-info-top）一路延伸到
            // 屏幕底，穿过「n 张剧照」行——单一渐变无拼接断层，宽屏
            // 渐变自然铺满底部；信息栏自身不再画背景（文字靠渐变+
            // text-shadow 衬底，且整体穿透不拦截图片划动）。
            root.style.setProperty("--binge-preview-info-top", `${top}px`);
            info.style.top = "var(--binge-preview-info-top)";
            info.style.bottom = "auto";
        };
        const schedule = () => {
            if (!raf) raf = requestAnimationFrame(measure);
        };
        measure();
        const ro = new ResizeObserver(schedule);
        ro.observe(info);
        ro.observe(countRef.current ?? root);
        window.addEventListener("resize", schedule);
        if (!cover.complete) cover.addEventListener("load", schedule);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener("resize", schedule);
            cover.removeEventListener("load", schedule);
        };
        // index：划动翻页（剧照⇄封面）重测定位——count 行条件渲染，
        // 划走卸载/划回重挂后 RO 不会自动跟随新节点，index 变化直接
        // 重跑 measure 并重挂 RO；detailsExpanded：展开/收起后立即重测，
        // 不依赖 RO 触发时序（避免"立即划走再划回"位置回退到贴图下方）。
    }, [detail, gallery.length, probing, index, detailsExpanded]);

    // 简介截断检测：4 行 clamp 生效且内容溢出时视为截断，尾部显示
    // "更多"；展开后由 is-expanded 取消 clamp 并显示"收起"。
    useEffect(() => {
        const el = detailsRef.current;
        if (!el) return;
        const check = () => {
            const truncated = el.scrollHeight > el.clientHeight + 1;
            setDetailsTruncated((prev) =>
                prev === truncated ? prev : truncated
            );
        };
        check();
        const ro = new ResizeObserver(check);
        ro.observe(el);
        window.addEventListener("resize", check);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", check);
        };
    }, [detailsText, detailsExpanded]);

    // 点击番号一键复制；失败降级 execCommand（非安全上下文）。
    const handleCopyCode = async () => {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = code;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
    };

    return createPortal(
        <div
            className="binge-lightbox-root binge-scene-preview-root"
            role="dialog"
            aria-label={title ?? t("action.preview_scene")}
            onClick={handleRootClick}
        >
            <button
                type="button"
                className="binge-lightbox-close binge-lightbox-download"
                onClick={() => void handleDownload()}
                aria-label={t("action.download_image")}
                title={t("action.download_image")}
            >
                <DownloadIcon />
            </button>
            <button
                type="button"
                className="binge-lightbox-close"
                onClick={onClose}
                aria-label={t("action.close")}
            >
                ×
            </button>
            <div
                className="binge-lightbox-track"
                ref={trackRef}
                onPointerDown={handleTrackPointerDown}
            >
                <div className="binge-lightbox-slide">
                    <img
                        src={coverUrl}
                        alt={title ?? ""}
                        ref={coverRef}
                        className="binge-lightbox-image binge-scene-preview-image binge-scene-preview-cover"
                        draggable={false}
                    />
                </div>
                {gallery.map((url) => (
                    <div className="binge-lightbox-slide" key={url}>
                        <img
                            src={url}
                            alt=""
                            className="binge-lightbox-image binge-scene-preview-image"
                            loading="lazy"
                            draggable={false}
                        />
                    </div>
                ))}
            </div>
            {index > 0 && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-prev"
                    onClick={() => step(-1)}
                    aria-label={t("action.previous")}
                >
                    <ChevronLeft />
                </button>
            )}
            {index < slideCount - 1 && (
                <button
                    type="button"
                    className="binge-lightbox-nav binge-lightbox-next"
                    onClick={() => step(1)}
                    aria-label={t("action.next")}
                >
                    <ChevronRight />
                </button>
            )}

            {detail && (
                <div
                    ref={infoRef}
                    className={
                        "binge-scene-preview-info" +
                        (index === 0 ? "" : " is-hidden")
                    }
                >
                    {(code || hasMeta) && (
                        <div className="binge-scene-preview-code">
                            {code && (
                                <button
                                    type="button"
                                    className={
                                        "binge-scene-preview-code-copy" +
                                        (copied ? " is-copied" : "")
                                    }
                                    onClick={() => void handleCopyCode()}
                                    title={t("scene.copy_code")}
                                >
                                    {code}
                                </button>
                            )}
                            {hasMeta && (
                                <span className="binge-scene-preview-meta">
                                    {studioName}
                                    {studioName && duration != null
                                        ? " · "
                                        : ""}
                                    {duration != null && (
                                        <strong className="binge-scene-preview-duration">
                                            {formatDuration(duration)}
                                        </strong>
                                    )}
                                </span>
                            )}
                        </div>
                    )}
                    {detailsText && (
                        <div className="binge-scene-preview-details-wrap">
                            <p
                                ref={detailsRef}
                                className={
                                    "binge-scene-preview-details" +
                                    (detailsExpanded ? " is-expanded" : "")
                                }
                            >
                                {detailsText}
                            </p>
                            {(detailsExpanded || detailsTruncated) && (
                                <button
                                    type="button"
                                    className="binge-scene-preview-more"
                                    onClick={() =>
                                        setDetailsExpanded((v) => !v)
                                    }
                                >
                                    {detailsExpanded
                                        ? t("settings.show_less")
                                        : t("settings.show_more")}
                                </button>
                            )}
                        </div>
                    )}
                    {tags.length > 0 && (
                        <div className="binge-scene-preview-tags">
                            {tags.map((tag) => (
                                <span
                                    className="binge-scene-preview-tag"
                                    key={tag.stashId}
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {detail && index === 0 && (
                <div className="binge-scene-preview-fade" />
            )}

            {detail && index === 0 && (gallery.length > 0 || probing) && (
                <div
                    ref={countRef}
                    className="binge-scene-preview-count"
                >
                    {probing && gallery.length === 0
                        ? t("scene.gallery_probing")
                        : t("scene.gallery_count", {
                              count: gallery.length,
                          })}
                    {probing && gallery.length > 0 ? "…" : ""}
                </div>
            )}

            {index > 0 && (
                <div className="binge-lightbox-counter" aria-hidden="true">
                    {index} / {gallery.length}
                    {probing ? "…" : ""}
                </div>
            )}
        </div>,
        document.body,
    );
}

function DownloadIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
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
            <path d="M15 18l-6-6 6-6" />
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

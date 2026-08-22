import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

interface DragPagingOptions {
    /** 轨道总页数（含尾板等额外 slide），翻页目标 clamp 用 */
    pageCount: number;
    /** 翻页位移阈值上限（默认 200px，实际取 min(屏宽 20%, 该值)） */
    maxThreshold?: number;
}

/**
 * 横向 scroll-snap 轨道的桌面鼠标拖拽翻页（触屏走原生滚动，不经过
 * 这里）。Lightbox 与首页图库卡片轮播共用。
 *
 * - pointerdown：取消上一次翻页挂起的 snap 恢复（否则其 scrollend/
 *   timeout 会在新拖拽进行中摘掉拖拽类，snap 立即回吸——快速连拖时
 *   图片不跟手、松手却正常翻页）、中止进行中的平滑滚动（baseline 停
 *   在两页之间会污染翻页判定）、加 is-mouse-dragging 类（CSS 禁
 *   snap + 禁 smooth，否则 mandatory snap 对每次 scrollLeft 赋值
 *   立即回吸拖不动）。
 * - pointermove：scrollLeft 跟手；位移超过 6px 确认拖拽后才
 *   setPointerCapture——按下即捕获会把松手合成的 click 的 target
 *   重定向到容器，slide 按钮的 onClick（打开灯箱/跳转）就收不到。
 * - 松手：阈值判定翻页（指针位移而非 scrollLeft 差值——后者被滚动
 *   范围钳制且受吸附影响），scrollTo 平滑滚到目标页；snap 恢复延迟
 *   到滚动落定（scrollend + timeout 兜底）——立即恢复会瞬间吸附到
 *   最近 snap 点，表现为"图片先跳回中心再滑走"。
 * - 拖拽后的松手 click 在 capture 阶段拦截，不触发 slide 的 onClick。
 */
export function useDragPaging(
    containerRef: RefObject<HTMLElement | null>,
    { pageCount, maxThreshold = 200 }: DragPagingOptions,
) {
    const stateRef = useRef<{
        startX: number;
        startScroll: number;
        pointerId: number;
    } | null>(null);
    const didDragRef = useRef(false);
    // 挂起的 snap 恢复的取消函数（clearTimeout + 摘除 scrollend）。
    const cancelRestoreRef = useRef<(() => void) | null>(null);

    const onPointerDown = (e: ReactPointerEvent) => {
        if (e.pointerType !== "mouse") return;
        const el = containerRef.current;
        if (!el) return;
        // 先取消挂起的恢复，再中止平滑滚动——顺序不能反：
        // scrollTo(auto) 中断动画会触发 scrollend，若恢复监听还
        // 在，会立即摘掉刚要开始的拖拽的拖拽类。
        cancelRestoreRef.current?.();
        cancelRestoreRef.current = null;
        // 程序化 auto 滚动按规范取消进行中的平滑滚动。
        el.scrollTo({ left: el.scrollLeft, behavior: "auto" });
        stateRef.current = {
            startX: e.clientX,
            startScroll: el.scrollLeft,
            pointerId: e.pointerId,
        };
        didDragRef.current = false;
        el.classList.add("is-mouse-dragging");
        // 此处不 setPointerCapture（延迟到确认拖拽，见 onMove）。
    };

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const scheduleSnapRestore = () => {
            let done = false;
            const restore = () => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                el.removeEventListener("scrollend", restore);
                if (cancelRestoreRef.current === cancel) {
                    cancelRestoreRef.current = null;
                }
                el.classList.remove("is-mouse-dragging");
            };
            const cancel = () => {
                if (done) return;
                done = true;
                window.clearTimeout(timer);
                el.removeEventListener("scrollend", restore);
                if (cancelRestoreRef.current === cancel) {
                    cancelRestoreRef.current = null;
                }
            };
            // Safari 无 scrollend，700ms 覆盖一屏 smooth 滚动时长。
            const timer = window.setTimeout(restore, 700);
            el.addEventListener("scrollend", restore);
            cancelRestoreRef.current = cancel;
        };

        const endDrag = (endX: number) => {
            const d = stateRef.current;
            stateRef.current = null;
            if (!d) return;
            const slide = el.clientWidth;
            if (slide <= 0) {
                el.classList.remove("is-mouse-dragging");
                return;
            }
            const startPage = Math.round(d.startScroll / slide);
            const displacement = d.startX - endX;
            const threshold = Math.min(slide * 0.2, maxThreshold);
            let target = startPage;
            if (displacement > threshold) target = startPage + 1;
            else if (displacement < -threshold) target = startPage - 1;
            target = Math.min(Math.max(target, 0), pageCount - 1);
            el.scrollTo({ left: target * slide, behavior: "smooth" });
            scheduleSnapRestore();
        };

        const onMove = (e: PointerEvent) => {
            const d = stateRef.current;
            if (!d || e.pointerType !== "mouse") return;
            // 按钮已松开但 pointerup 丢失（拖出浏览器窗口外释放后
            // 返回）：按松手处理，防止拖拽状态悬挂。
            if (e.buttons === 0) {
                endDrag(e.clientX);
                return;
            }
            const dx = e.clientX - d.startX;
            if (!didDragRef.current && Math.abs(dx) > 6) {
                didDragRef.current = true;
                // 确认拖拽后才捕获指针：拖到窗口外/经过子元素也不丢
                // 事件。按下即捕获会把后续 pointer 事件（含松手合成
                // 的 click）重定向到容器，slide 按钮的 onClick 就收
                // 不到了。
                try {
                    el.setPointerCapture(d.pointerId);
                } catch {
                    /* 老浏览器忽略，document 监听兜底 */
                }
            }
            el.scrollLeft = d.startScroll - dx;
        };
        const onUp = (e: PointerEvent) => {
            if (e.pointerType !== "mouse") return;
            endDrag(e.clientX);
        };
        const onCancel = () => {
            // pointercancel 的坐标不可信：按零位移回弹到起点最近页。
            const d = stateRef.current;
            endDrag(d ? d.startX : 0);
        };
        const onClickCapture = (e: MouseEvent) => {
            if (!didDragRef.current) return;
            e.stopPropagation();
            e.preventDefault();
            didDragRef.current = false;
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
        el.addEventListener("click", onClickCapture, true);
        return () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("pointercancel", onCancel);
            el.removeEventListener("click", onClickCapture, true);
            el.classList.remove("is-mouse-dragging");
        };
    }, [containerRef, pageCount, maxThreshold]);

    return { onPointerDown };
}

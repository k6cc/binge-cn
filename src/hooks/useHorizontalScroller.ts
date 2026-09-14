import { useCallback, useEffect, useState } from "react";

// 横向滚动条（故事栏 / 演员发现条 / 标签 chips）的公共行为：
// 左右 chevron 的显隐 + 轻刷新后滚动位置归零。
//
// Chrome 的 scroll restoration 会把上次会话的横向 scrollLeft 写回
// 子容器：写入会派发 scroll 事件、时机不定（数据落地后数秒内都可
// 能），history.scrollRestoration = 'manual' 对子容器无效，固定短
// 窗口（如 600ms）压不住。因此改为 rAF 轮询：挂载/子元素变化后，
// 持续把非零 scrollLeft 压回最左；Chrome 的恢复值写进来后下一帧
// 即被压回。
//
// "用户真正在滚"不能用 scroll 事件判别——恢复写入同样派发 scroll
// 事件（实证：轻刷新后容器收到的第一个 scroll 事件即恢复写入本
// 身）。改用输入事件：触摸/滚轮/键盘/点击必然先行，而浏览器的恢
// 复写入不伴随任何输入。输入仅在容器已可滚动（数据已落地）时才
// 解除压制——数据未到时的点击/滚动与恢复写入无关，提前解除会让
// "先点了下页面、数据后到"的时序放走恢复值。8 秒超时兜底。
//
// 绑定跟随真实 DOM 节点：渐进渲染（如 lookback 变化）中 React 可
// 能整体重建滚动容器 div——ref object 不会通知重建，effect 会抱
// 着脱离文档的旧节点。改用回调 ref + state 化节点：div 重建时
// node 变化驱动 effect 重跑，监听（mo/RO/scroll/压制）重新绑定到
// 新节点，chevron 显隐也随之重算。
//
// @param deps 重建监听的依赖（通常为数据加载状态），与节点变化一
//             起触发 effect 重跑。
export function useHorizontalScroller(deps: unknown[]) {
    const [node, setNode] = useState<HTMLDivElement | null>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    // 回调 ref：div 挂载 / 卸载 / 被 React 重建时都会被调用。
    const scrollerRef = useCallback((el: HTMLDivElement | null) => {
        setNode(el);
    }, []);
    // 容器可能被 React 重建，组件不能再持 ref.current——通过此方
    // 法滚动，始终作用于当前节点。
    const scrollBy = useCallback(
        (opts: { left: number; behavior?: ScrollBehavior }) => {
            node?.scrollBy(opts);
        },
        [node]
    );

    useEffect(() => {
        const el = node;
        if (!el) return;

        const reset = () => {
            // 覆写 inline scroll-behavior 绕过容器上的 CSS smooth
            //（演员发现条是 smooth），保证压回写入瞬时生效。
            const prev = el.style.scrollBehavior;
            el.style.scrollBehavior = "auto";
            el.scrollLeft = 0;
            el.style.scrollBehavior = prev;
        };
        const update = () => {
            const max = el.scrollWidth - el.clientWidth;
            setCanScrollLeft(el.scrollLeft > 4);
            setCanScrollRight(el.scrollLeft < max - 4);
        };

        reset();
        update();

        let raf = 0;
        let deadline = 0;
        let stopped = false;
        const pin = () => {
            if (stopped) return;
            if (el.scrollLeft !== 0) {
                reset();
                update();
            }
            if (performance.now() < deadline) {
                raf = requestAnimationFrame(pin);
            }
        };
        const arm = () => {
            deadline = performance.now() + 8000;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(pin);
        };
        arm();
        // children 增删（数据替换，如 lookback 窗口变化）时 chevron
        // 显隐必须重算：effect 的 deps 只有加载状态，设置变化不会
        // 重跑 effect；而 pin 只在 scrollLeft 非零时才顺带 update。
        const mo = new MutationObserver(() => {
            update();
            arm();
        });
        mo.observe(el, { childList: true });

        // scroll 事件（包括恢复写入派发的那个）只用于 chevron 显
        // 隐；解除压制只认真实输入。
        const inputTypes = [
            "pointerdown",
            "wheel",
            "touchstart",
            "keydown",
        ] as const;
        const inputOpts = {
            capture: true,
            passive: true,
        } as AddEventListenerOptions;
        const onInput = () => {
            if (el.scrollWidth > el.clientWidth + 4) stopped = true;
        };
        for (const type of inputTypes) {
            document.addEventListener(type, onInput, inputOpts);
        }

        const onScroll = () => update();
        el.addEventListener("scroll", onScroll, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);

        return () => {
            stopped = true;
            cancelAnimationFrame(raf);
            mo.disconnect();
            for (const type of inputTypes) {
                document.removeEventListener(type, onInput, inputOpts);
            }
            el.removeEventListener("scroll", onScroll);
            ro.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node, ...deps]);

    return { scrollerRef, scrollBy, canScrollLeft, canScrollRight };
}

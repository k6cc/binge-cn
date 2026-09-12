import { useEffect, useState, type RefObject } from "react";

// Shared scroll-to-top logic: tracks whether the scroll container has
// moved past one viewport height, and exposes a near-smooth / far-instant
// scroll-to-top. Used by Home / Following / Explore.
export function useScrollToTop(
    scrollRef: RefObject<HTMLDivElement | null>
) {
    const [show, setShow] = useState(false);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => {
            setShow(el.scrollTop > el.clientHeight);
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, [scrollRef]);

    const scrollToTop = () => {
        const el = scrollRef.current;
        if (!el) return;
        // 近距平滑；远距瞬时——平滑动画会与虚拟列表的动态测量竞态
        // （沿途挂载新卡片 → 图片加载 → 布局位移 → 动画停在中途），
        // 瞬时跳转无"途中"，坐标系漂移不影响终态 scrollTop=0。
        const far = el.scrollTop > el.clientHeight * 2;
        el.scrollTo({ top: 0, behavior: far ? "instant" : "smooth" });
    };

    return { show, scrollToTop };
}

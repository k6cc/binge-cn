import { useEffect, useState, type RefObject } from "react";

// Shared scroll-to-top logic: tracks whether the scroll container has
// moved past one viewport height, and exposes a smooth-scroll-to-top.
// Used by Home / Following / Explore.
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
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    return { show, scrollToTop };
}

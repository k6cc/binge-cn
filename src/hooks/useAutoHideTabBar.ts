import { useEffect, useRef, type RefObject } from "react";
import { useTab } from "../tabs/TabContext";

// Shared scroll handler that drives the top tab/header auto-hide on
// every scrollable tab surface. Behaviour:
//
//   - Within 80px of the top → always shown.
//   - Scrolled DOWN past 80px → hidden.
//   - Scrolled UP at all (past the deadzone) → shown immediately,
//     wherever in the page you are.
//
// 5px deadzone on both directions filters out iOS rubber-band wobble
// and sub-pixel events that would otherwise flicker the bar.

const NEAR_TOP_PX = 80;
const DELTA_DEADZONE_PX = 5;

export function useAutoHideTabBar(
    scrollRef: RefObject<HTMLElement | null>,
    // 程序产生的滚动抑制开关：置 true 期间忽略 scroll 事件（用于
    // 全屏退出的位置校正——scrollToIndex 产生的"向下滚动"不该触发
    // 导航自动隐藏，否则出现"先隐藏再弹出"的闪烁）。
    suppressRef?: RefObject<boolean>,
): void {
    const { setTabBarVisible } = useTab();
    const lastScrollTopRef = useRef(0);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const handler = () => {
            if (suppressRef?.current) return;
            const current = el.scrollTop;
            const delta = current - lastScrollTopRef.current;
            lastScrollTopRef.current = current;
            if (current < NEAR_TOP_PX) {
                setTabBarVisible(true);
                return;
            }
            if (delta > DELTA_DEADZONE_PX) {
                setTabBarVisible(false);
            } else if (delta < -DELTA_DEADZONE_PX) {
                setTabBarVisible(true);
            }
        };
        // Prime the state to match the current scroll position on mount.
        lastScrollTopRef.current = el.scrollTop;
        handler();
        el.addEventListener("scroll", handler, { passive: true });
        return () => el.removeEventListener("scroll", handler);
    }, [scrollRef, setTabBarVisible, suppressRef]);
}

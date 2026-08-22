import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { StoriesRow } from "../home/StoriesRow";
import { Feed } from "../home/Feed";
import { FeedFilterMenu } from "../home/FeedFilterMenu";
import { useSharedStories } from "../home/StoriesContext";
import { useAutoHideTabBar } from "../hooks/useAutoHideTabBar";
import { useScrollToTop } from "../hooks/useScrollToTop";
import { ScrollTopButton } from "../components/ScrollTopButton";
import { useTab } from "./TabContext";

export function Home() {
    const scrollRef = useRef<HTMLDivElement>(null);
    useAutoHideTabBar(scrollRef);
    const stories = useSharedStories();
    const { t } = useTranslation();
    const { show: showScrollTop, scrollToTop } = useScrollToTop(scrollRef);
    const { tab } = useTab();

    // 切走保存、切回恢复滚动位置。Home 标签页用 display:none 隐藏（不
    // 卸载），Chrome 对 display:none 元素的 scrollTop 恢复行为不稳定，
    // 且虚拟列表在隐藏→恢复的过渡期可能短暂塌陷触发 clamp——显式保
    // 存/恢复保证切回时停在离开时的位置（配合 Feed.tsx 的测量冻结，
    // 卡片尺寸缓存不被清零，恢复后布局与切走前逐像素一致）。
    // rAF：等 display:block 布局生效后再写 scrollTop；若浏览器已自行
    // 恢复到相同值则赋值为幂等 no-op。
    const savedScrollRef = useRef(0);
    const prevTabRef = useRef(tab);
    useEffect(() => {
        const leaving =
            prevTabRef.current === "home" && tab !== "home";
        const returning =
            prevTabRef.current !== "home" && tab === "home";
        prevTabRef.current = tab;
        const el = scrollRef.current;
        if (!el) return;
        if (leaving) {
            savedScrollRef.current = el.scrollTop;
        } else if (returning && savedScrollRef.current > 0) {
            const top = savedScrollRef.current;
            const raf = requestAnimationFrame(() => {
                const cur = scrollRef.current;
                if (cur) cur.scrollTop = top;
            });
            return () => cancelAnimationFrame(raf);
        }
    }, [tab]);

    return (
        <div className="binge-tab-scroll" ref={scrollRef}>
            <div className="binge-tab-inner">
                <div className="binge-tab-title-row">
                    <div className="binge-tab-title-group">
                        <h1 className="binge-tab-title">{t("nav.home")}</h1>
                        <FeedFilterMenu />
                    </div>
                    <button
                        type="button"
                        className={
                            "binge-stories-refresh" +
                            (stories.refreshing ? " is-refreshing" : "")
                        }
                        onClick={stories.refresh}
                        disabled={stories.refreshing}
                        aria-label={t("action.refresh_story")}
                        title={t("action.refresh_story")}
                    >
                        <RefreshIcon />
                    </button>
                </div>
                <StoriesRow stories={stories} />
                <Feed scrollContainerRef={scrollRef} />
            </div>
            {showScrollTop && <ScrollTopButton onClick={scrollToTop} />}
        </div>
    );
}

function RefreshIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 12C21 16.9706 16.9706 21 12 21C9.69494 21 7.59227 20.1334 6 18.7083L3 16M3 12C3 7.02944 7.02944 3 12 3C14.3051 3 16.4077 3.86656 18 5.29168L21 8M3 21V16M3 16H8M21 3V8M21 8H16" />
        </svg>
    );
}

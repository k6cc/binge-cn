import { useTranslation } from "react-i18next";
import { useTab, type Tab } from "./TabContext";

// Instagram-style top nav: floating white text, no chrome. Active tab is
// full-opacity bold + subtle underline; inactive is ~60% white. Lives
// inside .binge-top-header which owns the shared gradient + auto-hide
// transform — so this component itself has no fixed positioning.
export function TabBar() {
    const { tab, setTab } = useTab();
    const { t } = useTranslation();

    const TABS: { id: Tab; label: string }[] = [
        { id: "home", label: t("nav.home", "首页") },
        { id: "following", label: t("nav.following", "关注中") },
        { id: "foryou", label: t("nav.foryou", "推荐") },
        { id: "explore", label: t("nav.explore", "发现") },
    ];

    return (
        <nav className="binge-tabbar" role="tablist" aria-label={t("nav.sections", "Reel 分区")}>
            {TABS.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={
                        "binge-tabbar-link" +
                        (tab === t.id ? " is-active" : "")
                    }
                    onClick={() => setTab(t.id)}
                >
                    {t.label}
                </button>
            ))}
        </nav>
    );
}

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
        { id: "home", label: t("nav.home") },
        { id: "following", label: t("nav.following") },
        { id: "foryou", label: t("nav.foryou") },
        { id: "explore", label: t("nav.explore") },
    ];

    return (
        <nav className="binge-tabbar" role="tablist" aria-label={t("nav.sections")}>
            {TABS.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.id}
                    className={
                        "binge-tabbar-link" + (tab === t.id ? " is-active" : "")
                    }
                    onClick={() => setTab(t.id)}
                >
                    {t.label}
                </button>
            ))}
        </nav>
    );
}

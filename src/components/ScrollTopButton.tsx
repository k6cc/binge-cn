import { useTranslation } from "react-i18next";

// Shared scroll-to-top FAB. Positioned fixed at bottom-right via
// .binge-scroll-top CSS; lifts above mobile bottom nav via :has().
export function ScrollTopButton({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="binge-scroll-top"
            onClick={onClick}
            aria-label={t("action.scroll_to_top")}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
        </button>
    );
}

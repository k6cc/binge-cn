import i18n from "../i18n/config";

// Short relative-time formatter matching IG's compact style, localised
// Used in the story header next to the performer name.
// Returns "刚刚" for sub-minute distances; gracefully handles future
// timestamps by reporting them as "刚刚" too rather than negative values.
export function timeAgo(iso: string): string {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return "";
    const diffMs = Date.now() - then;

    if (i18n.language === "en") {
        if (diffMs < 60_000) return "now";
        const minutes = Math.floor(diffMs / 60_000);
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d`;
        const weeks = Math.floor(days / 7);
        if (weeks < 5) return `${weeks}w`;
        const months = Math.floor(days / 30);
        if (months < 12) return `${months}mo`;
        const years = Math.floor(days / 365);
        return `${years}y`;
    } else {
        const t = i18n.t;
        if (diffMs < 60_000) return t("time.just_now");
        const minutes = Math.floor(diffMs / 60_000);
        if (minutes < 60) return t("time.minutes_ago", { count: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t("time.hours_ago", { count: hours });
        const days = Math.floor(hours / 24);
        if (days < 7) return t("time.days_ago", { count: days });
        const weeks = Math.floor(days / 7);
        if (weeks < 5) return t("time.weeks_ago", { count: weeks });
        const months = Math.floor(days / 30);
        if (months < 12) return t("time.months_ago", { count: months });
        const years = Math.floor(days / 365);
        return t("time.years_ago", { count: years });
    }
}

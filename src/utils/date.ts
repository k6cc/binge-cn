import type { i18n as I18nInstance } from "i18next";

export function formatDuration(seconds: number | null): string {
    if (seconds === null) return "";
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${m}:${pad(s)}`;
}

function pad(n: number): string {
    return n.toString().padStart(2, "0");
}

export function formatDate(raw: string | null, i18n: I18nInstance): string {
    if (!raw) return "";
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";

    if (i18n.language === "en") {
        const months = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ];
        const monthIdx = Math.max(0, Math.min(11, Number(m[2]) - 1));
        const day = Number(m[3]);
        return `${day} ${months[monthIdx]} ${m[1]}`;
    } else {
        const month = Number(m[2]);
        const day = Number(m[3]);
        return `${m[1]}年${month}月${day}日`;
    }
}

// 本地日历日期（YYYY-MM-DD）。new Date().toISOString() 返回的是 UTC 日期，
// 在 UTC+8 等时区每天 0–8 点会滞后一天；凡"今天 / 最近 N 天 / +N 天窗口"
// 这类日历语义必须用本地日期，而不是 UTC 日期前缀，否则今天的内容会被
// 误判成未来（如"预告沉底"把当天的卡片沉到底部）。
export function localDateStr(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

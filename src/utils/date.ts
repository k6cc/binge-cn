
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

export function formatDate(raw: string | null, i18n: any): string {
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

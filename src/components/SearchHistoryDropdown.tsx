import { useTranslation } from "react-i18next";

interface SearchHistoryDropdownProps {
    history: string[];
    query: string;
    onPick: (term: string) => void;
    onRemove: (term: string) => void;
}

// 搜索历史下拉框：输入框聚焦时显示，点击条目填充输入框。
//
// 芯片样式：每个关键词一个圆角框，横向排列自动换行。关键词最多显示
// MAX_LABEL_CHARS 个字符（中英文数字统按 1 计），超出省略，尾部 × 删除。
// 用 onMouseDown + preventDefault 阻止输入框 blur。
const MAX_LABEL_CHARS = 12;

function truncateLabel(s: string): string {
    return s.length > MAX_LABEL_CHARS
        ? s.slice(0, MAX_LABEL_CHARS) + "…"
        : s;
}

export function SearchHistoryDropdown({
    history,
    query,
    onPick,
    onRemove,
}: SearchHistoryDropdownProps) {
    const { t } = useTranslation();
    const q = query.trim().toLowerCase();
    const items = q
        ? history.filter((s) => s.toLowerCase().includes(q))
        : history;
    if (items.length === 0) return null;
    return (
        <div className="binge-search-history" role="listbox">
            {items.map((term) => (
                <button
                    key={term}
                    type="button"
                    className="binge-search-history-chip"
                    role="option"
                    aria-label={t("action.use_history_search", "使用历史搜索 {{term}}", { term })}
                    title={term}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onPick(term);
                    }}
                >
                    <span className="binge-search-history-chip-text">
                        {truncateLabel(term)}
                    </span>
                    <span
                        className="binge-search-history-chip-remove"
                        role="button"
                        aria-label={t("action.remove_term", "移除 {{term}}", { term })}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemove(term);
                        }}
                    >
                        ×
                    </span>
                </button>
            ))}
        </div>
    );
}

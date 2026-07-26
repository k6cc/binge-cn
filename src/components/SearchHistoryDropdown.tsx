interface SearchHistoryDropdownProps {
    history: string[];
    query: string;
    onPick: (term: string) => void;
    onRemove: (term: string) => void;
}

// 搜索历史下拉框：输入框聚焦时显示，点击条目填充输入框。
//
// 用 onMouseDown + preventDefault 阻止输入框 blur，避免需要 setTimeout
// 延迟隐藏。条目按当前输入文本过滤（大小写不敏感包含匹配）。
export function SearchHistoryDropdown({
    history,
    query,
    onPick,
    onRemove,
}: SearchHistoryDropdownProps) {
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
                    className="binge-search-history-item"
                    role="option"
                    aria-label={`使用历史搜索 ${term}`}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onPick(term);
                    }}
                >
                    <span
                        className="binge-search-history-icon"
                        aria-hidden="true"
                    >
                        ⟳
                    </span>
                    <span className="binge-search-history-text">{term}</span>
                    <span
                        className="binge-search-history-remove"
                        role="button"
                        aria-label={`移除 ${term}`}
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

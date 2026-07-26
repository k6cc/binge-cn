import { useCallback, useState } from "react";

// 搜索历史持久化到 localStorage。
//
// 每个 namespace 独立存储（"scenes" / "performers"），互不干扰。
// key: binge.searchHistory.<namespace>，value: JSON string[]。
//
// 去重（大小写不敏感）+ 最多 MAX_ITEMS 条，最近在前。
// 组件卸载或 localStorage 不可用时不抛错，静默降级。
const MAX_ITEMS = 8;
const MIN_LENGTH = 2;

export function useSearchHistory(namespace: string): {
    history: string[];
    addEntry: (term: string) => void;
    removeEntry: (term: string) => void;
} {
    const storageKey = `binge.searchHistory.${namespace}`;
    const [history, setHistory] = useState<string[]>(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            const parsed = raw ? (JSON.parse(raw) as unknown) : null;
            return Array.isArray(parsed) ? (parsed as string[]) : [];
        } catch {
            return [];
        }
    });

    const write = (next: string[]) => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
            /* quota / privacy mode — 静默降级 */
        }
    };

    const addEntry = useCallback(
        (term: string) => {
            const trimmed = term.trim();
            if (trimmed.length < MIN_LENGTH) return;
            setHistory((prev) => {
                const lower = trimmed.toLowerCase();
                const filtered = prev.filter(
                    (s) => s.toLowerCase() !== lower
                );
                const next = [trimmed, ...filtered].slice(0, MAX_ITEMS);
                write(next);
                return next;
            });
        },
        // storageKey 是稳定的字符串字面量拼接，无需作为依赖
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const removeEntry = useCallback(
        (term: string) => {
            setHistory((prev) => {
                const next = prev.filter((s) => s !== term);
                write(next);
                return next;
            });
        },
        []
    );

    return { history, addEntry, removeEntry };
}

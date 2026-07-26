import { useCallback, useEffect, useRef, useState } from "react";

// 搜索历史持久化到 localStorage。
//
// 每个 namespace 独立存储（"scenes" / "performers"），互不干扰。
// key: binge.searchHistory.<namespace>，value: JSON string[]。
//
// 去重（大小写不敏感）+ 最多 MAX_ITEMS 条，最近在前。
// 组件卸载或 localStorage 不可用时不抛错，静默降级。
//
// 提供 scheduleSave(term) debounce 保存：用户输入过程中 800ms 无变化
// 则保存。比 onBlur 更可靠——用户搜索后点击演员卡片会触发路由切换
// 和组件卸载，onBlur 可能来不及触发，debounce 在输入过程中就保存了。
const MAX_ITEMS = 20;
const MIN_LENGTH = 2;
const SAVE_DEBOUNCE_MS = 800;

export function useSearchHistory(namespace: string): {
    history: string[];
    addEntry: (term: string) => void;
    removeEntry: (term: string) => void;
    scheduleSave: (term: string) => void;
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

    // Debounce 保存：输入过程中 800ms 无变化则保存。组件卸载时若有
    // pending 保存立即执行（useEffect cleanup）。
    const timerRef = useRef<number | null>(null);
    const pendingRef = useRef<string>("");

    const scheduleSave = useCallback((term: string) => {
        pendingRef.current = term;
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
            addEntry(pendingRef.current);
            timerRef.current = null;
        }, SAVE_DEBOUNCE_MS);
    }, [addEntry]);

    // 卸载时若有 pending 保存立即执行
    useEffect(() => {
        return () => {
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                addEntry(pendingRef.current);
            }
        };
    }, [addEntry]);

    return { history, addEntry, removeEntry, scheduleSave };
}

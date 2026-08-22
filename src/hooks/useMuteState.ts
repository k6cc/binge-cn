import { useCallback, useState } from "react";

// 每个播放表面独立的双层静音状态。
//
// `persisted` 是用户陈述的偏好（localStorage，跨会话）。`effective`（组件
// state）是当前表面实际应用的状态——浏览器拦截未静音自动播放时降级为
// 静音：图标立即反映现实，但不写偏好，后续新挂载的表面仍按偏好尝试。
// 这修掉"图标显示开启、视频仍静音"的错位（自动播放降级只改 effective，
// 用户一次点击同时写偏好 + 本表面，无二次点击）。
//
// 撤销联动：原实现是模块级单例 + 全局 listeners，所有表面共享
// effective——切一个静音按钮会实时同步到所有正在播放的窗口，导致
// story 弹窗与底层 feed 同时出声。现在各表面独立持有状态：切换只
// 影响自己；新挂载的表面从持久化偏好初始化（不重复开声音），配合
// 播放层栈（playbackStack.ts）在覆盖层打开时暂停下层，杜绝两个声音。
const MUTE_KEY = "binge.muted";
const DEFAULT_MUTED = false;

function readPersisted(): boolean {
    try {
        const raw = localStorage.getItem(MUTE_KEY);
        if (raw === "false") return false;
        if (raw === "true") return true;
    } catch {
        /* private mode */
    }
    return DEFAULT_MUTED;
}

let persisted = readPersisted();

export function getPersistedMuted(): boolean {
    return persisted;
}

export function useMuteState(): [
    boolean,
    (next: boolean) => void,
    (next: boolean) => void,
] {
    const [muted, setMutedState] = useState<boolean>(persisted);
    // 用户点击：写偏好 + 本表面。
    const setMuted = useCallback((next: boolean) => {
        persisted = next;
        setMutedState(next);
        try {
            localStorage.setItem(MUTE_KEY, String(next));
        } catch {
            /* ignore */
        }
    }, []);
    // 自动播放降级：仅改本表面的图标/状态，不动持久化偏好。
    const setMutedSession = useCallback((next: boolean) => {
        setMutedState(next);
    }, []);
    return [muted, setMuted, setMutedSession];
}

import { useCallback, useEffect, useState } from "react";

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
//
// 偏好同步：各表面独立后出现"已挂载的邻近卡片不知道偏好变了"——用户
// 在一张卡片关掉声音，虚拟滚动里已挂载的邻近卡片仍是旧 state，滑过去
// 突然出声。现在 `setMuted`（用户显式点击）派发 binge:mute-change 事件，
// 所有已挂载实例同步 React state（`muted={muted}` 绑定 video 立即生效）；
// `setMutedSession`（自动播放降级）仍是表面局部的临时状态，不广播——
// 否则回归最初的联动问题（一个表面被降级、其他表面图标全变）。
const MUTE_KEY = "binge.muted";
const MUTE_EVENT = "binge:mute-change";
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

    // 同窗口内其他表面的用户显式切换：同步本表面的 effective。
    // 模块级 persisted 已由发起方更新，这里只跟 React state。
    useEffect(() => {
        const onExternalChange = (e: Event) => {
            setMutedState((e as CustomEvent<boolean>).detail);
        };
        window.addEventListener(MUTE_EVENT, onExternalChange);
        return () => window.removeEventListener(MUTE_EVENT, onExternalChange);
    }, []);

    // 用户点击：写偏好 + 本表面，并广播给所有已挂载表面。
    const setMuted = useCallback((next: boolean) => {
        persisted = next;
        setMutedState(next);
        try {
            localStorage.setItem(MUTE_KEY, String(next));
        } catch {
            /* ignore */
        }
        window.dispatchEvent(new CustomEvent(MUTE_EVENT, { detail: next }));
    }, []);
    // 自动播放降级：仅改本表面的图标/状态，不动持久化偏好，不广播。
    const setMutedSession = useCallback((next: boolean) => {
        setMutedState(next);
    }, []);
    return [muted, setMuted, setMutedSession];
}

// 播放层栈：跟踪当前打开的覆盖层（story 弹窗 / 演员详情 / PH 播放器），
// 保证任一时刻只有一层出声。
//
// 视觉堆叠顺序（z-index）：story viewer(120) / PH 播放器(120) >
// 演员详情(90) > 底层（首页 feed 卡片、reel）。数字越大越靠上。
//
// 规则：
// - 更高层打开时，下层视频表面暂停（各表面订阅 gate 变化自行暂停），
//   且在其打开期间拒绝自动播放（play 路径检查 isPlaybackGated）。
// - 覆盖层关闭后下层不自动恢复——用户点击播放再出声，避免惊吓，
//   也免去记录/恢复每个表面的播放前状态。
// - 从演员详情里打开 story 弹窗是合法叠放（story 在上），此时演员
//   详情里的悬停预览同样被 gate（isPlaybackGated 按层号比较）。

export const PLAYBACK_LAYER = {
    /** 首页 feed 卡片、reel——无覆盖层。 */
    base: 0,
    /** 演员详情覆盖层（PerformerProfile，z:90）。 */
    profile: 1,
    /** 头像 story 弹窗（StoryViewer，z:120）。 */
    story: 2,
    /** PH 内联播放器（PornhubPlayer，z:120）。 */
    phPlayer: 3,
} as const;

type Listener = () => void;

const layers: number[] = [];
const listeners = new Set<Listener>();

function notify() {
    listeners.forEach((l) => l());
}

/** 覆盖层打开时调用；重复打开同一层幂等。 */
export function openPlaybackLayer(layer: number) {
    if (layers.includes(layer)) return;
    layers.push(layer);
    notify();
}

/** 覆盖层关闭时调用。 */
export function closePlaybackLayer(layer: number) {
    const i = layers.lastIndexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    notify();
}

/** 我的表面此刻是否被更高的覆盖层压住（压住 → 暂停/拒绝播放）。 */
export function isPlaybackGated(myLayer: number) {
    return layers.some((l) => l > myLayer);
}

/** 订阅层栈变化（打开/关闭覆盖层时回调）。返回取消函数。 */
export function subscribePlaybackGate(fn: Listener) {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

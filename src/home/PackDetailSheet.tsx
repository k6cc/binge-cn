import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PackFeedItem, SceneFeedItem } from "./useFeed";
import { useTab } from "../tabs/TabContext";
import { useFilter } from "../filter/FilterContext";
import { useTranslation } from "react-i18next";

// Fullscreen sheet shown when the user taps a Pack feed card.
// Lists every scene in the pack as a 3-column grid; tapping a
// tile drops into the For You reel pre-pinned to that scene with
// the pack's scene set queued behind it.
//
// Portalled to <body> for the same z-index reasons SaveSheet and
// PerformerSheet use — the parent feed has its own stacking
// context that would otherwise cap the sheet beneath the action
// stack.
//
// 需求1：
//   - 二层封面调整为 3:4 竖屏，右对齐，底部叠加标题（类似图库封面）。
//   - 进入 reel 时同步把主演作为 performer 筛选 chip 写进 FilterContext，
//     这样 FilterBar（带头像名字×）和 FilterSheet 都能显示当前生效的
//     筛选条件，用户可以一键 × 清除。queue 仍负责有序播放整包场景，
//     filter 仅作可视指示（queue 路径在 Reel 中优先级高于 filter）。
export function PackDetailSheet({
    pack,
    onClose,
}: {
    pack: PackFeedItem;
    onClose: () => void;
}) {
    const { setTab, setPinFirstSceneId } = useTab();
    const { replace } = useFilter();
    const { t } = useTranslation();

    // Esc dismisses on desktop — matches the rest of the sheets.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onClose]);

    const handlePick = (scene: SceneFeedItem) => {
        // Bug 修复（需求1）：原先 setPinnedQueue 走 queue 路径，会按
        // pack.scenes 顺序播放整包 26 个场景，滚动一次就到第二个 →
        // 用户以为"错误跳转演员其他影片"。改为 setPinFirstSceneId 走
        // random 路径，只 pin 点击的场景到第一位，后续走演员 filter
        // 的随机推荐（与 SceneFeedCard.handleWatchFullScene 一致）。
        // 把主演作为筛选 chip 写入 FilterContext，让 FilterBar 显示。
        const p = pack.primaryPerformer;
        replace({
            performers: [
                {
                    id: p.id,
                    name: p.name,
                    image_path: p.imagePath ?? null,
                },
            ],
            tags: [],
            studios: [],
        });
        // Bug 5 修复：setTab 会清除 pin/queue，因此 setPinFirstSceneId
        // 必须在 setTab 之后调用，利用 React 18 批处理"后写胜"语义。
        setTab("foryou");
        setPinFirstSceneId(scene.sceneId);
        onClose();
    };

    return createPortal(
        <div className="binge-sheet-root">
            <div className="binge-sheet-backdrop" onClick={onClose} />
            <div
                className="binge-sheet binge-pack-sheet"
                role="dialog"
                aria-label={t("action.pack_aria_label", { name: pack.primaryPerformer.name })}
            >
                <div className="binge-sheet-handle" aria-hidden="true" />
                <header className="binge-pack-sheet-header">
                    <div className="binge-pack-sheet-title">
                        {pack.primaryPerformer.name}
                    </div>
                    <div className="binge-pack-sheet-sub">
                        {t("story.new_scenes_count", { count: pack.sceneCount })}
                    </div>
                </header>
                <div className="binge-pack-sheet-grid">
                    {pack.scenes.map((scene) => (
                        <button
                            type="button"
                            key={scene.sceneId}
                            className="binge-pack-sheet-tile"
                            onClick={() => handlePick(scene)}
                            aria-label={scene.title ?? t("action.open_scene")}
                            style={
                                scene.screenshot
                                    ? {
                                          // 引号包裹 URL：screenshot 地址含 ?t= 查询参数，
                                          // 未引号的 url() 在 CSS 规范中非法，部分浏览器
                                          // 会丢弃整条声明导致封面不显示。
                                          backgroundImage: `url("${scene.screenshot}")`,
                                      }
                                    : undefined
                            }
                        >
                            {/* 需求1：二层封面底部叠加标题（类似图库封面），
                                标题右对齐，与封面右对齐保持一致。空标题降级为
                                "未命名" 以保证视觉占位。 */}
                            <span className="binge-pack-sheet-tile-title">
                                {scene.title?.trim() || t("nav.untitled")}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
}

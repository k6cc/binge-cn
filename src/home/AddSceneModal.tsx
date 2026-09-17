import {
    useEffect,
    useRef,
    useState,
    type ChangeEvent,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
    buildSceneCreateForm,
    getStashDBSceneForCreate,
    submitSceneCreate,
    type SceneCreateForm,
} from "../api/mutations";
import type { StashDBSceneDetail } from "../api/stashdb";
import {
    contentIdFromR18Url,
    deriveContentId,
    probeDmmGallery,
} from "./dmmGallery";
import { useSheetClose } from "../hooks/useSheetClose";
import { useTranslation } from "react-i18next";

interface AddSceneModalProps {
    stashDBSceneId: string;
    fallbackTitle: string | null;
    fallbackCover: string | null;
    stashboxUrl: string;
    onCreated: (result: { id: string; title: string | null }) => void;
    onClose: () => void;
}

type ModalState =
    | { kind: "loading" }
    | {
          kind: "ready";
          form: SceneCreateForm;
          detail: StashDBSceneDetail | null;
      }
    | {
          kind: "submitting";
          form: SceneCreateForm;
          detail: StashDBSceneDetail | null;
      }
    | {
          kind: "error";
          form: SceneCreateForm;
          detail: StashDBSceneDetail | null;
          message: string;
      };

// Mirrors FollowPerformerModal but for scenes. Auto-fetches the
// StashDB scene detail on mount, presents an editable form with
// the same shape as Stash's "Create Scene" UI, and submits to
// `sceneCreate`. Performer/studio mapping happens during
// buildSceneCreateForm: stash_ids are translated to local IDs
// when those records exist in the user's library.
export function AddSceneModal({
    stashDBSceneId,
    fallbackTitle,
    fallbackCover,
    stashboxUrl,
    onCreated,
    onClose,
}: AddSceneModalProps) {
    const { isExiting, beginClose } = useSheetClose(onClose);
    const [state, setState] = useState<ModalState>({ kind: "loading" });
    const [imageIndex, setImageIndex] = useState(0);
    // 剧照预览列表（仅预览，不入库）。与首页剧照预览
    // （ScenePreviewOverlay）同一探测路径，见下方 effect。
    const [gallery, setGallery] = useState<string[]>([]);
    // 番号复制反馈：点击后图标短暂变粉（is-copied，900ms 恢复）。
    const [copied, setCopied] = useState(false);
    const copyTimer = useRef<number | null>(null);
    const { t } = useTranslation();

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") beginClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [beginClose]);

    useEffect(() => {
        let alive = true;
        (async () => {
            let detail: StashDBSceneDetail | null = null;
            try {
                detail = await getStashDBSceneForCreate(stashDBSceneId);
            } catch (err) {
                console.warn(
                    "[binge] getStashDBSceneForCreate failed",
                    err
                );
            }
            if (!alive) return;
            const form = await buildSceneCreateForm({
                stashDBSceneId,
                detail,
            });
            if (!alive) return;
            // Fall back to the click-source's title + cover if the
            // StashDB lookup didn't populate them.
            const finalForm: SceneCreateForm = {
                ...form,
                title: form.title || fallbackTitle || "",
                cover_image: form.cover_image || fallbackCover || "",
            };
            setState({ kind: "ready", form: finalForm, detail });
            setImageIndex(0);
        })();
        return () => {
            alive = false;
        };
    }, [stashDBSceneId, fallbackTitle, fallbackCover]);

    // 卸载时清理复制反馈定时器。
    useEffect(
        () => () => {
            if (copyTimer.current !== null) {
                window.clearTimeout(copyTimer.current);
            }
        },
        [],
    );

    // 剧照仅预览：与首页剧照预览同路径——从 detail.urls 找 r18.dev
    // 链接提取 contentId，probeDmmGallery 双通道探测（r18.dev JSON
    // 端点 + 穷举回退）。结果只进 previewImages 供翻页浏览；提交时
    // cover_image 仍用原 StashDB 封面，预览剧照不写入库。探测结果
    // 会话级缓存（dmmGallery 内部），重开弹窗秒进。
    // 注意：依赖 sceneDetail 引用（updateField/submitting 都保留
    // prev.detail），detail 首次加载完成时只探测一次。
    const sceneDetail =
        state.kind === "loading" ? null : state.detail;
    useEffect(() => {
        const d = sceneDetail;
        if (!d) return;
        let alive = true;
        (async () => {
            try {
                const r18Url = d.urls.find((u) =>
                    u.url.includes("r18.dev"),
                );
                if (!r18Url) return;
                const contentId =
                    contentIdFromR18Url(r18Url.url) ??
                    deriveContentId(d.code);
                if (!contentId) return;
                // 首次探测经 onImage 渐进追加；resolve 值是完整序列，
                // 结尾覆盖一次以覆盖会话缓存命中场景（缓存命中不触
                // 发回调）。
                const found = await probeDmmGallery(contentId, (url) => {
                    if (alive) setGallery((prev) => [...prev, url]);
                });
                if (alive) setGallery(found);
            } catch (err) {
                // 探测失败静默降级：只保留封面可看，控制台留线索。
                console.warn("[binge] add-scene gallery load failed", err);
            }
        })();
        return () => {
            alive = false;
        };
    }, [sceneDetail]);

    const updateField = <K extends keyof SceneCreateForm>(
        key: K,
        value: SceneCreateForm[K]
    ) => {
        setState((prev) => {
            if (prev.kind !== "ready" && prev.kind !== "error") return prev;
            return {
                kind: "ready",
                form: { ...prev.form, [key]: value },
                detail: prev.detail,
            };
        });
    };

    // 一键复制番号：navigator.clipboard 优先，失败降级 execCommand
    // （非安全上下文）；成功后图标短暂变粉。
    const handleCopyCode = async () => {
        const code = state.kind === "loading" ? "" : state.form.code;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
        } catch {
            const ta = document.createElement("textarea");
            ta.value = code;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
        }
        setCopied(true);
        if (copyTimer.current !== null) {
            window.clearTimeout(copyTimer.current);
        }
        copyTimer.current = window.setTimeout(() => {
            setCopied(false);
            copyTimer.current = null;
        }, 900);
    };

    const handleSubmit = async () => {
        if (state.kind !== "ready") return;
        const form = state.form;
        const detail = state.detail;
        const submittedForm: SceneCreateForm = {
            ...form,
            // 剧照翻页仅预览：提交封面固定用原 StashDB 封面，
            // 不写入预览时翻到的剧照。
            cover_image: form.cover_image || "",
        };
        setState({ kind: "submitting", form: submittedForm, detail });
        try {
            const result = await submitSceneCreate(submittedForm);
            onCreated(result);
        } catch (err) {
            setState({
                kind: "error",
                form: submittedForm,
                detail,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    };

    const form = state.kind === "loading" ? null : state.form;
    const detail = state.kind === "loading" ? null : state.detail;
    const isSubmitting = state.kind === "submitting";
    // 轮播列表 = StashDB 封面/图片 + 剧照探测结果（URL 去重）。
    // 第 0 张是封面，之后是剧照；与首页剧照预览同源。
    const previewImages = Array.from(
        new Set([
            ...(detail?.images ?? []).map((i) => i.url),
            ...gallery,
        ]),
    ).filter(Boolean);
    const hasMultipleImages = previewImages.length > 1;
    const currentImage =
        previewImages[imageIndex] ?? (form?.cover_image || "");

    return createPortal(
        <div
            className={
                "binge-sheet-root binge-sheet-root-top" +
                (isExiting ? " is-exiting" : "")
            }
        >
            <div className="binge-sheet-backdrop" onClick={beginClose} />
            <div
                className="binge-sheet binge-follow-modal binge-add-scene-modal"
                role="dialog"
                aria-label={t("action.add_scene_to_library")}
            >
                <header className="binge-follow-modal-header">
                    <h2>{t("action.add_scene_to_library")}</h2>
                    <button
                        type="button"
                        className="binge-follow-modal-close"
                        onClick={beginClose}
                        aria-label={t("action.close")}
                    >
                        ×
                    </button>
                </header>

                {state.kind === "loading" && (
                    <div className="binge-follow-modal-loading">
                        {t("status.fetching_stashdb")}
                    </div>
                )}

                {form && (
                    <div className="binge-follow-modal-body">
                        <div className="binge-follow-modal-hero">
                            <div className="binge-follow-modal-hero-wrap">
                                <div
                                    className={
                                        "binge-follow-modal-hero-img is-scene" +
                                        (gallery.includes(currentImage)
                                            ? " is-gallery"
                                            : "")
                                    }
                                    style={
                                        currentImage
                                            ? {
                                                  backgroundImage: `url(${currentImage})`,
                                              }
                                            : undefined
                                    }
                                >
                                    {!currentImage && (
                                        <span className="binge-follow-modal-hero-empty">
                                            {t("status.no_image")}
                                        </span>
                                    )}
                                </div>
                                {hasMultipleImages && (
                                    <>
                                        <button
                                            type="button"
                                            className="binge-follow-modal-hero-nav is-prev"
                                            onClick={() =>
                                                setImageIndex(
                                                    (imageIndex -
                                                        1 +
                                                        previewImages.length) %
                                                        previewImages.length
                                                )
                                            }
                                            aria-label={t("action.previous_photo")}
                                        >
                                            <ChevronLeft />
                                        </button>
                                        <button
                                            type="button"
                                            className="binge-follow-modal-hero-nav is-next"
                                            onClick={() =>
                                                setImageIndex(
                                                    (imageIndex + 1) %
                                                        previewImages.length
                                                )
                                            }
                                            aria-label={t("action.next_photo")}
                                        >
                                            <ChevronRight />
                                        </button>
                                        <div className="binge-follow-modal-hero-counter">
                                            {imageIndex + 1} / {previewImages.length}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="binge-follow-modal-hero-meta">
                                {detail?.studio && (
                                    <div className="binge-follow-modal-stats">
                                        {t("performer.studio")}{" "}
                                        <strong>{detail.studio.name}</strong>
                                        {!form.studioId && (
                                            <span className="binge-follow-modal-not-in-library">
                                                {t("performer.not_in_library")}
                                            </span>
                                        )}
                                    </div>
                                )}
                                {detail && (
                                    <div className="binge-follow-modal-stats">
                                        {t("scene.stashdb_performers", { count: detail.performers.length })}
                                        {form.performerIds.length <
                                            detail.performers.length && (
                                            <span className="binge-follow-modal-not-in-library">
                                                {t("scene.performers_in_library", { count: form.performerIds.length })}
                                            </span>
                                        )}
                                    </div>
                                )}
                                <a
                                    href={stashboxUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="binge-follow-modal-stashdb-link"
                                >
                                    {t("action.view_on_stashdb")} →
                                </a>
                            </div>
                        </div>

                        <div className="binge-follow-modal-grid">
                            <Field
                                label={t("form.title")}
                                value={form.title}
                                onChange={(v) => updateField("title", v)}
                                fullWidth
                            />
                            <Field
                                label={t("form.date")}
                                value={form.date}
                                type="date"
                                onChange={(v) => updateField("date", v)}
                            />
                            <Field
                                label={t("form.code")}
                                value={form.code}
                                onChange={(v) => updateField("code", v)}
                                suffix={
                                    <button
                                        type="button"
                                        className={
                                            "binge-follow-modal-code-copy" +
                                            (copied ? " is-copied" : "")
                                        }
                                        onClick={() => void handleCopyCode()}
                                        aria-label={t("scene.copy_code")}
                                        title={t("scene.copy_code")}
                                    >
                                        <CopyIcon />
                                    </button>
                                }
                            />
                            <Field
                                label={t("form.director")}
                                value={form.director}
                                onChange={(v) => updateField("director", v)}
                                fullWidth
                            />
                            <TextareaField
                                label={t("form.urls")}
                                value={form.urls}
                                onChange={(v) => updateField("urls", v)}
                                fullWidth
                                rows={3}
                            />
                            <TextareaField
                                label={t("form.details")}
                                value={form.details}
                                onChange={(v) => updateField("details", v)}
                                rows={5}
                                fullWidth
                            />
                        </div>

                        {detail && detail.performers.length > 0 && (
                            <div className="binge-follow-modal-coperformers">
                                <span className="binge-follow-modal-coperformers-label">
                                    {t("performer.performers")}
                                </span>
                                {detail.performers.map((p) => (
                                    // We don't have a per-performer
                                    // "in library" flag at this
                                    // level — only the count of
                                    // matched IDs. Chips render
                                    // neutrally; the meta line above
                                    // already shows N of M matched.
                                    <span
                                        key={p.stashId}
                                        className="binge-follow-modal-coperformer-chip"
                                    >
                                        {p.name}
                                    </span>
                                ))}
                            </div>
                        )}

                        {state.kind === "error" && (
                            <div className="binge-follow-modal-error">
                                {state.message}
                            </div>
                        )}
                    </div>
                )}

                <footer className="binge-follow-modal-footer">
                    <button
                        type="button"
                        className="binge-follow-modal-cancel"
                        onClick={beginClose}
                        disabled={isSubmitting}
                    >
                        {t("action.cancel")}
                    </button>
                    <button
                        type="button"
                        className="binge-follow-modal-submit"
                        onClick={handleSubmit}
                        disabled={state.kind !== "ready"}
                    >
                        {isSubmitting
                            ? t("status.adding")
                            : state.kind === "error"
                              ? t("action.retry")
                              : t("action.add_to_library")}
                    </button>
                </footer>
            </div>
        </div>,
        document.body
    );
}

function Field({
    label,
    value,
    type,
    fullWidth,
    suffix,
    onChange,
}: {
    label: string;
    value: string;
    type?: "text" | "url" | "number" | "date";
    fullWidth?: boolean;
    suffix?: ReactNode;
    onChange: (v: string) => void;
}) {
    const input = (
        <input
            type={type ?? "text"}
            className="binge-follow-modal-input"
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onChange(e.target.value)
            }
        />
    );
    return (
        <label
            className={
                "binge-follow-modal-label" +
                (fullWidth ? " is-full" : "")
            }
        >
            <span className="binge-follow-modal-label-text">{label}</span>
            {suffix ? (
                <span className="binge-follow-modal-field-row">
                    {input}
                    {suffix}
                </span>
            ) : (
                input
            )}
        </label>
    );
}

function TextareaField({
    label,
    value,
    rows,
    fullWidth,
    onChange,
}: {
    label: string;
    value: string;
    rows?: number;
    fullWidth?: boolean;
    onChange: (v: string) => void;
}) {
    return (
        <label
            className={
                "binge-follow-modal-label" +
                (fullWidth ? " is-full" : "")
            }
        >
            <span className="binge-follow-modal-label-text">{label}</span>
            <textarea
                className="binge-follow-modal-textarea"
                value={value}
                rows={rows ?? 2}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                    onChange(e.target.value)
                }
            />
        </label>
    );
}

function CopyIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {/* 两个相交方框：复制（拷贝）图案，与日期输入框内图标同源风格。 */}
            <rect x="9" y="9" width="12" height="12" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    );
}
function ChevronLeft() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M15 6l-6 6 6 6" />
        </svg>
    );
}
function ChevronRight() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M9 6l6 6-6 6" />
        </svg>
    );
}

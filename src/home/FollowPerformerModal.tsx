import { useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import {
    buildPerformerCreateForm,
    getStashDBPerformerForFollow,
    submitPerformerCreate,
    type PerformerCreateForm,
} from "../api/mutations";
import { useSheetClose } from "../hooks/useSheetClose";
import type { StashDBPerformerDetail } from "../api/stashdb";
import { useTranslation } from "react-i18next";

interface FollowPerformerModalProps {
    stashDBPerformerId: string;
    stashBoxIndex: number;
    fallbackName: string;
    fallbackImage: string | null;
    // External link for "View on StashDB →" inside the modal.
    stashboxUrl?: string;
    onCreated: (result: { id: string; name: string }) => void;
    onClose: () => void;
}

type ModalState =
    | { kind: "scraping" }
    | {
          kind: "ready";
          form: PerformerCreateForm;
          detail: StashDBPerformerDetail | null;
      }
    | {
          kind: "submitting";
          form: PerformerCreateForm;
          detail: StashDBPerformerDetail | null;
      }
    | {
          kind: "error";
          form: PerformerCreateForm;
          detail: StashDBPerformerDetail | null;
          message: string;
      };

// Stash-style "Add Performer" confirmation modal. Opens when the
// user taps Follow anywhere in the discovery surface. Auto-scrapes
// the performer from StashDB on mount, surfaces the scraped data
// in an editable form, and only submits performerCreate when the
// user explicitly confirms.
//
// The flow mirrors Stash's own "Browse StashDB → Add to library"
// dialog so users who know that UI feel at home.
export function FollowPerformerModal({
    stashDBPerformerId,
    stashBoxIndex,
    fallbackName,
    fallbackImage,
    stashboxUrl,
    onCreated,
    onClose,
}: FollowPerformerModalProps) {
    const { isExiting, beginClose } = useSheetClose(onClose);
    const [state, setState] = useState<ModalState>({ kind: "scraping" });
    const [imageIndex, setImageIndex] = useState(0);
    const { t } = useTranslation();

    // Esc closes (matches MoreSheet and other binge sheets).
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") beginClose();
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [beginClose]);

    // Pull the full performer record from StashDB on mount + build
    // the editable form. If the fetch fails (network, no StashDB
    // config, performer not found) we still mount with the
    // fallback name + image so the user can manually add fields.
    useEffect(() => {
        let alive = true;
        (async () => {
            let detail: StashDBPerformerDetail | null = null;
            try {
                detail = await getStashDBPerformerForFollow(stashDBPerformerId);
            } catch (err) {
                console.warn(
                    "[binge] getStashDBPerformerForFollow failed",
                    err,
                );
            }
            if (!alive) return;
            const form = buildPerformerCreateForm({
                stashDBPerformerId,
                fallbackName,
                fallbackImage,
                detail,
            });
            setState({ kind: "ready", form, detail });
            setImageIndex(0);
        })();
        return () => {
            alive = false;
        };
    }, [stashDBPerformerId, stashBoxIndex, fallbackName, fallbackImage]);

    const updateField = <K extends keyof PerformerCreateForm>(
        key: K,
        value: PerformerCreateForm[K],
    ) => {
        setState((prev) => {
            if (prev.kind !== "ready" && prev.kind !== "error") return prev;
            const nextForm = { ...prev.form, [key]: value };
            // Error → ready when the user starts editing (so the
            // submit button is no longer "Retry").
            return { kind: "ready", form: nextForm, detail: prev.detail };
        });
    };

    const handleSubmit = async () => {
        if (state.kind !== "ready") return;
        const form = state.form;
        const detail = state.detail;
        if (!form.name.trim()) return; // name required
        // Submit the currently-selected hero image — the user may
        // have flipped through the carousel and picked a different
        // photo than the first one returned by StashDB.
        const submittedForm = {
            ...form,
            image: detail?.images[imageIndex]?.url || form.image || "",
        };
        setState({ kind: "submitting", form: submittedForm, detail });
        try {
            const result = await submitPerformerCreate(submittedForm);
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

    const form =
        state.kind === "scraping"
            ? null
            : state.kind === "ready"
              ? state.form
              : state.kind === "submitting"
                ? state.form
                : state.form;
    const detail = state.kind === "scraping" ? null : state.detail;
    const isSubmitting = state.kind === "submitting";
    // Image carousel — use the StashDB image array if we have it,
    // otherwise fall back to whatever URL the user typed/inherited.
    const images = detail?.images ?? [];
    const hasMultipleImages = images.length > 1;
    const currentImage = images[imageIndex]?.url || form?.image || "";

    return createPortal(
        <div
            className={
                "binge-sheet-root binge-sheet-root-top" +
                (isExiting ? " is-exiting" : "")
            }
        >
            <div className="binge-sheet-backdrop" onClick={beginClose} />
            <div
                className="binge-sheet binge-follow-modal"
                role="dialog"
                aria-label={t("action.add_performer_to_library")}
            >
                <header className="binge-follow-modal-header">
                    <h2>{t("action.add_to_library")}</h2>
                    <button
                        type="button"
                        className="binge-follow-modal-close"
                        onClick={beginClose}
                        aria-label={t("action.close")}
                    >
                        ×
                    </button>
                </header>

                {state.kind === "scraping" && (
                    <div className="binge-follow-modal-loading">
                        {t("status.fetching_stashdb")}
                    </div>
                )}

                {form && (
                    <div className="binge-follow-modal-body">
                        <div className="binge-follow-modal-hero">
                            <div className="binge-follow-modal-hero-wrap">
                                <div
                                    className="binge-follow-modal-hero-img"
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
                                                        images.length) %
                                                        images.length,
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
                                                        images.length,
                                                )
                                            }
                                            aria-label={t("action.next_photo")}
                                        >
                                            <ChevronRight />
                                        </button>
                                        <div className="binge-follow-modal-hero-dots">
                                            {images.map((_, i) => (
                                                <button
                                                    type="button"
                                                    key={i}
                                                    className={
                                                        "binge-follow-modal-hero-dot" +
                                                        (i === imageIndex
                                                            ? " is-active"
                                                            : "")
                                                    }
                                                    onClick={() =>
                                                        setImageIndex(i)
                                                    }
                                                    aria-label={t("action.photo_count", { current: i + 1, total: images.length })}
                                                />
                                            ))}
                                        </div>
                                        <div className="binge-follow-modal-hero-counter">
                                            {t("status.current_total_image", { current: imageIndex + 1, total: images.length })}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="binge-follow-modal-hero-meta">
                                {detail && (
                                    <div className="binge-follow-modal-stats">
                                        {t("status.stashdb_scenes_count", { count: detail.sceneCount })}
                                    </div>
                                )}
                                {stashboxUrl && (
                                    <a
                                        href={stashboxUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="binge-follow-modal-stashdb-link"
                                    >
                                        {t("action.view_on_stashdb")} →
                                    </a>
                                )}
                                <label className="binge-follow-modal-label">
                                    {t("performer.image_url")}
                                    <input
                                        type="url"
                                        className="binge-follow-modal-input"
                                        value={currentImage}
                                        onChange={(
                                            e: ChangeEvent<HTMLInputElement>,
                                        ) =>
                                            updateField("image", e.target.value)
                                        }
                                        placeholder="https://…"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="binge-follow-modal-grid">
                            <Field
                                label={t("performer.name")}
                                value={form.name}
                                required
                                onChange={(v) => updateField("name", v)}
                            />
                            <Field
                                label={t("performer.disambiguation")}
                                value={form.disambiguation}
                                onChange={(v) =>
                                    updateField("disambiguation", v)
                                }
                            />
                            <Field
                                label={t("performer.alias_list")}
                                value={form.alias_list}
                                onChange={(v) => updateField("alias_list", v)}
                                fullWidth
                            />
                            <SelectField
                                label={t("performer.gender")}
                                value={form.gender}
                                options={[
                                    ["", "—"],
                                    ["FEMALE", t("settings.gender.female")],
                                    ["TRANSGENDER_FEMALE", t("settings.gender.trans_female")],
                                    ["MALE", t("settings.gender.male")],
                                    ["TRANSGENDER_MALE", t("settings.gender.trans_male")],
                                    ["INTERSEX", t("settings.gender.intersex")],
                                    ["NON_BINARY", t("settings.gender.non_binary")],
                                ]}
                                onChange={(v) => updateField("gender", v)}
                            />
                            <Field
                                label={t("performer.birthdate")}
                                value={form.birthdate}
                                type="date"
                                onChange={(v) => updateField("birthdate", v)}
                            />
                            <Field
                                label={t("performer.death_date")}
                                value={form.death_date}
                                type="date"
                                onChange={(v) => updateField("death_date", v)}
                            />
                            <Field
                                label={t("performer.country")}
                                value={form.country}
                                onChange={(v) => updateField("country", v)}
                            />
                            <Field
                                label={t("performer.ethnicity")}
                                value={form.ethnicity}
                                onChange={(v) => updateField("ethnicity", v)}
                            />
                            <Field
                                label={t("performer.hair_color")}
                                value={form.hair_color}
                                onChange={(v) => updateField("hair_color", v)}
                            />
                            <Field
                                label={t("performer.eye_color")}
                                value={form.eye_color}
                                onChange={(v) => updateField("eye_color", v)}
                            />
                            <Field
                                label={t("performer.height")}
                                value={form.height_cm}
                                type="number"
                                onChange={(v) => updateField("height_cm", v)}
                            />
                            <Field
                                label={t("performer.weight")}
                                value={form.weight}
                                type="number"
                                onChange={(v) => updateField("weight", v)}
                            />
                            <Field
                                label={t("performer.measurements")}
                                value={form.measurements}
                                onChange={(v) => updateField("measurements", v)}
                            />
                            <Field
                                label={t("performer.fake_tits")}
                                value={form.fake_tits}
                                onChange={(v) => updateField("fake_tits", v)}
                            />
                            <Field
                                label={t("performer.penis_length")}
                                value={form.penis_length}
                                type="number"
                                onChange={(v) => updateField("penis_length", v)}
                            />
                            <SelectField
                                label={t("performer.circumcised")}
                                value={form.circumcised}
                                options={[
                                    ["", "—"],
                                    ["CUT", t("performer.cut")],
                                    ["UNCUT", t("performer.uncut")],
                                ]}
                                onChange={(v) => updateField("circumcised", v)}
                            />
                            <Field
                                label={t("performer.career_start")}
                                value={form.career_start}
                                type="date"
                                onChange={(v) => updateField("career_start", v)}
                            />
                            <Field
                                label={t("performer.career_end")}
                                value={form.career_end}
                                type="date"
                                onChange={(v) => updateField("career_end", v)}
                            />
                            <TextareaField
                                label={t("performer.tattoos")}
                                value={form.tattoos}
                                onChange={(v) => updateField("tattoos", v)}
                            />
                            <TextareaField
                                label={t("performer.piercings")}
                                value={form.piercings}
                                onChange={(v) => updateField("piercings", v)}
                            />
                            <TextareaField
                                label={t("performer.urls")}
                                value={form.urls}
                                onChange={(v) => updateField("urls", v)}
                                fullWidth
                                rows={3}
                            />
                            <TextareaField
                                label={t("performer.details")}
                                value={form.details}
                                onChange={(v) => updateField("details", v)}
                                rows={4}
                                fullWidth
                            />
                            <label
                                className={
                                    "binge-follow-modal-label is-full " +
                                    "binge-follow-modal-checkbox"
                                }
                            >
                                <input
                                    type="checkbox"
                                    checked={form.ignore_auto_tag}
                                    onChange={(e) =>
                                        updateField(
                                            "ignore_auto_tag",
                                            e.target.checked,
                                        )
                                    }
                                />
                                {t("performer.ignore_auto_tag")}
                            </label>
                        </div>

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
                        disabled={state.kind !== "ready" || !form?.name.trim()}
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
        document.body,
    );
}

function Field({
    label,
    value,
    type,
    required,
    fullWidth,
    onChange,
}: {
    label: string;
    value: string;
    type?: "text" | "url" | "number" | "date";
    required?: boolean;
    fullWidth?: boolean;
    onChange: (v: string) => void;
}) {
    return (
        <label
            className={
                "binge-follow-modal-label" + (fullWidth ? " is-full" : "")
            }
        >
            <span className="binge-follow-modal-label-text">
                {label}
                {required && (
                    <span
                        className="binge-follow-modal-label-required"
                        aria-hidden="true"
                    >
                        {" "}
                        *
                    </span>
                )}
            </span>
            <input
                type={type ?? "text"}
                className="binge-follow-modal-input"
                value={value}
                required={required}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    onChange(e.target.value)
                }
            />
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
                "binge-follow-modal-label" + (fullWidth ? " is-full" : "")
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

function SelectField({
    label,
    value,
    options,
    fullWidth,
    onChange,
}: {
    label: string;
    value: string;
    options: [string, string][];
    fullWidth?: boolean;
    onChange: (v: string) => void;
}) {
    return (
        <label
            className={
                "binge-follow-modal-label" + (fullWidth ? " is-full" : "")
            }
        >
            <span className="binge-follow-modal-label-text">{label}</span>
            <select
                className="binge-follow-modal-input"
                value={value}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                    onChange(e.target.value)
                }
            >
                {options.map(([v, l]) => (
                    <option key={v} value={v}>
                        {l}
                    </option>
                ))}
            </select>
        </label>
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

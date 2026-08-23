import { useEffect, useRef, useState } from "react";

export interface SortMenuItem<T extends string> {
    value: T;
    label: string;
}

interface SortMenuProps<T extends string> {
    options: SortMenuItem<T>[];
    value: T;
    onChange: (next: T) => void;
    /** 无障碍标签（排序控件的用途说明） */
    ariaLabel?: string;
    /** 浮层菜单对齐按钮的哪一侧；按钮贴右缘时用 "right" 防溢出 */
    menuAlign?: "left" | "right";
    /** 按钮外观：text = 无框文字（详情页 section header 风格）；
        box = 有底色边框的文字栏（关注中页等表单控件的风格）。 */
    variant?: "text" | "box";
}

// 通用排序下拉：文字按钮 + 玻璃拟态浮层菜单（radio 式选项 + 勾选态）。
// 从详情页场景排序（PerformerSceneSortMenu）泛化而来，供关注中页面
// 等复用——替代原生 <select>（Android Chrome 会弹系统级居中大号白
// 底选择框，与应用深色风格完全脱节）。桌面 + 手机行为一致。
export function SortMenu<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    menuAlign = "left",
    variant = "text",
}: SortMenuProps<T>) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // 点外面 / Esc 关闭。
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (
                rootRef.current &&
                !rootRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const current = options.find((o) => o.value === value);

    return (
        <div className="binge-sort" ref={rootRef}>
            <button
                type="button"
                className={
                    "binge-sort-btn" +
                    (open ? " is-open" : "") +
                    (variant === "box" ? " is-box" : "")
                }
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={ariaLabel}
            >
                <span className="binge-sort-btn-label">
                    {current?.label ?? value}
                </span>
                {variant !== "box" && <ChevronIcon />}
            </button>
            {open && (
                <div
                    className={
                        "binge-sort-menu" +
                        (menuAlign === "right" ? " is-align-right" : "") +
                        (variant === "box" ? " is-box" : "")
                    }
                    role="menu"
                >
                    {options.map((opt) => {
                        const active = opt.value === value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                className={
                                    "binge-sort-item" +
                                    (active ? " is-active" : "")
                                }
                                onClick={() => {
                                    onChange(opt.value);
                                    setOpen(false);
                                }}
                            >
                                {variant !== "box" && (
                                    <span className="binge-sort-check">
                                        {active && <CheckIcon />}
                                    </span>
                                )}
                                {opt.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function ChevronIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

function CheckIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M5 13l4 4L19 7" />
        </svg>
    );
}

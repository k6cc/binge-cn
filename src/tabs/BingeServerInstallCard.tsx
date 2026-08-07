import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getBingeServerHealth } from "../api/bingeServer";
import { readBingeServerUrl } from "../home/pluginSettings";
import {
    installedUrl,
    installTaskAvailable,
    composeSnippet,
    manualInstallCommand,
    recordServerUrl,
    startServerInstall,
    waitForServer,
} from "../api/installServer";

type InstallState =
    | { kind: "checking" }
    | { kind: "running"; version?: string }
    | { kind: "absent"; canInstall: boolean }
    | { kind: "installing"; elapsed: number }
    | { kind: "failed"; message: string; canInstall: boolean };

// One-click(ish) install of the optional daemon.
//
// It installs onto the machine running STASH, because that's where the
// plugin task executes — right for the common self-hosted setup, wrong if
// you deliberately run the daemon elsewhere. Hence the note in the copy,
// and the manual command for everyone the button can't serve.
export function BingeServerInstallCard() {
    const { t } = useTranslation();
    const [state, setState] = useState<InstallState>({ kind: "checking" });
    const [showManual, setShowManual] = useState(false);
    const [copied, setCopied] = useState<"compose" | "run" | null>(null);

    // Initial probe: is it already there, and could we install it if not?
    useEffect(() => {
        let alive = true;
        (async () => {
            const health = await getBingeServerHealth();
            if (!alive) return;
            if (health && health.ok) {
                setState({ kind: "running", version: health.version });
                return;
            }
            const canInstall = await installTaskAvailable();
            if (alive) setState({ kind: "absent", canInstall });
        })();
        return () => {
            alive = false;
        };
    }, []);

    // While the manual instructions are open the user is, right now, off
    // running compose. Keep probing so the card flips to "running" by
    // itself the moment it comes up, and records the URL — otherwise they
    // finish the install and the page still claims nothing is there.
    useEffect(() => {
        if (!showManual) return;
        if (state.kind === "running" || state.kind === "installing") return;
        let alive = true;
        const timer = setInterval(async () => {
            const health = await getBingeServerHealth();
            if (!alive || !(health && health.ok)) return;
            clearInterval(timer);
            await recordServerUrl(readBingeServerUrl());
            if (alive) setState({ kind: "running", version: health.version });
        }, 4000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, [showManual, state.kind]);

    const install = async () => {
        setState({ kind: "installing", elapsed: 0 });
        try {
            await startServerInstall();
        } catch (err) {
            setState({
                kind: "failed",
                message: t("settings.install_card.failed_task", {
                    error: err instanceof Error ? err.message : String(err),
                }),
                canInstall: true,
            });
            setShowManual(true);
            return;
        }
        const up = await waitForServer(300_000, (elapsed) =>
            setState({ kind: "installing", elapsed })
        );
        if (!up) {
            setState({
                kind: "failed",
                message: t("settings.install_card.failed_no_answer"),
                canInstall: true,
            });
            setShowManual(true);
            return;
        }
        await recordServerUrl(installedUrl());
        const health = await getBingeServerHealth();
        setState({ kind: "running", version: health?.version });
    };

    const copy = async (text: string, which: "compose" | "run") => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(which);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            /* clipboard blocked — the text is on screen to select */
        }
    };

    const showActions = state.kind === "absent" || state.kind === "failed";

    return (
        <div className="binge-settings-row binge-install-card">
            <div className="binge-settings-row-text">
                <div className="binge-settings-row-title">
                    {t("settings.install_card.title")}
                </div>
                <div className="binge-settings-row-desc">
                    {t("settings.install_card.desc")}
                </div>
            </div>

            <div className="binge-install-body">
                {state.kind === "checking" && (
                    <div className="binge-install-status">
                        {t("settings.install_card.checking")}
                    </div>
                )}

                {state.kind === "running" && (
                    <div className="binge-install-status is-ok">
                        {t("settings.install_card.running")}
                        {state.version ? ` (${state.version})` : ""}
                    </div>
                )}

                {state.kind === "installing" && (
                    <div className="binge-install-status">
                        {t("settings.install_card.installing", {
                            seconds: Math.round(state.elapsed / 1000),
                        })}
                    </div>
                )}

                {showActions && (
                    <>
                        {state.kind === "failed" && (
                            <div className="binge-install-status is-error">
                                {state.message}
                            </div>
                        )}
                        <div className="binge-install-actions">
                            {state.canInstall && (
                                <button
                                    type="button"
                                    className="binge-install-btn"
                                    onClick={install}
                                >
                                    {state.kind === "failed"
                                        ? t("settings.install_card.try_again")
                                        : t("settings.install_card.install")}
                                </button>
                            )}
                            <button
                                type="button"
                                className="binge-install-btn is-secondary"
                                onClick={() => setShowManual((v) => !v)}
                            >
                                {showManual
                                    ? t("settings.install_card.hide_command")
                                    : t("settings.install_card.install_manually")}
                            </button>
                        </div>
                        {!state.canInstall && (
                            <div className="binge-install-status">
                                {t("settings.install_card.no_task")}
                            </div>
                        )}
                        {showManual && (
                            <div className="binge-install-manual">
                                <div className="binge-install-status">
                                    <strong>
                                        {t("settings.install_card.docker_label")}
                                    </strong>
                                    {" — "}
                                    {t("settings.install_card.docker_note")}{" "}
                                    <code>docker compose up -d</code>.
                                </div>
                                <pre>{composeSnippet()}</pre>
                                <button
                                    type="button"
                                    className="binge-install-btn is-secondary"
                                    onClick={() => void copy(composeSnippet(), "compose")}
                                >
                                    {copied === "compose"
                                        ? t("settings.install_card.copied")
                                        : t("settings.install_card.copy_compose")}
                                </button>
                                <div className="binge-install-status">
                                    <strong>
                                        {t("settings.install_card.otherwise_label")}
                                    </strong>
                                    {" — "}
                                    {t("settings.install_card.otherwise_note")}
                                </div>
                                <pre>{manualInstallCommand()}</pre>
                                <button
                                    type="button"
                                    className="binge-install-btn is-secondary"
                                    onClick={() => void copy(manualInstallCommand(), "run")}
                                >
                                    {copied === "run"
                                        ? t("settings.install_card.copied")
                                        : t("settings.install_card.copy_run")}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

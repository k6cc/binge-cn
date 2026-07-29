import { useEffect, useState } from "react";
import { getBingeServerHealth } from "../api/bingeServer";
import {
    INSTALLED_URL,
    installTaskAvailable,
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
    const [state, setState] = useState<InstallState>({ kind: "checking" });
    const [showManual, setShowManual] = useState(false);
    const [copied, setCopied] = useState(false);

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

    const install = async () => {
        setState({ kind: "installing", elapsed: 0 });
        try {
            await startServerInstall();
        } catch (err) {
            setState({
                kind: "failed",
                message:
                    "Stash refused to start the install task: " +
                    (err instanceof Error ? err.message : String(err)),
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
                message:
                    "The task ran but nothing answered on port 7878. " +
                    "Settings, then Tasks, has its log.",
                canInstall: true,
            });
            setShowManual(true);
            return;
        }
        await recordServerUrl(INSTALLED_URL);
        const health = await getBingeServerHealth();
        setState({ kind: "running", version: health?.version });
    };

    const copyManual = async () => {
        try {
            await navigator.clipboard.writeText(manualInstallCommand());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            /* clipboard blocked — the command is on screen to select */
        }
    };

    const showActions = state.kind === "absent" || state.kind === "failed";

    return (
        <div className="binge-settings-row binge-install-card">
            <div className="binge-settings-row-text">
                <div className="binge-settings-row-title">binge-server</div>
                <div className="binge-settings-row-desc">
                    Optional daemon that adds Reddit, X and PornHub posts to
                    your stories, plus Save-to-Stash. binge works fine without
                    it. Installs onto the machine running Stash — if you run
                    the daemon somewhere else, set its URL below instead.
                </div>
            </div>

            <div className="binge-install-body">
                {state.kind === "checking" && (
                    <div className="binge-install-status">checking…</div>
                )}

                {state.kind === "running" && (
                    <div className="binge-install-status is-ok">
                        Installed and running
                        {state.version ? ` (${state.version})` : ""}
                    </div>
                )}

                {state.kind === "installing" && (
                    <div className="binge-install-status">
                        Installing… the first run can take a few minutes while
                        Docker pulls the image (
                        {Math.round(state.elapsed / 1000)}s)
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
                                        ? "Try again"
                                        : "Install binge-server"}
                                </button>
                            )}
                            <button
                                type="button"
                                className="binge-install-btn is-secondary"
                                onClick={() => setShowManual((v) => !v)}
                            >
                                {showManual
                                    ? "Hide command"
                                    : "Install manually"}
                            </button>
                        </div>
                        {!state.canInstall && (
                            <div className="binge-install-status">
                                One-click install isn't available here. It
                                needs python on the Stash host, and a plugin
                                reload after updating binge. Use the command
                                instead.
                            </div>
                        )}
                        {showManual && (
                            <div className="binge-install-manual">
                                <div className="binge-install-status">
                                    Run this on the machine hosting Stash,
                                    then set the URL below if it isn't
                                    localhost:
                                </div>
                                <pre>{manualInstallCommand()}</pre>
                                <button
                                    type="button"
                                    className="binge-install-btn is-secondary"
                                    onClick={copyManual}
                                >
                                    {copied ? "Copied" : "Copy command"}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

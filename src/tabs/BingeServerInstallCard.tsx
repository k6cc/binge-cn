import { useEffect, useState } from "react";
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
    probeInstall,
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
        // Ask first. The install task REFUSES when Stash is in a
        // container without Docker access, which is most people, and it
        // refuses in about a second with a good clear sentence. Without
        // this the card started the task anyway, watched port 7878 for
        // five minutes, then said "Settings, then Tasks, has its log" -
        // five minutes of false hope followed by a log hunt, for a
        // question already answered before the wait began.
        const probe = await probeInstall();
        if (probe && !probe.can_install) {
            setState({
                kind: "failed",
                message:
                    probe.message ??
                    "Stash cannot install binge-server on this host.",
                // Not a retry: pressing it again gets the same refusal.
                canInstall: false,
            });
            setShowManual(true);
            return;
        }
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
            setState({ kind: "installing", elapsed }),
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
                <div className="binge-settings-row-title">Status</div>
                <div className="binge-settings-row-description">
                    Optional daemon that adds Reddit, X and PornHub posts to
                    your stories, plus Save-to-Stash. binge works fine without
                    it. Installs onto the machine running Stash. If you run the
                    daemon somewhere else, set its URL below instead.
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
                                One-click install isn't offered here. Stash has
                                no install task registered. Reload plugins in
                                Stash if you just updated binge; otherwise use
                                one of the options below.
                            </div>
                        )}
                        {showManual && (
                            <div className="binge-install-manual">
                                <div className="binge-install-status">
                                    <strong>If Stash runs in Docker</strong>:
                                    add this beside it in the same compose file,
                                    then <code>docker compose up -d</code>.
                                    Installing inside the Stash container
                                    wouldn't be reachable from your browser.
                                </div>
                                <pre>{composeSnippet()}</pre>
                                <button
                                    type="button"
                                    className="binge-install-btn is-secondary"
                                    onClick={() =>
                                        void copy(composeSnippet(), "compose")
                                    }
                                >
                                    {copied === "compose"
                                        ? "Copied"
                                        : "Copy compose service"}
                                </button>
                                <div className="binge-install-status">
                                    <strong>Otherwise</strong>: run this on the
                                    machine hosting Stash, then set the URL
                                    below if it isn't localhost:
                                </div>
                                <pre>{manualInstallCommand()}</pre>
                                <button
                                    type="button"
                                    className="binge-install-btn is-secondary"
                                    onClick={() =>
                                        void copy(manualInstallCommand(), "run")
                                    }
                                >
                                    {copied === "run"
                                        ? "Copied"
                                        : "Copy docker run"}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

import { gql } from "./graphql";
import { getBingeServerHealth } from "./bingeServer";
import { setBingeServerUrl } from "../home/pluginSettings";

// One-click install of the binge-server daemon.
//
// A browser can't install software, so this is a remote control rather than
// an installer: `runPluginTask` asks Stash to run binge-install.py on the
// machine hosting Stash, and we watch /healthz until the daemon answers.
// That means it installs onto the STASH host, which is the right place in
// the common self-hosted setup and the wrong place if you deliberately run
// the daemon elsewhere — the Settings copy says so.

const PLUGIN_ID = "binge";
const TASK_NAME = "Install binge-server";

// Where the installer always puts it. Matches binge-install.py's PORT.
export const INSTALLED_URL = "http://localhost:7878";

/** Ask Stash to run the installer task. Resolves once the task is queued,
 *  not once it finishes — progress is observed via the health poll. */
export async function startServerInstall(): Promise<void> {
    await gql(
        `mutation($plugin_id: ID!, $task_name: String!) {
            runPluginTask(plugin_id: $plugin_id, task_name: $task_name)
        }`,
        { plugin_id: PLUGIN_ID, task_name: TASK_NAME }
    );
}

/** True when Stash has the binge plugin's install task available. False
 *  means the plugin was updated without a Stash plugin reload, or python
 *  isn't present so Stash dropped the exec block — either way the button
 *  would fail, so we hide it and offer the manual command instead. */
export async function installTaskAvailable(): Promise<boolean> {
    try {
        const data = await gql<{
            plugins?: { id: string; tasks?: { name: string }[] | null }[];
        }>(`query { plugins { id tasks { name } } }`);
        const plugin = data.plugins?.find((p) => p.id === PLUGIN_ID);
        return !!plugin?.tasks?.some((t) => t.name === TASK_NAME);
    } catch {
        return false;
    }
}

/** Poll until the daemon answers or we give up. A cold Docker install
 *  pulls a few hundred MB, so this is patient. */
export async function waitForServer(
    timeoutMs = 300_000,
    onTick?: (elapsedMs: number) => void
): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const health = await getBingeServerHealth();
        if (health && health.ok) return true;
        onTick?.(Date.now() - started);
        await new Promise((r) => setTimeout(r, 3000));
    }
    return false;
}

/** Record the daemon's address once it's up: locally for this browser, and
 *  in Stash's plugin config so every other binge client (including iOS)
 *  seeds from it instead of each user re-typing the same URL. A failure to
 *  write the shared copy is not fatal — the local one already works. */
export async function recordServerUrl(url: string): Promise<void> {
    setBingeServerUrl(url);
    try {
        await gql(
            `mutation($input: Map!) {
                configurePlugin(plugin_id: "${PLUGIN_ID}", input: $input)
            }`,
            { input: { serverUrl: url } }
        );
    } catch {
        /* local setting stands on its own */
    }
}

/** For the case the button deliberately refuses: Stash itself running in a
 *  container. Installing into that container would put the daemon on a port
 *  nothing outside can reach, so the answer is a sibling service. Written to
 *  be pasted into the same compose file Stash is already in. */
export function composeSnippet(): string {
    return [
        "  # Reachable from your LAN, unlike the loopback-only docker run:",
        "  # your browser has to reach it, and it isn't on the Stash host.",
        "  # It holds your Stash API key, so don't forward 7878 publicly.",
        "  binge-server:",
        "    image: ghcr.io/ordureconnoisseur/binge-server:latest",
        "    container_name: binge-server",
        "    restart: unless-stopped",
        "    ports:",
        '      - "7878:7878"',
        "    volumes:",
        "      - ./binge-server-data:/data",
    ].join("\n");
}

/** The paste-this-instead command, for hosts where the task can't run (no
 *  python, Stash in a container without Docker access, a remote daemon). */
export function manualInstallCommand(): string {
    return [
        "docker run -d \\",
        "  --name binge-server \\",
        "  --restart unless-stopped \\",
        "  -p 127.0.0.1:7878:7878 \\",
        "  -v ~/binge-server-data:/data \\",
        "  ghcr.io/ordureconnoisseur/binge-server:latest",
    ].join("\n");
}

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

// Where the installer puts it: port 7878 on the Stash host, which is the
// host serving this page. Not a hardcoded localhost — that's only the same
// machine when you happen to be browsing from the Stash box.
export function installedUrl(): string {
    try {
        const host = window.location.hostname;
        // http, always, because that is what the daemon serves.
        //
        // This briefly followed the page scheme, to fix installs on an
        // https Stash being reported as failures. It did not fix them.
        // The poll that decides success goes through
        // defaultBingeServerUrl, which is hardcoded http and was not
        // touched, so the fetch was still blocked as mixed content; and
        // had it ever succeeded, this value is written back into Stash's
        // deployment-wide plugin config, so it would have replaced a
        // working http://host:7878 with an https URL the daemon cannot
        // answer, for every browser.
        //
        // A locally installed daemon is genuinely unreachable from an
        // https page. That is a real constraint, not a scheme bug, and
        // the install card says so rather than papering over it.
        if (host) return `http://${host}:7878`;
    } catch {
        /* no window */
    }
    return "http://localhost:7878";
}

/** Loopback is the safer bind, but it only works when the browser is on the
 *  Stash host. Anywhere else the daemon must listen LAN-wide or the install
 *  is useless to the person who asked for it. */
function bindMode(): "loopback" | "lan" {
    try {
        const h = window.location.hostname;
        // location.hostname keeps the brackets on an IPv6 literal, so the
        // bare "::1" compare never matched and browsing Stash at
        // http://[::1]:9999 chose the LAN bind - publishing a daemon that
        // holds the Stash API key on 0.0.0.0 when the user was on
        // loopback and had asked for nothing of the sort.
        return h === "localhost" ||
            h === "127.0.0.1" ||
            h === "::1" ||
            h === "[::1]"
            ? "loopback"
            : "lan";
    } catch {
        return "loopback";
    }
}

/** Ask Stash to run the installer task. Resolves once the task is queued,
 *  not once it finishes — progress is observed via the health poll. */
export async function startServerInstall(): Promise<void> {
    await gql(
        `mutation($plugin_id: ID!, $task_name: String!, $args_map: Map!) {
            runPluginTask(
                plugin_id: $plugin_id
                task_name: $task_name
                args_map: $args_map
            )
        }`,
        {
            plugin_id: PLUGIN_ID,
            task_name: TASK_NAME,
            args_map: { mode: "install", bind: bindMode() },
        },
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
    onTick?: (elapsedMs: number) => void,
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

/** What Stash's plugin config already says the daemon's address is.
 *  Empty when nothing is set, or when the query fails - in which case
 *  the caller leaves the shared copy alone rather than guessing. */
async function readConfiguredServerUrl(): Promise<string> {
    try {
        const data = await gql<{
            configuration?: {
                plugins?: Record<string, Record<string, unknown> | null>;
            };
        }>(
            // One plugin's config, not every plugin's. Stash
            // serialises the whole set otherwise - 13 KB on a real box
            // to read one field.
            `query { configuration { plugins(include: ["binge"]) } }`,
        );
        const v = data.configuration?.plugins?.["binge"]?.["serverUrl"];
        return typeof v === "string" ? v.trim() : "";
    } catch {
        // Unknown, so treat it as configured and do not overwrite.
        return "unknown";
    }
}

/** Record the daemon's address once it's up: locally for this browser, and
 *  in Stash's plugin config so every other binge client (including iOS)
 *  seeds from it instead of each user re-typing the same URL. A failure to
 *  write the shared copy is not fatal — the local one already works. */
export async function recordServerUrl(url: string): Promise<void> {
    // Stored, not vouched for.
    //
    // The install card calls this with the URL it already has, which on
    // a fresh install is the one seeded from Stash's plugin config. With
    // confirm defaulting to true, opening the card was enough to vouch
    // for a host nobody had chosen - and reaching the card is the
    // ordinary response to a daemon that answers "not ok", which a
    // hostile one can simply do. Confirming belongs to Settings, where
    // it is a button with the consequence written next to it.
    setBingeServerUrl(url, { confirm: false });
    try {
        // Only when nothing is configured server-side.
        //
        // This wrote unconditionally, so one click in one browser
        // replaced the deployment-wide serverUrl for every client that
        // had not yet seeded - and what it wrote was a guess built from
        // window.location, which is not the address an admin had chosen.
        const existing = await readConfiguredServerUrl();
        if (existing) return;
        await gql(
            `mutation($input: Map!) {
                configurePlugin(plugin_id: "${PLUGIN_ID}", input: $input)
            }`,
            { input: { serverUrl: url } },
        );
    } catch {
        /* local setting stands on its own */
    }
}

/** For the case the button deliberately refuses: Stash itself running in a
 *  container. Installing into that container would put the daemon on a port
 *  nothing outside can reach, so the answer is a sibling service. Written to
 *  be pasted into the same compose file Stash is already in. */
/** What will happen if we press Install, asked before we press it.
 *
 *  runPluginOperation runs the plugin synchronously and hands back its
 *  output, where runPluginTask is fire-and-forget. That distinction was
 *  useless until the installer started wrapping its JSON the way Stash's
 *  raw-plugin protocol expects: unwrapped, Stash parsed the output, found
 *  no "output" key and returned null, so nothing the script knew could
 *  ever reach the UI.
 *
 *  Returns null when the probe cannot be run at all (old installer, no
 *  python, Stash refusing) - callers should fall through to offering the
 *  install rather than blocking on a question that went unanswered. */
export async function probeInstall(): Promise<{
    can_install: boolean;
    running: boolean;
    reason?: string;
    message?: string;
} | null> {
    try {
        const data = await gql<{ runPluginOperation: unknown }>(
            `mutation ProbeBingeServerInstall {
                runPluginOperation(
                    plugin_id: "binge"
                    args: { mode: "probe" }
                )
            }`,
        );
        const out = data.runPluginOperation;
        if (!out || typeof out !== "object") return null;
        const o = out as Record<string, unknown>;
        if (typeof o.can_install !== "boolean") return null;
        return {
            can_install: o.can_install,
            running: o.running === true,
            reason: typeof o.reason === "string" ? o.reason : undefined,
            message: typeof o.message === "string" ? o.message : undefined,
        };
    } catch {
        return null;
    }
}

export function composeSnippet(): string {
    return [
        "  # Reachable from your LAN: your browser has to reach it, and it",
        "  # isn't always on the Stash host.",
        "  # It holds your Stash API key, so don't forward 7878 publicly.",
        "  binge-server:",
        "    image: ghcr.io/ordureconnoisseur/binge-server:latest",
        "    container_name: binge-server",
        "    restart: unless-stopped",
        "    ports:",
        '      - "7878:7878"',
        "    volumes:",
        "      - binge-data:/data",
        "",
        "# ...and this at the TOP level of the file, alongside `services:`,",
        "# not indented under it. A named volume needs declaring once.",
        "volumes:",
        "  binge-data:",
    ].join("\n");
}

/** The paste-this-instead command, for hosts where the task can't run (no
 *  python, Stash in a container without Docker access, a remote daemon).
 *
 *  It holds your Stash API key, so this is a LAN publish, not an
 *  internet-facing one.
 *
 *  A NAMED volume, not a bind mount. The container runs as uid 10001,
 *  and a bind mount arrives owned by root on Linux, so SQLite cannot
 *  create the database and the daemon dies on first boot with
 *
 *    open db path=/data/binge-server.db err="ping: unable to open
 *    database file (14)"
 *
 *  which is exactly what the first person to try this on unraid hit.
 *  Docker Desktop squashes ownership and hides it, so it looks fine
 *  on macOS and Windows and fails on Linux, where most people run
 *  Stash. Docker initialises a named volume from the image, so it
 *  inherits the right owner and needs no chown. */
export function manualInstallCommand(): string {
    return [
        "docker run -d \\",
        "  --name binge-server \\",
        "  --restart unless-stopped \\",
        // Published to the LAN, not to loopback. This command is handed
        // to people whose browser is not on the Stash host, which is the
        // whole reason the task could not run for them, and the compose
        // snippet directly above says as much. Binding it to 127.0.0.1
        // guaranteed the one thing they needed would not work.
        "  -p 7878:7878 \\",
        "  -v binge-data:/data \\",
        "  ghcr.io/ordureconnoisseur/binge-server:latest",
    ].join("\n");
}

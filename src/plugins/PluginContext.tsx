import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { gql } from "../api/graphql";

// Tracks which Stash plugins are installed AND enabled. The binge
// ActionStack uses this to conditionally render plugin-gated buttons
// (Multiview / Scribe / Advanced Rating).
//
// Stash's root GraphQL field `plugins { id name enabled }` returns all
// installed plugins with their enabled flag. We treat "disabled" as
// equivalent to "not installed" — a disabled plugin's UI affordances
// in binge should disappear too.

interface PluginEntry {
    id: string;
    enabled: boolean;
}

interface PluginContextValue {
    loaded: boolean;
    /// True only when Stash actually answered. `loaded` is also true
    /// after a failure, so anything choosing between a safe and an
    /// unsafe branch must read this instead.
    answered: boolean;
    hasPlugin: (id: string) => boolean;
}

const PluginContext = createContext<PluginContextValue | null>(null);

// Known plugin IDs from the user's suite (binge integrates with these
// specifically). Exported so call sites read the same constants the
// detection logic does.
export const PLUGIN_ID_ADVANCED_RATING = "advancedRating";
export const PLUGIN_ID_MULTIVIEW = "multiView";
export const PLUGIN_ID_SCRIBE = "stashScribe";

const QUERY_PLUGINS = /* GraphQL */ `
    query InstalledPlugins {
        plugins {
            id
            enabled
        }
    }
`;

export function PluginProvider({ children }: { children: ReactNode }) {
    // Whether the enumeration failed outright, as distinct from
    // answering with no plugins.
    const [failed, setFailed] = useState(false);
    const [entries, setEntries] = useState<PluginEntry[] | null>(null);

    useEffect(() => {
        let alive = true;
        gql<{ plugins: PluginEntry[] | null }>(QUERY_PLUGINS)
            .then((data) => {
                if (!alive) return;
                setEntries(data.plugins);
            })
            .catch(() => {
                // A failed query is NOT "no plugins". Recording it as an
                // empty list made `loaded` true and every hasPlugin
                // false, permanently and with no retry - so one 401 or
                // one network blip at startup was indistinguishable from
                // the plugin being uninstalled.
                //
                // The old comment reasoned that hiding a gated button is
                // the safe default. That is true of most of them and
                // false of the important one: hiding the Advanced Rating
                // button does not disable rating, it falls through to
                // writing rating100 DIRECTLY - and that plugin's hook
                // recomputes rating100 from score tags on the same
                // mutation, so the user's stars are reverted, or nulled
                // outright on a scene with no score tags. Failing to
                // detect must not pick the destructive branch.
                if (alive) setFailed(true);
            });
        return () => {
            alive = false;
        };
    }, []);

    const value = useMemo<PluginContextValue>(() => {
        const enabledIds = new Set(
            (entries ?? []).filter((p) => p.enabled).map((p) => p.id),
        );
        return {
            // Answered, not merely finished. A caller that must not
            // guess reads `answered`; one that only hides a button can
            // keep using hasPlugin.
            loaded: entries !== null || failed,
            answered: entries !== null,
            hasPlugin: (id: string) => enabledIds.has(id),
        };
    }, [entries, failed]);

    return (
        <PluginContext.Provider value={value}>
            {children}
        </PluginContext.Provider>
    );
}

function usePluginContext(): PluginContextValue {
    const ctx = useContext(PluginContext);
    if (!ctx) throw new Error("usePlugin must be used within PluginProvider");
    return ctx;
}

// Generic — for one-off uses. The named helpers below are the common path.
export function useHasPlugin(id: string): boolean {
    return usePluginContext().hasPlugin(id);
}

/// Becomes true once the enumeration is over, whether it answered or
/// failed. Used by BingeStartupSplash to stop holding the splash.
///
/// NOT a reachability signal, despite what this comment used to say: a
/// Stash that 401s or refuses the connection also finishes, and finishes
/// fast. Anything choosing between a safe branch and a destructive one
/// must read usePluginAnswered() instead.
export function usePluginLoaded(): boolean {
    return usePluginContext().loaded;
}

/// True only when Stash actually answered which plugins are installed.
///
/// The distinction is load-bearing for the rating write. A failed
/// enumeration makes every hasPlugin() false, and false for Advanced
/// Rating does not hide rating - it selects the branch that writes
/// rating100 DIRECTLY, which is the field that plugin owns and
/// recomputes from score tags on the very same mutation. So a single
/// 401 during a session turned every star tap into a rating that got
/// reverted, or nulled outright on a scene with no score tags. Not
/// knowing has to be its own answer.
export function usePluginAnswered(): boolean {
    return usePluginContext().answered;
}

export function useHasAdvancedRating(): boolean {
    return usePluginContext().hasPlugin(PLUGIN_ID_ADVANCED_RATING);
}
export function useHasMultiview(): boolean {
    return usePluginContext().hasPlugin(PLUGIN_ID_MULTIVIEW);
}
export function useHasScribe(): boolean {
    return usePluginContext().hasPlugin(PLUGIN_ID_SCRIBE);
}

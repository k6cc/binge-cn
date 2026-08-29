import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";

// Lets any descendant of <PerformerProfileProvider> summon the full-screen
// performer page without prop drilling. The actual rendering lives in
// <PerformerProfile/>, which reads `currentProfile` and portals itself to body.
//
// The profile is mirrored to the URL hash so the browser back button closes
// it, and direct deep-links work on first paint. Two hash shapes:
//   - `#/p/<localId>`   library performer (existing)
//   - `#/sdbp/<stashId>` StashDB-only performer (NEW — not in the user's
//                        Stash library yet; profile renders from StashDB
//                        data + their StashDB scenes)
// Bug 8：可选 `?tab=galleries` 查询参数指定初始 tab，用于从首页图库卡片的
// "查看图库"按钮直接跳转到演员档案的图库 tab。
export type ProfileTarget =
    | { kind: "local"; id: string; tab?: string }
    | { kind: "stashdb"; id: string; tab?: string };

interface PerformerProfileContextValue {
    currentProfile: ProfileTarget | null;
    openProfile: (id: string, tab?: string) => void;
    openStashDBProfile: (stashId: string, tab?: string) => void;
    close: () => void;
}

const PerformerProfileContext = createContext<
    PerformerProfileContextValue | undefined
>(undefined);

const LOCAL_HASH_PATTERN = /^#\/p\/([^/?]+)/;
const STASHDB_HASH_PATTERN = /^#\/sdbp\/([^/?]+)/;

function readProfileFromHash(): ProfileTarget | null {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash;
    const stashdbMatch = hash.match(STASHDB_HASH_PATTERN);
    if (stashdbMatch) {
        const tab = new URLSearchParams(hash.split("?")[1] ?? "").get("tab") ?? undefined;
        return { kind: "stashdb", id: decodeURIComponent(stashdbMatch[1]), tab };
    }
    const localMatch = hash.match(LOCAL_HASH_PATTERN);
    if (localMatch) {
        const tab = new URLSearchParams(hash.split("?")[1] ?? "").get("tab") ?? undefined;
        return { kind: "local", id: decodeURIComponent(localMatch[1]), tab };
    }
    return null;
}

function writeProfileHash(target: ProfileTarget): void {
    if (typeof window === "undefined") return;
    const prefix = target.kind === "stashdb" ? "sdbp" : "p";
    let next = `#/${prefix}/${encodeURIComponent(target.id)}`;
    if (target.tab) {
        next += `?tab=${encodeURIComponent(target.tab)}`;
    }
    if (window.location.hash === next) return;
    window.history.pushState(null, "", next);
}

export function PerformerProfileProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const [currentProfile, setCurrentProfile] = useState<ProfileTarget | null>(
        () => readProfileFromHash()
    );

    useEffect(() => {
        const onHashChange = () => {
            setCurrentProfile(readProfileFromHash());
        };
        window.addEventListener("hashchange", onHashChange);
        return () => window.removeEventListener("hashchange", onHashChange);
    }, []);

    const openProfile = useCallback((id: string, tab?: string) => {
        const target: ProfileTarget = { kind: "local", id, tab };
        writeProfileHash(target);
        setCurrentProfile(target);
    }, []);

    const openStashDBProfile = useCallback((stashId: string, tab?: string) => {
        const target: ProfileTarget = { kind: "stashdb", id: stashId, tab };
        writeProfileHash(target);
        setCurrentProfile(target);
    }, []);

    const close = useCallback(() => {
        if (readProfileFromHash()) {
            // back() pops the entry this profile pushed, and the
            // hashchange that follows clears the state. But there is
            // nothing to pop when the profile hash is where the page
            // STARTED - a shared link, a bookmark, a reload - and then
            // nothing clears it either, so the close button did nothing
            // at all. The timer is the fallback for exactly that: if no
            // hashchange arrived, close directly.
            const before = window.location.hash;
            window.history.back();
            window.setTimeout(() => {
                if (window.location.hash === before) setCurrentProfile(null);
            }, 120);
        } else {
            setCurrentProfile(null);
        }
    }, []);

    return (
        <PerformerProfileContext.Provider
            value={{
                currentProfile,
                openProfile,
                openStashDBProfile,
                close,
            }}
        >
            {children}
        </PerformerProfileContext.Provider>
    );
}

export function usePerformerProfile() {
    const ctx = useContext(PerformerProfileContext);
    if (!ctx) {
        throw new Error(
            "usePerformerProfile must be used within PerformerProfileProvider"
        );
    }
    return ctx;
}

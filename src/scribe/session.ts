// Resumable interview/result state. Key format matches stash-scribe
// exactly so sessions roundtrip — open a scene in Scribe, close it,
// open the same scene in binge, see the same in-progress interview.

import type { LLMMessage } from "./api";

export interface ScribeSession {
    messages: LLMMessage[];
    // number | null so a draft remembers a score the user cleared;
    // dropping the key would make it look untouched when reloaded.
    generated: {
        review: string;
        scores: Record<string, number | null>;
    } | null;
}

export function sessionKeyForScene(sceneId: string): string {
    return `stashScribe.session.scene.${sceneId}`;
}

export function sessionKeyForPerformer(performerId: string): string {
    return `stashScribe.session.performer.${performerId}`;
}

// Validated, not cast.
//
// This key is deliberately shared with the separate stash-scribe plugin
// so a draft roundtrips between them, which means the value here is
// written by code this one does not control. Checking only that
// `messages` is an array and casting the rest let a foreign or corrupt
// draft through: a `generated` block with no `scores` produced
// `setScores(undefined)` and threw while rendering, and a messages array
// of nulls threw in the transcript. The only error boundary is at the
// app root, so either one replaced the whole of binge with the error
// screen - and since the bad value stays in storage, reopening did it
// again.
function isMessage(v: unknown): v is ScribeSession["messages"][number] {
    return (
        !!v &&
        typeof v === "object" &&
        typeof (v as { role?: unknown }).role === "string" &&
        typeof (v as { content?: unknown }).content === "string"
    );
}

function isScoreMap(v: unknown): boolean {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    return Object.values(v as Record<string, unknown>).every(
        (x) => x === null || typeof x === "number",
    );
}

export function loadSession(key: string): ScribeSession | null {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const obj = parsed as Record<string, unknown>;
        if (!Array.isArray(obj.messages)) return null;
        const messages = obj.messages.filter(isMessage);

        // A malformed draft is dropped rather than the whole session:
        // the transcript is still worth resuming without it.
        const g = obj.generated;
        const generated =
            g &&
            typeof g === "object" &&
            typeof (g as { review?: unknown }).review === "string" &&
            isScoreMap((g as { scores?: unknown }).scores)
                ? (g as ScribeSession["generated"])
                : null;

        return { messages, generated };
    } catch {
        return null;
    }
}

export function saveSession(key: string, state: ScribeSession): void {
    try {
        localStorage.setItem(key, JSON.stringify(state));
    } catch (err) {
        console.warn("[binge-scribe] session save failed", err);
    }
}

export function clearSession(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch {
        /* ignore */
    }
}

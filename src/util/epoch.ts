// Turning a remote epoch-seconds value into an ISO date.
//
// `new Date(x).toISOString()` throws RangeError rather than returning
// NaN, for anything outside +-8.64e15 milliseconds and for anything
// that is not a number at all. The daemon's timestamps come from
// Reddit, PornHub and X, so they are remote data twice over, and the
// obvious guard people write, `x > 0`, passes every one of the values
// that throws.
//
// One of these sat on a synchronous render path, where the throw took
// down the entire app: React unwound to the error boundary and the
// whole of binge was replaced by an error screen, which reappeared on
// reload because the daemon kept returning the same value.

/// Largest millisecond value the Date type accepts.
const MAX_TIME_MS = 8.64e15;

/// An epoch-seconds value we can safely convert.
export function isUsableEpochSeconds(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        Math.abs(value) * 1000 <= MAX_TIME_MS
    );
}

/// ISO string for an epoch-seconds value, or `fallback` when the value
/// cannot be represented. Never throws.
export function isoFromEpochSeconds(value: unknown, fallback = ""): string {
    if (!isUsableEpochSeconds(value) || value <= 0) return fallback;
    try {
        return new Date(value * 1000).toISOString();
    } catch {
        // Belt and braces: the guard above should make this
        // unreachable, and this function exists precisely because the
        // obvious guard did not hold.
        return fallback;
    }
}

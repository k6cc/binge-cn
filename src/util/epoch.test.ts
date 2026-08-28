import { describe, expect, it } from "vitest";
import { isoFromEpochSeconds, isUsableEpochSeconds } from "./epoch";

// These values reach the app from Reddit, PornHub and X by way of the
// daemon, so they are remote twice over. `new Date(x).toISOString()`
// throws rather than returning NaN, and one of these conversions sat on
// a synchronous render path, where the throw replaced the whole app
// with an error screen that came back on every reload.
describe("isoFromEpochSeconds", () => {
    it("converts an ordinary timestamp", () => {
        expect(isoFromEpochSeconds(1_700_000_000)).toBe(
            "2023-11-14T22:13:20.000Z",
        );
    });

    // The guard that was actually written, `x > 0`, passes this one.
    it("refuses a value beyond what a Date can hold", () => {
        expect(isoFromEpochSeconds(1e18)).toBe("");
        expect(isUsableEpochSeconds(1e18)).toBe(false);
    });

    it("refuses the things that are not numbers at all", () => {
        for (const bad of [undefined, null, "1700000000", {}, [], NaN]) {
            expect(isoFromEpochSeconds(bad)).toBe("");
        }
    });

    it("refuses infinities", () => {
        expect(isoFromEpochSeconds(Infinity)).toBe("");
        expect(isoFromEpochSeconds(-Infinity)).toBe("");
    });

    it("treats zero and negatives as absent", () => {
        expect(isoFromEpochSeconds(0)).toBe("");
        expect(isoFromEpochSeconds(-1)).toBe("");
    });

    it("uses the caller's fallback when one is given", () => {
        expect(isoFromEpochSeconds(undefined, "later")).toBe("later");
        expect(isoFromEpochSeconds(1e18, "later")).toBe("later");
    });

    it("accepts the largest value a Date can actually represent", () => {
        // 8.64e15 ms is the limit, so 8.64e12 seconds is the last
        // second that converts.
        expect(isUsableEpochSeconds(8.64e12)).toBe(true);
        expect(isUsableEpochSeconds(8.64e12 + 1)).toBe(false);
    });
});

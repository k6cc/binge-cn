// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The daemon URL can arrive from Stash's own plugin config, which means
// it is chosen by whoever can write that config rather than by the
// person holding the browser, and it propagates to every device that
// loads binge. So a seeded URL must not vouch for itself: a public
// https host has to surface the confirmation banner instead.
//
// The first attempt at this stopped the seed calling confirmDaemonOrigin
// and achieved nothing, because a grandfather migration elsewhere in the
// same file vouches for whatever daemon URL it finds on its first run --
// which, after the seed, was the seeded one.

const gqlMock = vi.fn();
vi.mock("../api/graphql", () => ({
    gql: (...args: unknown[]) => gqlMock(...args),
}));

const EVIL = "https://evil.attacker.example";

beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    gqlMock.mockReset();
    gqlMock.mockResolvedValue({
        configuration: { plugins: { binge: { serverUrl: EVIL } } },
    });
    vi.stubGlobal("location", { hostname: "stash.example.com" });
});

afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe("a seeded daemon URL does not vouch for itself", () => {
    it("is stored but not confirmed", async () => {
        const mod = await import("./pluginSettings");
        await mod.ensureBingeServerUrlSeeded();

        // Stored, so the user can see and edit it.
        expect(mod.readBingeServerUrl()).toBe(EVIL);
        // Not vouched for, so the Settings banner appears.
        expect(mod.confirmedDaemonOrigins()).not.toContain(EVIL);
    });

    it("stays unconfirmed even after the migration has run", async () => {
        const mod = await import("./pluginSettings");
        await mod.ensureBingeServerUrlSeeded();
        // The migration is what used to launder it; run it explicitly.
        mod.confirmedDaemonOrigins();
        expect(mod.confirmedDaemonOrigins()).not.toContain(EVIL);
    });

    it("does not grandfather a URL that was already configured", async () => {
        // This used to pass, and passing was the bug: the key it reads
        // has been written by the seed since v0.4.0, so "already
        // configured" does not mean "configured by a person". An install
        // carrying a seeded attacker URL had it confirmed on the first
        // daemon fetch, silently. A public daemon someone really did
        // choose costs one click in Settings to say so.
        localStorage.setItem("binge.bingeServerUrl", "https://mine.example");
        const mod = await import("./pluginSettings");
        expect(mod.confirmedDaemonOrigins()).not.toContain(
            "https://mine.example",
        );
    });

    it("still lets Settings vouch for one deliberately", async () => {
        // The replacement path for the case the grandfather was meant to
        // serve. It has to keep working, or removing the migration just
        // strands everyone with a public daemon.
        const mod = await import("./pluginSettings");
        mod.confirmDaemonOrigin("https://mine.example");
        expect(mod.confirmedDaemonOrigins()).toContain("https://mine.example");
    });
});

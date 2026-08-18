// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedDaemonUrl } from "./bingeServer";

// The deployment matrix, as a guard against making setup harder.
//
// The trust gate decides whether binge hands a daemon the Stash API key
// and the Reddit/X cookies. Tightening it is only acceptable if the ways
// people actually run this keep working with no extra step, so every
// supported shape is listed here and expected to pass untouched. A change
// that breaks one of these is a change that makes someone's install stop
// working, which is a much worse outcome than the attack being defended
// against.

function withStashAt(hostname: string, fn: () => void) {
    vi.stubGlobal("location", { hostname });
    try {
        fn();
    } finally {
        vi.unstubAllGlobals();
    }
}

afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
});

describe("supported deployments need no confirmation step", () => {
    const zeroStep: Array<[string, string, string]> = [
        [
            "all in one, browsing localhost",
            "localhost",
            "http://localhost:7878",
        ],
        [
            "Stash on a NAS, browsed over the LAN",
            "192.168.1.5",
            "http://192.168.1.5:7878",
        ],
        ["bare LAN hostname", "mini", "http://mini:7878"],
        ["mDNS name", "mini.local", "http://mini.local:7878"],
        ["private range 10/8", "10.0.0.9", "http://10.0.0.42:7878"],
        ["Tailscale host", "pc.tail01.ts.net", "https://pc.tail01.ts.net"],
        [
            "Tailscale Funnel for the daemon",
            "stash.tail01.ts.net",
            "https://binge.tail01.ts.net",
        ],
        ["tailnet CGNAT address", "100.80.0.5", "http://100.80.203.49:7878"],
        // The reverse-proxy shapes, which are the ones a stricter rule
        // would plausibly have broken.
        [
            "reverse proxy, daemon on a sibling subdomain",
            "stash.example.com",
            "https://binge.example.com",
        ],
        [
            "reverse proxy, same host different port",
            "stash.example.com",
            "https://stash.example.com:7878",
        ],
        [
            "reverse proxy, deeper subdomain",
            "stash.home.example.com",
            "https://binge.example.com",
        ],
    ];

    for (const [name, stashHost, daemonUrl] of zeroStep) {
        it(name, () => {
            withStashAt(stashHost, () => {
                expect(isTrustedDaemonUrl(daemonUrl)).toBe(true);
            });
        });
    }
});

describe("a daemon nobody configured is not trusted", () => {
    it("refuses an unrelated public host", () => {
        withStashAt("stash.example.com", () => {
            expect(isTrustedDaemonUrl("https://evil.attacker.com")).toBe(false);
        });
    });

    // ...but setting it is the confirmation, and both routes that set the
    // URL record it, so this is never an extra step for a real user.
    it("accepts it once the origin has been recorded", () => {
        localStorage.setItem("binge.daemonOriginsMigrated", "1");
        localStorage.setItem(
            "binge.daemonOriginsOk",
            JSON.stringify(["https://binge.elsewhere.net"]),
        );
        withStashAt("stash.example.com", () => {
            expect(isTrustedDaemonUrl("https://binge.elsewhere.net")).toBe(
                true,
            );
            // Recording one origin must not vouch for any other.
            expect(isTrustedDaemonUrl("https://evil.attacker.com")).toBe(false);
        });
    });

    // An install that predates the confirmation store keeps working: the
    // URL already there was put there by someone, so it is carried over
    // once rather than interrupting them to re-confirm it.
    it("grandfathers a URL configured before this existed", () => {
        localStorage.setItem(
            "binge.bingeServerUrl",
            "https://binge.elsewhere.net",
        );
        withStashAt("stash.example.com", () => {
            expect(isTrustedDaemonUrl("https://binge.elsewhere.net")).toBe(
                true,
            );
        });
    });
});

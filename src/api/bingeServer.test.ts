// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTrustedDaemonUrl } from "./bingeServer";

// This gate decides whether binge will hand the Stash API key, the Reddit
// session cookie and the X auth cookies to a given daemon URL. Its job is
// not only to avoid cleartext on the open internet, but to contain an
// attacker who can rewrite the daemon-URL setting (another same-origin
// plugin, or XSS) and would otherwise have binge post the secrets to a
// host of their choosing. So these read as attacks, not as happy paths.

describe("isTrustedDaemonUrl", () => {
    // https used to short-circuit to trusted before any host check ran,
    // which meant an attacker who could rewrite the daemon-URL setting
    // (the very case this file exists for) only had to point it at an
    // https host of their own. Transport secrecy is not the same as
    // knowing who is on the other end.
    it("accepts https to the local machine, LAN and tailnet", () => {
        expect(isTrustedDaemonUrl("https://foo.ts.net:7878")).toBe(true);
        expect(isTrustedDaemonUrl("https://localhost:7878")).toBe(true);
        expect(isTrustedDaemonUrl("https://mini.local")).toBe(true);
        expect(isTrustedDaemonUrl("https://mini")).toBe(true);
        expect(isTrustedDaemonUrl("https://192.168.1.10:7878")).toBe(true);
    });

    it("refuses https to an unrelated public host that was never set", () => {
        expect(isTrustedDaemonUrl("https://evil.example.com")).toBe(false);
        expect(isTrustedDaemonUrl("https://binge.example.com")).toBe(false);
    });

    it("accepts https under the same domain as the Stash page", () => {
        // The ordinary reverse-proxy deployment: Stash on one subdomain,
        // the daemon on another. No confirmation needed for it.
        vi.stubGlobal("location", { hostname: "stash.example.com" });
        expect(isTrustedDaemonUrl("https://binge.example.com")).toBe(true);
        expect(isTrustedDaemonUrl("https://stash.example.com:7878")).toBe(true);
        expect(isTrustedDaemonUrl("https://evil.com")).toBe(false);
        vi.unstubAllGlobals();
    });

    it("accepts a public host once its origin has been recorded", () => {
        // setBingeServerUrl records the origin, so typing it in Settings
        // or seeding it from Stash's plugin config both land here. A URL
        // that appeared by neither route stays untrusted.
        localStorage.setItem("binge.daemonOriginsMigrated", "1");
        localStorage.setItem(
            "binge.daemonOriginsOk",
            JSON.stringify(["https://binge.example.com"]),
        );
        expect(isTrustedDaemonUrl("https://binge.example.com")).toBe(true);
        expect(isTrustedDaemonUrl("https://other.example.org")).toBe(false);
        localStorage.clear();
    });

    it("accepts plain http to the local machine", () => {
        expect(isTrustedDaemonUrl("http://localhost:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://127.0.0.1:7878")).toBe(true);
    });

    it("accepts plain http on the LAN and the tailnet", () => {
        expect(isTrustedDaemonUrl("http://192.168.1.10:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://10.0.0.42:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://172.16.5.5:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://100.80.203.49:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://mini.local:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://mini:7878")).toBe(true);
    });

    it("refuses cleartext to a public host", () => {
        expect(isTrustedDaemonUrl("http://evil.example.com:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://1.1.1.1:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://8.8.8.8")).toBe(false);
    });

    it("refuses public ranges that only look private", () => {
        // 172.32 is outside 172.16/12, and 100.128 is outside the CGNAT
        // block, so an off-by-one in the range checks would show up here.
        expect(isTrustedDaemonUrl("http://172.32.0.1:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://172.15.0.1:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://100.128.0.1:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://100.63.0.1:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://11.0.0.1:7878")).toBe(false);
        expect(isTrustedDaemonUrl("http://193.168.1.1:7878")).toBe(false);
    });

    it("is not fooled by a private-looking subdomain", () => {
        expect(isTrustedDaemonUrl("http://127.0.0.1.evil.com")).toBe(false);
        expect(isTrustedDaemonUrl("http://localhost.evil.com")).toBe(false);
        expect(isTrustedDaemonUrl("http://evil.com/localhost")).toBe(false);
    });

    it("is not fooled by credentials in the authority", () => {
        // The host here is evil.com; "localhost" is just a username.
        expect(isTrustedDaemonUrl("http://localhost@evil.com")).toBe(false);
        expect(isTrustedDaemonUrl("http://192.168.1.1@evil.com")).toBe(false);
    });

    it("is not fooled by an alternate encoding of a public address", () => {
        // The URL parser normalises these to dotted quads before we look,
        // so the range checks still see the real address.
        expect(isTrustedDaemonUrl("http://16843009")).toBe(false); // 1.1.1.1
        expect(isTrustedDaemonUrl("http://0x08080808")).toBe(false); // 8.8.8.8
        // ...and the same normalisation must not break real loopback forms.
        expect(isTrustedDaemonUrl("http://2130706433")).toBe(true); // 127.0.0.1
        expect(isTrustedDaemonUrl("http://0177.0.0.1")).toBe(true); // 127.0.0.1
    });

    it("refuses cleartext to a public IPv6 address", () => {
        // IPv6 literals contain no dots, so a bare-hostname shortcut would
        // wave these straight through and post the secrets to the internet.
        expect(isTrustedDaemonUrl("http://[2001:4860:4860::8888]:7878")).toBe(
            false,
        );
        expect(isTrustedDaemonUrl("http://[2606:4700:4700::1111]")).toBe(false);
    });

    it("accepts IPv6 loopback and the private IPv6 ranges", () => {
        expect(isTrustedDaemonUrl("http://[::1]:7878")).toBe(true);
        // Unique local (fc00::/7) and link local (fe80::/10).
        expect(isTrustedDaemonUrl("http://[fd12:3456::1]:7878")).toBe(true);
        expect(isTrustedDaemonUrl("http://[fe80::1]:7878")).toBe(true);
    });

    it("refuses anything that is not http(s)", () => {
        expect(isTrustedDaemonUrl("ftp://192.168.1.1")).toBe(false);
        expect(isTrustedDaemonUrl("javascript:alert(1)")).toBe(false);
        expect(isTrustedDaemonUrl("file:///etc/passwd")).toBe(false);
        expect(isTrustedDaemonUrl("data:text/plain,hi")).toBe(false);
    });

    it("refuses input that is not a URL at all", () => {
        expect(isTrustedDaemonUrl("")).toBe(false);
        expect(isTrustedDaemonUrl("   ")).toBe(false);
        expect(isTrustedDaemonUrl("not a url")).toBe(false);
        expect(isTrustedDaemonUrl("//192.168.1.1")).toBe(false);
    });
});

// Knowing where the key MAY go is only half of it. These check where it
// actually goes, because the guard existed and was simply not applied to
// the two paths that carry the key on every single request.
describe("where the Stash API key is actually sent", () => {
    const KEY = "stash-api-key-secret";

    async function load(daemonUrl: string) {
        vi.resetModules();
        localStorage.clear();
        localStorage.setItem("binge.bingeServerUrl", daemonUrl);
        // The key is read from Stash via the shared GraphQL client.
        vi.doMock("./queries", () => ({
            fetchStashApiKey: () => Promise.resolve(KEY),
        }));
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({}),
        }));
        vi.stubGlobal("fetch", fetchMock);
        const mod = await import("./bingeServer");
        return { mod, fetchMock };
    }

    const headerOf = (fetchMock: ReturnType<typeof vi.fn>) => {
        const init = fetchMock.mock.calls[0]?.[1] ?? {};
        return (init.headers ?? {}).ApiKey;
    };

    beforeEach(() => {
        vi.unstubAllGlobals();
        vi.doUnmock("./queries");
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("sends the key to a tailnet daemon over https", async () => {
        const { mod, fetchMock } = await load("https://binge.example.ts.net");
        await mod.getBingeServerHealth();
        expect(headerOf(fetchMock)).toBe(KEY);
    });

    it("sends the key to a daemon on localhost", async () => {
        const { mod, fetchMock } = await load("http://localhost:7878");
        await mod.getBingeServerHealth();
        expect(headerOf(fetchMock)).toBe(KEY);
    });

    it("withholds the key from a public http daemon", async () => {
        // The daemon URL can be typed by the user, seeded from Stash's
        // plugin config, or rewritten by anything with same-origin
        // access. Every request would otherwise hand the key over.
        const { mod, fetchMock } = await load("http://evil.example.com:7878");
        await mod.getBingeServerHealth();
        expect(fetchMock).toHaveBeenCalled();
        expect(headerOf(fetchMock)).toBeUndefined();
    });

    it("withholds the key from the save endpoint too", async () => {
        const { mod, fetchMock } = await load("http://evil.example.com:7878");
        await mod.saveToStash({
            url: "https://x.com/i/status/1",
        } as unknown as Parameters<typeof mod.saveToStash>[0]);
        expect(headerOf(fetchMock)).toBeUndefined();
    });

    it("keeps the key out of media URLs handed to img and video", async () => {
        // A query string is the worst place for a secret: it lands in
        // access logs, Referer headers and browser history.
        const { mod } = await load("http://evil.example.com:7878");
        await mod.getBingeServerHealth(); // primes the cached key
        expect(mod.pornhubStreamUrl("abc")).not.toContain(KEY);
        expect(mod.pornhubPreviewUrl("abc")).not.toContain(KEY);
        expect(mod.pornhubThumbUrl("https://cdn/x.jpg")).not.toContain(KEY);
        expect(
            mod.rewriteRedgifsMediaUrl("https://media.redgifs.com/a.mp4"),
        ).not.toContain(KEY);
        expect(
            mod.rewriteRedditMediaUrl("https://i.redd.it/a.jpg"),
        ).not.toContain(KEY);
    });

    it("still keys media URLs for a daemon that may have it", async () => {
        const { mod } = await load("https://binge.example.ts.net");
        await mod.getBingeServerHealth();
        expect(mod.pornhubStreamUrl("abc")).toContain(
            "apikey=" + encodeURIComponent(KEY),
        );
    });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTrustedDaemonUrl } from "./bingeServer";

// This gate decides whether binge will hand the Stash API key, the Reddit
// session cookie and the X auth cookies to a given daemon URL. Its job is
// not only to avoid cleartext on the open internet, but to contain an
// attacker who can rewrite the daemon-URL setting (another same-origin
// plugin, or XSS) and would otherwise have binge post the secrets to a
// host of their choosing. So these read as attacks, not as happy paths.

describe("isTrustedDaemonUrl", () => {
    it("accepts https anywhere, since the transport protects the secret", () => {
        expect(isTrustedDaemonUrl("https://binge.example.com")).toBe(true);
        expect(isTrustedDaemonUrl("https://foo.ts.net:7878")).toBe(true);
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

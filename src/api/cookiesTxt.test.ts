import { describe, it, expect } from "vitest";
import { parseCookiesTxt, describeParse } from "./cookiesTxt";

// A cookies.txt row. Passing "" for expiry is not a contrivance: that is
// what exporters write for a session cookie, and reddit_session usually
// is one.
function row(
    domain: string,
    name: string,
    value: string,
    expiry: string = "1799999999",
    httpOnly = false,
): string {
    const d = httpOnly ? `#HttpOnly_${domain}` : domain;
    return [d, "TRUE", "/", "TRUE", expiry, name, value].join("\t");
}

describe("parseCookiesTxt", () => {
    it("finds a Reddit session and formats it as a Cookie header value", () => {
        const p = parseCookiesTxt(row(".reddit.com", "reddit_session", "ABC"));
        expect(p.redditSessionCookie).toBe("reddit_session=ABC");
        expect(p.found).toEqual(["Reddit session"]);
    });

    // The cookie binge actually needs is httpOnly, so every real export
    // carries this prefix. Treating it as a comment would find nothing.
    it("reads a row behind the #HttpOnly_ prefix", () => {
        const p = parseCookiesTxt(
            row(".reddit.com", "reddit_session", "ABC", "1799999999", true),
        );
        expect(p.redditSessionCookie).toBe("reddit_session=ABC");
    });

    // The regression this file was written for. An empty field used to
    // collapse into its neighbour and shift the row left, dropping it.
    it("reads a session cookie, which has no expiry field", () => {
        const p = parseCookiesTxt(
            row(".reddit.com", "reddit_session", "ABC", ""),
        );
        expect(p.redditSessionCookie).toBe("reddit_session=ABC");
    });

    it("reads a session cookie behind #HttpOnly_, which is the real-world case", () => {
        const p = parseCookiesTxt(
            row(".reddit.com", "reddit_session", "ABC", "", true),
        );
        expect(p.redditSessionCookie).toBe("reddit_session=ABC");
        expect(p.found).toEqual(["Reddit session"]);
    });

    it("still reads space-separated exports", () => {
        const line = ".reddit.com TRUE / TRUE 1799999999 reddit_session ABC";
        expect(parseCookiesTxt(line).redditSessionCookie).toBe(
            "reddit_session=ABC",
        );
    });

    it("takes X cookies from either x.com or twitter.com", () => {
        const p = parseCookiesTxt(
            [
                row(".x.com", "auth_token", "AUTH"),
                row(".twitter.com", "ct0", "CT"),
            ].join("\n"),
        );
        expect(p.xAuthToken).toBe("AUTH");
        expect(p.xCt0).toBe("CT");
        expect(p.found).toContain("X login");
    });

    // auth_token is useless without ct0, so half a pair is no pair.
    it("drops a lone auth_token rather than half-configuring X", () => {
        const p = parseCookiesTxt(row(".x.com", "auth_token", "AUTH"));
        expect(p.xAuthToken).toBeUndefined();
        expect(p.xCt0).toBeUndefined();
        expect(p.found).not.toContain("X login");
    });

    it("matches subdomains but not lookalike domains", () => {
        const ok = parseCookiesTxt(
            row("www.reddit.com", "reddit_session", "ABC"),
        );
        expect(ok.redditSessionCookie).toBe("reddit_session=ABC");

        const evil = parseCookiesTxt(
            row("notreddit.com", "reddit_session", "ABC"),
        );
        expect(evil.redditSessionCookie).toBeUndefined();
    });

    it("ignores comments and blank lines", () => {
        const text = [
            "# Netscape HTTP Cookie File",
            "",
            row(".reddit.com", "reddit_session", "ABC"),
            "   ",
        ].join("\n");
        expect(parseCookiesTxt(text).redditSessionCookie).toBe(
            "reddit_session=ABC",
        );
    });

    it("counts domains so an unhelpful file can be told from a broken parser", () => {
        const text = [
            row(".example.com", "sid", "1"),
            row(".other.com", "sid", "2"),
        ].join("\n");
        const p = parseCookiesTxt(text);
        expect(p.domainCount).toBe(2);
        expect(p.found).toEqual([]);
        expect(describeParse(p)).toContain("2 domains");
    });

    it("says a file is not a cookies.txt when nothing parses at all", () => {
        expect(describeParse(parseCookiesTxt("hello world"))).toContain(
            "doesn't look like a cookies.txt",
        );
    });
});

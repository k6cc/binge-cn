// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { safeExternalUrl } from "./externalUrl";

// binge runs inside Stash with the user's session, so a URL that came
// from a performer's website field or a daemon response is not
// something to open as given.
describe("safeExternalUrl", () => {
    it("passes ordinary links through", () => {
        expect(safeExternalUrl("https://reddit.com/r/pics")).toBe(
            "https://reddit.com/r/pics",
        );
        expect(safeExternalUrl("http://192.168.1.5:8080/x")).toBe(
            "http://192.168.1.5:8080/x",
        );
    });

    it("refuses schemes that execute", () => {
        for (const bad of [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "  javascript:alert(1)",
            "\njavascript:alert(1)",
            "java\tscript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox",
            "file:///etc/passwd",
        ]) {
            expect(safeExternalUrl(bad)).toBeNull();
        }
    });

    it("refuses things that are not strings", () => {
        for (const bad of [undefined, null, 42, {}, []]) {
            expect(safeExternalUrl(bad)).toBeNull();
        }
    });

    it("refuses empty and unparseable values", () => {
        expect(safeExternalUrl("")).toBeNull();
        expect(safeExternalUrl("   ")).toBeNull();
        expect(safeExternalUrl("http://")).toBeNull();
    });
});

// These are links out to another site. A relative value used to be
// resolved against Stash's own origin and returned as "safe", so a
// daemon handing back "/settings" became a link that acts on the
// user's own Stash.
describe("relative values are not external links", () => {
    it("refuses them", () => {
        for (const rel of ["/settings", "settings", "../admin", "//evil.com"]) {
            expect(safeExternalUrl(rel)).toBeNull();
        }
    });
});

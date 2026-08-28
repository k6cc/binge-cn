import { describe, expect, it } from "vitest";
import { pickStreamUrl } from "./pickStream";
import type { BingeScene } from "../api/queries";

// The transcode preferences exist for a library whose direct stream the
// browser cannot decode - HEVC in an MP4 container is the usual case.
// Stash lists the direct entry FIRST and gives it mime_type video/mp4
// for an .mp4 source, so a predicate that accepts the mime alone matched
// the direct stream and find() never reached the transcode. That handed
// the setting's whole audience the stream they were trying to avoid,
// while Settings said it would force a transcode.

const scene = {
    paths: { stream: "/scene/1/stream" },
    sceneStreams: [
        {
            url: "/direct",
            label: "Direct stream",
            mime_type: "video/mp4",
        },
        { url: "/mp4", label: "MP4", mime_type: "video/mp4" },
        { url: "/webm", label: "WEBM", mime_type: "video/webm" },
        {
            url: "/hls",
            label: "HLS",
            mime_type: "application/vnd.apple.mpegurl",
        },
    ],
} as unknown as BingeScene;

describe("pickStreamUrl", () => {
    it("does not return the direct stream when a transcode was asked for", () => {
        expect(pickStreamUrl(scene, "mp4")).toBe("/mp4");
        expect(pickStreamUrl(scene, "webm")).toBe("/webm");
    });

    it("still returns the direct stream when that is the preference", () => {
        expect(pickStreamUrl(scene, "direct")).toBe("/direct");
    });

    it("finds HLS by mime as well as by label", () => {
        expect(pickStreamUrl(scene, "hls")).toBe("/hls");
    });

    it("falls back to paths.stream when nothing matches", () => {
        const bare = {
            paths: { stream: "/fallback" },
            sceneStreams: [],
        } as unknown as BingeScene;
        expect(pickStreamUrl(bare, "mp4")).toBe("/fallback");
    });
});

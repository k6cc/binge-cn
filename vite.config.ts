import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

// Single-file build: the reel SPA is inlined into dist/index.html. The
// vanilla-JS entry script `binge.entry.js` lives in public/ so Vite copies
// it to dist/ untouched — it runs inside Stash's main SPA via PluginApi.

// Copy the plugin manifest into dist/ after build so the folder mirrors
// the release zip layout (binge.yml + binge.entry.js + index.html +
// binge-install.py) and can be dropped whole into Stash's plugins dir
// for local testing.
function copyPluginManifest(): Plugin {
    return {
        name: "copy-plugin-manifest",
        apply: "build",
        closeBundle() {
            copyFileSync(
                resolve(process.cwd(), "binge.yml"),
                resolve(process.cwd(), "dist/binge.yml"),
            );
        },
    };
}

export default defineConfig({
    base: "./",
    plugins: [react(), viteSingleFile(), copyPluginManifest()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        assetsInlineLimit: 10_000_000,
    },
});

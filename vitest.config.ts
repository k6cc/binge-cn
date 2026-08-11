import { defineConfig } from "vitest/config";

// Node is the default environment because most of what is worth testing
// here is plain logic: the rating replica, the chain recommender, the
// collections tag layer, the rating-plugin config parser. Files that do
// need a DOM (the multiview cache, the daemon-URL guard, and the two
// component suites) opt in with a `// @vitest-environment jsdom` docblock,
// so the fast majority never pays for jsdom startup.
export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
});

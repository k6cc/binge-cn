import { defineConfig } from "vitest/config";

// Unit tests only, for the parts of binge that hold real logic and no DOM:
// the rating replica, the chain recommender, and the collections tag layer.
// Node environment on purpose - nothing here needs a browser, and jsdom
// would only slow the suite down.
export default defineConfig({
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});

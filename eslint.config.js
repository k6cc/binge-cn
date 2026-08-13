import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
    globalIgnores(["dist"]),
    {
        files: ["**/*.{ts,tsx}"],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            reactHooks.configs.flat.recommended,
            reactRefresh.configs.vite,
        ],
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            // eslint-plugin-react-hooks v7 folds the React Compiler's own
            // diagnostics into `recommended`. The ones that catch real defects
            // (rules-of-hooks, exhaustive-deps, purity, immutability, refs) stay
            // on as errors. These two only describe what the compiler would
            // refuse to optimise, and binge does not run the compiler:
            //
            //   set-state-in-effect  - fires on the ordinary "reset paging state
            //     when the performer/collection changes, then fetch" shape used
            //     across the grids. Satisfying it means moving those resets to
            //     key-based remounts, which is a real refactor with real
            //     behaviour changes, not a lint fix.
            //   incompatible-library - TanStack Virtual returns functions the
            //     compiler cannot memoize. Nothing to fix in our code; it is
            //     telling us it skipped optimising Reel and Feed.
            //
            // Turn both back on when adopting the compiler, and treat what they
            // report then as the migration checklist.
            "react-hooks/set-state-in-effect": "off",
            "react-hooks/incompatible-library": "off",
        },
    },
    {
        // Context modules deliberately export a provider component alongside
        // the hook and types that go with it. Splitting them would buy nothing
        // but an extra file each; the rule only guards dev-server Fast Refresh,
        // and binge ships as a single prebuilt bundle.
        files: ["**/*Context.tsx"],
        rules: {
            "react-refresh/only-export-components": "off",
        },
    },
]);

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Multiview queue is shared state: the Multiview plugin UI, its
// player, binge-iOS and multiview-ios all read and write the same
// configuration.plugins.multiView.queue. binge-iOS once shipped a version
// that wrote its local snapshot back wholesale and silently wiped eight
// scenes another client had added. These tests exist so the web client
// cannot regress into that: every write must be a read-modify-write
// against live config, and must preserve what it did not intend to touch.

// A fake Stash whose config we can mutate mid-flight to simulate another
// client writing at the worst possible moment.
function fakeStash() {
    const state: {
        queue: unknown[];
        writes: unknown[][];
        onFetch?: () => void;
    } = { queue: [], writes: [] };

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (typeof body.query === "string" && body.query.includes("mutation")) {
            state.queue = JSON.parse(body.variables.input.queue);
            state.writes.push(state.queue);
            return {
                ok: true,
                json: async () => ({ data: { configurePlugin: true } }),
            } as unknown as Response;
        }
        state.onFetch?.();
        return {
            ok: true,
            json: async () => ({
                data: {
                    configuration: {
                        plugins: {
                            multiView: { queue: JSON.stringify(state.queue) },
                        },
                    },
                },
            }),
        } as unknown as Response;
    });

    vi.stubGlobal("fetch", fetchMock);
    return state;
}

const load = () => import("./multiview");
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    localStorage.clear();
});

describe("local cache reads", () => {
    it("reports membership and count from the cache", async () => {
        const {
            MULTIVIEW_STORAGE_KEY,
            isInMultiviewQueue,
            multiviewQueueCount,
        } = await load();
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify(["a", "b"]));
        expect(isInMultiviewQueue("a")).toBe(true);
        expect(isInMultiviewQueue("z")).toBe(false);
        expect(multiviewQueueCount()).toBe(2);
    });

    it("survives a corrupt cache rather than throwing at render time", async () => {
        const {
            MULTIVIEW_STORAGE_KEY,
            isInMultiviewQueue,
            multiviewQueueCount,
        } = await load();
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, "{not json");
        expect(isInMultiviewQueue("a")).toBe(false);
        expect(multiviewQueueCount()).toBe(0);
    });

    it("ignores a cache holding the wrong shape", async () => {
        const { MULTIVIEW_STORAGE_KEY, multiviewQueueCount } = await load();
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, '{"queue":1}');
        expect(multiviewQueueCount()).toBe(0);
    });
});

describe("toggle writes back to config", () => {
    it("adds a scene without disturbing what another client added", async () => {
        const stash = fakeStash();
        stash.queue = ["theirs-1", "theirs-2"];
        const { toggleMultiviewQueueScene } = await load();

        // The local cache is empty, i.e. stale: it has never seen the two
        // scenes another client queued. The old iOS bug was writing this
        // empty snapshot back.
        expect(toggleMultiviewQueueScene("mine")).toBe(true);
        await settle();

        expect(stash.queue).toEqual(["theirs-1", "theirs-2", "mine"]);
    });

    it("removes only the scene asked for", async () => {
        const stash = fakeStash();
        stash.queue = ["a", "b", "c"];
        const { MULTIVIEW_STORAGE_KEY, toggleMultiviewQueueScene } =
            await load();
        localStorage.setItem(
            MULTIVIEW_STORAGE_KEY,
            JSON.stringify(["a", "b", "c"]),
        );

        expect(toggleMultiviewQueueScene("b")).toBe(false);
        await settle();

        expect(stash.queue).toEqual(["a", "c"]);
    });

    it("preserves filter slots it does not understand", async () => {
        // Only the Multiview UI creates these. binge must round-trip them.
        const stash = fakeStash();
        const slot = { type: "filter", filter: { tags: [1, 2] } };
        stash.queue = [slot, "a"];
        const { toggleMultiviewQueueScene } = await load();

        toggleMultiviewQueueScene("b");
        await settle();

        expect(stash.queue).toEqual([slot, "a", "b"]);
    });

    it("re-applies its intent when a concurrent write clobbers it", async () => {
        const stash = fakeStash();
        stash.queue = ["a"];
        const { toggleMultiviewQueueScene } = await load();

        // Another client overwrites the queue in the window between our
        // write and our read-back, dropping the scene we just added.
        let clobbered = false;
        stash.onFetch = () => {
            if (!clobbered && stash.writes.length === 1) {
                clobbered = true;
                stash.queue = ["a", "someone-else"];
            }
        };

        toggleMultiviewQueueScene("mine");
        await settle();
        await settle();

        expect(stash.queue).toContain("mine");
        expect(stash.queue).toContain("someone-else");
    });

    it("does not write at all when config already agrees", async () => {
        const stash = fakeStash();
        stash.queue = ["a"];
        const { MULTIVIEW_STORAGE_KEY, toggleMultiviewQueueScene } =
            await load();
        // Cache says absent, config says present: the intent is already
        // satisfied, so there is nothing to write.
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify([]));

        toggleMultiviewQueueScene("a");
        await settle();

        expect(stash.writes).toHaveLength(0);
    });

    it("refuses to exceed the queue cap", async () => {
        const full = Array.from({ length: 16 }, (_, i) => "s" + i);
        const stash = fakeStash();
        stash.queue = [...full];
        const { MULTIVIEW_STORAGE_KEY, toggleMultiviewQueueScene } =
            await load();
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify(full));

        expect(toggleMultiviewQueueScene("one-too-many")).toBe(false);
        await settle();

        expect(stash.writes).toHaveLength(0);
        expect(stash.queue).toHaveLength(16);
    });

    it("keeps the cache when Stash is unreachable", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("offline");
            }),
        );
        const { MULTIVIEW_STORAGE_KEY, toggleMultiviewQueueScene } =
            await load();
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify(["a"]));

        // The optimistic flip still answers the button immediately.
        expect(toggleMultiviewQueueScene("b")).toBe(true);
        await settle();
        expect(
            JSON.parse(localStorage.getItem(MULTIVIEW_STORAGE_KEY)!),
        ).toEqual(["a", "b"]);
    });
});

describe("syncMultiviewFromConfig", () => {
    it("pulls another client's changes into the cache", async () => {
        const stash = fakeStash();
        stash.queue = ["theirs"];
        const { MULTIVIEW_STORAGE_KEY, syncMultiviewFromConfig } = await load();

        await syncMultiviewFromConfig();

        expect(
            JSON.parse(localStorage.getItem(MULTIVIEW_STORAGE_KEY)!),
        ).toEqual(["theirs"]);
    });

    it("leaves the cache alone when the fetch fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => {
                throw new Error("offline");
            }),
        );
        const { MULTIVIEW_STORAGE_KEY, syncMultiviewFromConfig } = await load();
        localStorage.setItem(MULTIVIEW_STORAGE_KEY, JSON.stringify(["keep"]));

        await syncMultiviewFromConfig();

        expect(
            JSON.parse(localStorage.getItem(MULTIVIEW_STORAGE_KEY)!),
        ).toEqual(["keep"]);
    });

    it("treats a Stash with no multiview config as an empty queue", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                json: async () => ({
                    data: { configuration: { plugins: {} } },
                }),
            })),
        );
        const { multiviewQueueCount, syncMultiviewFromConfig } = await load();
        await syncMultiviewFromConfig();
        expect(multiviewQueueCount()).toBe(0);
    });
});

describe("subscribeMultiviewQueue", () => {
    it("fires on a same-tab change and stops after unsubscribe", async () => {
        fakeStash();
        const { subscribeMultiviewQueue, toggleMultiviewQueueScene } =
            await load();
        const cb = vi.fn();
        const off = subscribeMultiviewQueue(cb);

        toggleMultiviewQueueScene("a");
        expect(cb).toHaveBeenCalled();

        off();
        cb.mockClear();
        toggleMultiviewQueueScene("b");
        expect(cb).not.toHaveBeenCalled();
    });
});

// "Could not read the queue" and "the queue is empty" were the same
// answer, and the caller writes back afterwards. A GraphQL 200 carrying
// an errors array, which is what an auth blip looks like, therefore
// replaced a full queue with a single entry.
//
// These assert on what was written. An earlier version relied on a
// throw inside the mutation mock to fail the test, which applyIntent
// catches and swallows, so both tests passed even with the bug present.
describe("a queue that cannot be read is not an empty queue", () => {
    it("writes nothing when the read returns graphql errors", async () => {
        const state = fakeStash();
        state.queue = ["theirs-1", "theirs-2"];
        const good = globalThis.fetch as typeof fetch;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => {
                const body = JSON.parse(String(init?.body ?? "{}"));
                if (String(body.query).includes("mutation")) {
                    return good(url, init);
                }
                return {
                    ok: true,
                    json: async () => ({ errors: [{ message: "nope" }] }),
                } as unknown as Response;
            }),
        );
        const { toggleMultiviewQueueScene, startMultiviewSync } = await load();
        toggleMultiviewQueueScene("mine");
        startMultiviewSync();
        await settle();
        expect(state.writes).toHaveLength(0);
        expect(state.queue).toEqual(["theirs-1", "theirs-2"]);
    });

    it("writes nothing when the response is not ok", async () => {
        const state = fakeStash();
        state.queue = ["theirs-1", "theirs-2"];
        const good = globalThis.fetch as typeof fetch;
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string, init?: RequestInit) => {
                const body = JSON.parse(String(init?.body ?? "{}"));
                if (String(body.query).includes("mutation")) {
                    return good(url, init);
                }
                return { ok: false, status: 502 } as unknown as Response;
            }),
        );
        const { toggleMultiviewQueueScene, startMultiviewSync } = await load();
        toggleMultiviewQueueScene("mine");
        startMultiviewSync();
        await settle();
        expect(state.writes).toHaveLength(0);
        expect(state.queue).toEqual(["theirs-1", "theirs-2"]);
    });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Repair only ever adds. The property every test here guards is that a
// column Stash already holds is never written, whatever StashDB says,
// and that a profile with nothing to fill produces no write at all: a
// no-op update would still land in Stash's edit history.

const scrape = vi.fn();
const link = vi.fn();
const box = vi.fn();

vi.mock("./mutations", () => ({
    scrapeStashBoxPerformer: (...a: unknown[]) => scrape(...a),
}));
vi.mock("./linkExistingScenes", () => ({
    linkExistingScenesToPerformer: (...a: unknown[]) => link(...a),
}));
vi.mock("./stashdb", () => ({
    getStashDBBox: () => box(),
}));

interface Call {
    query: string;
    variables: Record<string, unknown>;
}
const calls: Call[] = [];
let local: Record<string, unknown> | null = null;
let updateThrows = false;

vi.mock("./graphql", () => ({
    gql: async (query: string, variables: Record<string, unknown> = {}) => {
        calls.push({ query, variables });
        if (query.includes("PerformerFillState")) {
            return { findPerformer: local };
        }
        if (query.includes("PerformerUpdateFields")) {
            if (updateThrows) throw new Error("stash refused");
            const input = variables.input as { id: string };
            return { performerUpdate: { id: input.id } };
        }
        throw new Error(`unexpected query: ${query.slice(0, 40)}`);
    },
}));

import {
    describeRepair,
    fillPerformerFromStashDB,
    repairPerformerFromStashDB,
} from "./repairPerformer";

const BLANK = {
    id: "7",
    name: "Kait",
    disambiguation: null,
    gender: null,
    birthdate: null,
    death_date: null,
    ethnicity: null,
    country: null,
    eye_color: null,
    hair_color: null,
    height_cm: null,
    weight: null,
    measurements: null,
    fake_tits: null,
    career_length: null,
    tattoos: null,
    piercings: null,
    details: null,
    alias_list: [],
    urls: [],
};

const FULL_SCRAPE = {
    name: "Explicit Kait",
    gender: "FEMALE",
    birthdate: "1990-01-02",
    country: "US",
    eye_color: "Blue",
    hair_color: "Brown",
    height: "162 cm",
    weight: "55 kg",
    aliases: "Kait, Explicit K",
    url: "https://example.com/kait",
    twitter: "https://x.com/kait",
    instagram: "https://instagram.com/kait",
    details: "A bio.",
};

const updates = () =>
    calls
        .filter((c) => c.query.includes("PerformerUpdateFields"))
        .map((c) => c.variables.input as Record<string, unknown>);

const fill = () =>
    fillPerformerFromStashDB({
        localPerformerId: "7",
        stashDBPerformerId: "sdb-kait",
        stashBoxIndex: 0,
    });

beforeEach(() => {
    calls.length = 0;
    local = { ...BLANK };
    updateThrows = false;
    scrape.mockReset();
    link.mockReset();
    box.mockReset();
    box.mockResolvedValue({
        index: 0,
        endpoint: "https://stashdb.org/graphql",
        api_key: "k",
    });
    link.mockResolvedValue({
        matched: 0,
        linked: 0,
        failed: false,
        lookupFailed: false,
    });
});

describe("fillPerformerFromStashDB", () => {
    it("fills the blanks and leaves every filled column alone", async () => {
        // A hand-corrected eye colour and a birthdate that disagree with
        // StashDB. Both must survive.
        local = { ...BLANK, eye_color: "Purple", birthdate: "1985-05-05" };
        scrape.mockResolvedValue(FULL_SCRAPE);

        const filled = await fill();

        expect(updates()).toHaveLength(1);
        const input = updates()[0];
        expect(input).not.toHaveProperty("eye_color");
        expect(input).not.toHaveProperty("birthdate");
        expect(input).toMatchObject({
            id: "7",
            gender: "FEMALE",
            country: "US",
            hair_color: "Brown",
            height_cm: 162,
            weight: 55,
            details: "A bio.",
            alias_list: ["Kait", "Explicit K"],
            urls: [
                "https://example.com/kait",
                "https://x.com/kait",
                "https://instagram.com/kait",
            ],
        });
        expect(filled).toContain("gender");
        expect(filled).toContain("links");
        expect(filled).toContain("aliases");
        expect(filled).not.toContain("eye colour");
        expect(filled).not.toContain("birth date");
    });

    it("writes nothing when StashDB has nothing to add", async () => {
        scrape.mockResolvedValue({ name: "Kait" });

        expect(await fill()).toEqual([]);
        expect(updates()).toHaveLength(0);
    });

    it("writes nothing when the scrape fails", async () => {
        scrape.mockResolvedValue(null);

        expect(await fill()).toEqual([]);
        expect(updates()).toHaveLength(0);
    });

    it("writes nothing when the performer is gone", async () => {
        local = null;
        scrape.mockResolvedValue(FULL_SCRAPE);

        expect(await fill()).toEqual([]);
        expect(updates()).toHaveLength(0);
        // No point scraping for a row that is not there.
        expect(scrape).not.toHaveBeenCalled();
    });

    it("leaves links and aliases alone once any exist", async () => {
        // One link is a list the user owns. Appending StashDB's socials
        // to it is a judgement the repair does not make.
        local = {
            ...BLANK,
            urls: ["https://onlyfans.com/kait"],
            alias_list: ["K"],
        };
        scrape.mockResolvedValue(FULL_SCRAPE);

        const filled = await fill();

        expect(updates()[0]).not.toHaveProperty("urls");
        expect(updates()[0]).not.toHaveProperty("alias_list");
        expect(filled).not.toContain("links");
        expect(filled).not.toContain("aliases");
    });

    it("skips a height or weight it cannot read as a number", async () => {
        scrape.mockResolvedValue({
            name: "Kait",
            height: "tall",
            weight: "0",
        });

        expect(await fill()).toEqual([]);
        expect(updates()).toHaveLength(0);
    });

    it("does not list the same social twice", async () => {
        scrape.mockResolvedValue({
            name: "Kait",
            url: "https://x.com/kait",
            twitter: "https://x.com/kait",
        });

        await fill();

        expect(updates()[0].urls).toEqual(["https://x.com/kait"]);
    });

    it("treats whitespace as blank on both sides", async () => {
        local = { ...BLANK, gender: "   " };
        scrape.mockResolvedValue({
            name: "Kait",
            gender: "FEMALE",
            country: "   ",
        });

        const filled = await fill();

        expect(updates()[0]).toMatchObject({ gender: "FEMALE" });
        expect(updates()[0]).not.toHaveProperty("country");
        expect(filled).toEqual(["gender"]);
    });
});

describe("repairPerformerFromStashDB", () => {
    const repair = () =>
        repairPerformerFromStashDB({
            localPerformerId: "7",
            stashDBPerformerId: "sdb-kait",
        });

    it("attaches scenes and fills columns, and reports both", async () => {
        link.mockResolvedValue({
            matched: 3,
            linked: 3,
            failed: false,
            lookupFailed: false,
        });
        scrape.mockResolvedValue({ name: "Kait", gender: "FEMALE" });

        const r = await repair();

        expect(link).toHaveBeenCalledWith({
            localPerformerId: "7",
            stashDBPerformerId: "sdb-kait",
        });
        expect(r).toEqual({
            linked: 3,
            filled: ["gender"],
            linkFailed: false,
            lookupFailed: false,
        });
    });

    it("still fills the columns when the scene link failed", async () => {
        link.mockResolvedValue({
            matched: 2,
            linked: 0,
            failed: true,
            lookupFailed: false,
        });
        scrape.mockResolvedValue({ name: "Kait", gender: "FEMALE" });

        const r = await repair();

        expect(r.linkFailed).toBe(true);
        expect(r.filled).toEqual(["gender"]);
    });

    it("reports a refused write as nothing filled rather than throwing", async () => {
        scrape.mockResolvedValue({ name: "Kait", gender: "FEMALE" });
        updateThrows = true;

        const r = await repair();

        expect(r.filled).toEqual([]);
    });

    it("skips the fill when no stash-box is configured", async () => {
        box.mockResolvedValue(null);

        const r = await repair();

        expect(scrape).not.toHaveBeenCalled();
        expect(r.filled).toEqual([]);
    });
});

describe("describeRepair", () => {
    const base = {
        linked: 0,
        filled: [] as string[],
        linkFailed: false,
        lookupFailed: false,
    };

    it.each([
        [
            { ...base, linked: 2, filled: ["gender", "links"] },
            "Attached 2 scenes you already had, and filled in gender and links.",
        ],
        [{ ...base, linked: 1 }, "Attached 1 scene you already had."],
        [
            { ...base, filled: ["gender", "bio", "links"] },
            "Filled in gender, bio and links.",
        ],
        [
            { ...base, linkFailed: true, filled: ["gender"] },
            "Could not attach her scenes, and filled in gender.",
        ],
        [{ ...base, lookupFailed: true }, "Couldn't reach StashDB just now."],
        [
            base,
            "Nothing to do. This profile already has everything StashDB knows.",
        ],
    ])("%j", (result, expected) => {
        expect(describeRepair(result)).toBe(expected);
    });
});

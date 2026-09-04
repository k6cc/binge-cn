import i18n from "../i18n/config";
import { gql } from "./graphql";
import { getSourceBox } from "./stashdb";
import { scrapeStashBoxPerformer } from "./mutations";
import { linkExistingScenesToPerformer } from "./linkExistingScenes";

// Putting a stub performer row right, from StashDB.
//
// Two separate things are wrong with these rows and both look the same
// from the profile:
//
// The row has no columns. Stash's own tagger and forage create a
// performer from a scene match carrying a name, an image and the
// stash_ids link and nothing else - no gender for the feed's gender
// filter to read, no bio, and no urls, which is the only field
// xHandleFromUrls looks at and therefore the only thing standing
// between a performer and her story ring. binge's own Follow scrapes
// the full record, so these are not binge's doing, but binge is where
// the cost shows: 136 of one library's 904 linked performers are in
// this state.
//
// And nobody is attached to her scenes. Identifying a scene against
// StashDB does not link a performer to it, so the library can hold
// several of hers with an empty performers array on every one while
// the profile reports zero scenes over them. That half already exists
// as linkExistingScenesToPerformer; it just had no way in except a
// follow.
//
// Both halves only ever add. Columns are filled where Stash has
// nothing and never overwritten - a repair that clobbered a
// hand-corrected birthdate would be worse than the blank profile it
// set out to fix - and scenes are added to, never replaced.

// Every column the fill is allowed to write, read back before writing
// anything. Deliberately not the profile's own query: the fill has to
// know about columns nothing renders (measurements, tattoos, career
// length) to be sure it is not writing over one already filled in.
const PERFORMER_FILL_STATE = /* GraphQL */ `
    query PerformerFillState($id: ID!) {
        findPerformer(id: $id) {
            id
            name
            disambiguation
            gender
            birthdate
            death_date
            ethnicity
            country
            eye_color
            hair_color
            height_cm
            weight
            measurements
            fake_tits
            career_length
            tattoos
            piercings
            details
            alias_list
            urls
        }
    }
`;

const PERFORMER_UPDATE_FIELDS = /* GraphQL */ `
    mutation PerformerUpdateFields($input: PerformerUpdateInput!) {
        performerUpdate(input: $input) {
            id
        }
    }
`;

interface FillStateRow {
    id: string;
    name: string;
    disambiguation: string | null;
    gender: string | null;
    birthdate: string | null;
    death_date: string | null;
    ethnicity: string | null;
    country: string | null;
    eye_color: string | null;
    hair_color: string | null;
    height_cm: number | null;
    weight: number | null;
    measurements: string | null;
    fake_tits: string | null;
    career_length: string | null;
    tattoos: string | null;
    piercings: string | null;
    details: string | null;
    alias_list: string[] | null;
    urls: string[] | null;
}

function blank(value: string | null | undefined): boolean {
    return !value || value.trim() === "";
}

// The scraper answers height and weight as strings ("162", "175 cm").
function leadingInt(value: string | null | undefined): number | null {
    if (!value) return null;
    const m = /-?\d+(\.\d+)?/.exec(value);
    if (!m) return null;
    const n = Math.round(Number(m[0]));
    return Number.isFinite(n) && n > 0 ? n : null;
}

/// Fill the blank columns on an existing performer. Returns the field
/// keys (performer.repair.fields.*) of what was written, empty when
/// there was nothing to fill.
export async function fillPerformerFromStashDB(args: {
    localPerformerId: string;
    stashDBPerformerId: string;
    stashBoxIndex: number;
}): Promise<string[]> {
    // What Stash holds now. Read first: without it there is no way to
    // write only the gaps.
    const state = await gql<{ findPerformer: FillStateRow | null }>(
        PERFORMER_FILL_STATE,
        { id: args.localPerformerId },
    );
    const local = state.findPerformer;
    if (!local) return [];

    const scraped = await scrapeStashBoxPerformer({
        stashBoxIndex: args.stashBoxIndex,
        stashDBPerformerId: args.stashDBPerformerId,
    });
    if (!scraped) return [];

    const input: Record<string, unknown> = { id: args.localPerformerId };
    const filled: string[] = [];

    const fill = (
        label: string,
        key: string,
        existing: string | null,
        value: string | null | undefined,
    ) => {
        if (!blank(existing)) return;
        if (blank(value)) return;
        input[key] = (value as string).trim();
        filled.push(label);
    };

    const fillInt = (
        label: string,
        key: string,
        existing: number | null,
        value: string | null | undefined,
    ) => {
        if (existing !== null && existing !== undefined) return;
        const n = leadingInt(value);
        if (n === null) return;
        input[key] = n;
        filled.push(label);
    };

    fill("gender", "gender", local.gender, scraped.gender);
    fill("birthdate", "birthdate", local.birthdate, scraped.birthdate);
    fill("death_date", "death_date", local.death_date, scraped.death_date);
    fill("country", "country", local.country, scraped.country);
    fill("ethnicity", "ethnicity", local.ethnicity, scraped.ethnicity);
    fill("hair_color", "hair_color", local.hair_color, scraped.hair_color);
    fill("eye_color", "eye_color", local.eye_color, scraped.eye_color);
    fill(
        "measurements",
        "measurements",
        local.measurements,
        scraped.measurements,
    );
    fill("fake_tits", "fake_tits", local.fake_tits, scraped.fake_tits);
    fill(
        "career_length",
        "career_length",
        local.career_length,
        scraped.career_length,
    );
    fill("tattoos", "tattoos", local.tattoos, scraped.tattoos);
    fill("piercings", "piercings", local.piercings, scraped.piercings);
    fill(
        "disambiguation",
        "disambiguation",
        local.disambiguation,
        scraped.disambiguation,
    );
    fill("details", "details", local.details, scraped.details);
    fillInt("height", "height_cm", local.height_cm, scraped.height);
    fillInt("weight", "weight", local.weight, scraped.weight);

    if ((local.alias_list ?? []).length === 0 && !blank(scraped.aliases)) {
        const list = (scraped.aliases as string)
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean);
        if (list.length > 0) {
            input.alias_list = list;
            filled.push("alias_list");
        }
    }

    if ((local.urls ?? []).length === 0) {
        // The scraper answers socials in the deprecated twitter /
        // instagram / url columns; they land in the modern array.
        // `urls` is what both clients read for the link chips and the
        // only one xHandleFromUrls looks at, so an X link written to
        // the old column would draw a chip and leave the ring dark.
        const urls: string[] = [];
        for (const candidate of [
            scraped.url,
            scraped.twitter,
            scraped.instagram,
        ]) {
            if (blank(candidate)) continue;
            const v = (candidate as string).trim();
            if (!urls.includes(v)) urls.push(v);
        }
        if (urls.length > 0) {
            input.urls = urls;
            filled.push("urls");
        }
    }

    // Nothing to do. Returning rather than writing keeps a no-op out of
    // Stash's edit history.
    if (filled.length === 0) return [];

    await gql(PERFORMER_UPDATE_FIELDS, { input });
    return filled;
}

export interface RepairResult {
    /// Scenes the library already held that she is now attached to.
    linked: number;
    /// Field keys (performer.repair.fields.*) of the columns filled in.
    filled: string[];
    /// The scene link found candidates but the write failed.
    linkFailed: boolean;
    /// StashDB could not be reached, so nothing is known either way.
    lookupFailed: boolean;
}

/// Both halves, scenes first so a caller that reloads afterwards shows
/// them. Never throws: every failure is reported in the result, since
/// the point of the action is telling the user what happened.
export async function repairPerformerFromStashDB(args: {
    localPerformerId: string;
    stashDBPerformerId: string;
}): Promise<RepairResult> {
    const link = await linkExistingScenesToPerformer({
        localPerformerId: args.localPerformerId,
        stashDBPerformerId: args.stashDBPerformerId,
    });

    let filled: string[] = [];
    try {
        const box = await getSourceBox();
        if (box) {
            filled = await fillPerformerFromStashDB({
                localPerformerId: args.localPerformerId,
                stashDBPerformerId: args.stashDBPerformerId,
                stashBoxIndex: box.index,
            });
        }
    } catch (err) {
        console.warn("[binge] filling performer columns failed", err);
    }

    return {
        linked: link.linked,
        filled,
        linkFailed: link.failed,
        lookupFailed: link.lookupFailed,
    };
}

/// ["attached 2 scenes", "filled in gender"] ->
/// "Attached 2 scenes, and filled in gender."
/// 本仓库 i18n 适配：字段名、连接词与句读全部走 locale（zh 为
/// "已挂接 2 个你库中已有的场景，并补全了性别。"式组装），文案中的
/// "StashDB" 由 i18n/config.ts 的 sourceName 后处理器替换为活动源
/// 展示名。
export function describeRepair(result: RepairResult): string {
    const parts: string[] = [];
    if (result.linked > 0) {
        parts.push(
            result.linked === 1
                ? i18n.t("performer.repair.attached_one")
                : i18n.t("performer.repair.attached_other", {
                      count: result.linked,
                  }),
        );
    } else if (result.linkFailed) {
        parts.push(i18n.t("performer.repair.attach_failed"));
    }
    if (result.filled.length > 0) {
        parts.push(
            i18n.t("performer.repair.filled", {
                fields: fieldList(result.filled),
            }),
        );
    }
    if (parts.length === 0) {
        return result.lookupFailed
            ? i18n.t("performer.repair.unreachable")
            : i18n.t("performer.repair.nothing_to_do");
    }
    const joined = parts.join(i18n.t("performer.repair.parts_joiner"));
    return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}${i18n.t("performer.repair.sentence_end")}`;
}

function fieldList(keys: string[]): string {
    const names = keys.map((k) => i18n.t(`performer.repair.fields.${k}`));
    if (names.length <= 1) return names[0] ?? "";
    const joiner = i18n.t("performer.repair.list_joiner");
    const finalJoiner = i18n.t("performer.repair.list_final_joiner");
    return `${names.slice(0, -1).join(joiner)}${finalJoiner}${names[names.length - 1]}`;
}

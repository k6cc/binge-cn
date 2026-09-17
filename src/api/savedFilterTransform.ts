// Stash stores a SavedFilter's criteria in `object_filter` using the
// UI's internal shape — the raw criterion objects produced by
// ListFilterModel.makeSavedFilter() (`{ value, modifier }`), NOT the
// shape the findScenes `scene_filter` argument expects. The UI's
// Criterion classes convert between the two via toCriterionInput()
// before submitting a query; binge has to do the same conversion.
//
// Shape reference, verified against the Stash UI source
// (ui/v2.5/src/models/list-filter/criteria/*.ts) and the GraphQL
// schema (graphql/schema/types/filters.graphql) on 2026-09:
//
//   1. Int/Float/Date/Timestamp criteria wrap their value an extra
//      level deep:
//        stored: { modifier: LESS_THAN, value: { value: 2 } }
//        input : { modifier: LESS_THAN, value: 2 }
//      Range modifiers (BETWEEN / NOT_BETWEEN) keep value2 at the same
//      nested level — we flatten both.
//
//   2. ID-list criteria (performers / tags / studios / groups /
//      galleries / movies / parent_studios / scenes) store LABELED id
//      objects, not plain ids:
//        stored: { modifier: INCLUDES, value: { items: [{ id, label }],
//                  excluded: [{ id, label }] } }
//        input : { modifier: INCLUDES, value: ["id"], excludes: ["id"] }
//      Older Stash saved the value as a bare [{ id, label }] array;
//      both shapes are unwrapped here.
//
//   3. Boolean scalar fields (organized / interactive /
//      performer_favorite) store the UI's string form:
//        stored: { modifier: EQUALS, value: "true" }
//        input : true
//      has_markers / is_missing are STRING scalars — their stored value
//      passes through as-is.
//
//   4. StashID criterion stores its value as { endpoint, stashID }:
//        stored: { modifier: EQUALS, value: { endpoint, stashID } }
//        input : { modifier: EQUALS, endpoint, stash_id }
//
//   5. DuplicatedCriterionInput has no modifier/value fields — the
//      stored { modifier, value: { phash, url, ... } } wrapper must be
//      stripped to the inner flag object.
//
//   6. OrientationCriterionInput has no modifier field — drop it and
//      forward the value array.
//
//   7. The scenes UI's "folder" criterion maps to
//      files_filter.parent_folder — a scene saved filter using it used
//      to fail the whole query with a GraphQL 400 because
//      SceneFilterType has no `folder` field.
//
// Unknown keys are dropped (with a console warning) rather than passed
// through: the Stash UI itself silently ignores criteria it cannot
// express when loading a saved filter (UnsupportedCriterion
// applyToCriterionInput is a no-op), and an unknown field otherwise
// fails the ENTIRE findScenes query with a 400.

// SceneFilterType fields whose GraphQL input is a plain Boolean scalar
// (stored criterion-wrapped with the UI's string "true"/"false").
const BOOLEAN_SCALAR_FIELDS: ReadonlySet<string> = new Set([
    "organized",
    "interactive",
    "performer_favorite",
]);

// SceneFilterType fields whose GraphQL input is a plain String scalar
// (stored criterion-wrapped; the string passes through).
const STRING_SCALAR_FIELDS: ReadonlySet<string> = new Set([
    "has_markers",
    "is_missing",
]);

// MultiCriterionInput fields — id list + optional excludes.
const MULTI_CRITERION_FIELDS: ReadonlySet<string> = new Set([
    "performers",
    "movies",
    "galleries",
    "scenes",
    "parent_studios",
]);

// HierarchicalMultiCriterionInput fields — id list + excludes + depth.
const HIERARCHICAL_CRITERION_FIELDS: ReadonlySet<string> = new Set([
    "tags",
    "scene_tags",
    "performer_tags",
    "studios",
    "groups",
]);

// StashIDCriterionInput / StashIDsCriterionInput fields.
const STASH_ID_FIELDS: ReadonlySet<string> = new Set([
    "stash_id_endpoint",
    "stash_ids_endpoint",
]);

// DuplicationCriterionInput — no modifier/value fields at all.
const DUPLICATED_FIELDS: ReadonlySet<string> = new Set(["duplicated"]);

// OrientationCriterionInput — value array only, no modifier.
const ORIENTATION_FIELDS: ReadonlySet<string> = new Set(["orientation"]);

// PhashDistanceCriterionInput — { value, modifier, distance }.
const PHASH_DISTANCE_FIELDS: ReadonlySet<string> = new Set([
    "phash_distance",
]);

// Scenes-UI "folder" criterion → files_filter.parent_folder.
const FOLDER_FIELDS: ReadonlySet<string> = new Set(["folder"]);

// SceneFilterType fields whose input is IntCriterionInput (value: Int!).
// A legacy null-test without a stored value needs a numeric placeholder —
// the current schema declares value as Int! and rejects "".
const INT_CRITERION_FIELDS: ReadonlySet<string> = new Set([
    "id",
    "file_count",
    "rating100",
    "o_counter",
    "framerate",
    "bitrate",
    "duration",
    "tag_count",
    "performer_age",
    "performer_count",
    "stash_id_count",
    "interactive_speed",
    "resume_time",
    "play_count",
    "play_duration",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toBoolean(v: unknown): boolean {
    return v === true || v === "true";
}

// Unwrap any stored id-list shape into plain id strings:
//   ["id"] | [{ id, label }] | { items: [...], excluded: [...] }
function idsOf(v: unknown): string[] {
    if (Array.isArray(v)) {
        const out: string[] = [];
        for (const x of v) {
            if (typeof x === "string") {
                if (x) out.push(x);
            } else if (isPlainObject(x) && typeof x.id === "string") {
                out.push(x.id);
            }
        }
        return out;
    }
    if (isPlainObject(v) && Array.isArray(v.items)) {
        return idsOf(v.items);
    }
    return [];
}

// Multi / Hierarchical id-list criteria. Modifier EXCLUDES is replaced
// with INCLUDES + everything moved to `excludes` — the same
// normalisation the Stash UI performs for backward compatibility.
function transformIdList(
    c: Record<string, unknown>,
    hierarchical: boolean,
): Record<string, unknown> {
    const modifier = c.modifier;
    const value = c.value;
    const out: Record<string, unknown> = {};

    if (!("value" in c) || value === undefined || value === null) {
        // Legacy null-test stored without a value.
        out.modifier = modifier;
        return out;
    }

    const items = isPlainObject(value) ? value.items ?? [] : value;
    const excluded = isPlainObject(value) ? value.excluded ?? [] : [];
    const itemIds = idsOf(items);
    const excludedIds = idsOf(excluded);

    if (modifier === "EXCLUDES") {
        out.modifier = "INCLUDES";
        out.value = [];
        out.excludes = [...itemIds, ...excludedIds];
    } else {
        out.modifier = modifier;
        out.value = itemIds;
        if (excludedIds.length > 0) out.excludes = excludedIds;
    }

    if (hierarchical && isPlainObject(value) && value.depth !== undefined) {
        out.depth = value.depth;
    }
    return out;
}

function transformStashIds(
    c: Record<string, unknown>,
    field: string,
): Record<string, unknown> {
    const out: Record<string, unknown> = { modifier: c.modifier };
    const value = c.value;
    if (isPlainObject(value)) {
        const endpoint = value.endpoint ?? "";
        if (endpoint) out.endpoint = endpoint;
        if (field === "stash_id_endpoint") {
            out.stash_id = value.stashID ?? value.stash_id ?? "";
        } else {
            out.stash_ids = value.stashIDs ?? value.stash_ids ?? [];
        }
    } else if (field === "stash_id_endpoint" && typeof value === "string") {
        // Legacy flat stash id.
        out.stash_id = value;
    } else if (field === "stash_ids_endpoint" && Array.isArray(value)) {
        out.stash_ids = value;
    }
    return out;
}

// DuplicationCriterionInput has no modifier/value fields; the stored
// wrapper is stripped to the inner flag object.
function transformDuplicated(
    c: Record<string, unknown>,
): Record<string, unknown> {
    const value = c.value;
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const k of [
            "duplicated",
            "distance",
            "phash",
            "url",
            "stash_id",
            "title",
        ]) {
            if (value[k] !== undefined) out[k] = value[k];
        }
        return out;
    }
    // Legacy { value: "true" } → phash flag.
    return { phash: toBoolean(value) };
}

function transformPhash(
    c: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = { modifier: c.modifier };
    const value = c.value;
    if (isPlainObject(value)) {
        out.value = value.value ?? "";
        if (value.distance !== undefined && value.distance !== null) {
            out.distance = value.distance;
        }
    } else {
        out.value = value ?? "";
    }
    return out;
}

// Transform a single `{modifier, value}` criterion from the UI's stored
// shape to the findScenes input shape for the generic numeric/date/
// string criteria that the specific handlers above don't own.
function transformCriterion(
    v: Record<string, unknown>,
    field: string,
): Record<string, unknown> {
    const modifier = v.modifier;
    const value = v.value;

    // No value at all (legacy IS_NULL / NOT_NULL stored without a value
    // key). String/Date/Timestamp inputs require value: String! — fill
    // with ""; Int inputs require value: Int! — fill with 0.
    if (!("value" in v) || value === undefined || value === null) {
        return INT_CRITERION_FIELDS.has(field)
            ? { modifier, value: 0 }
            : { modifier, value: "" };
    }

    // Numeric range wrap: value is itself { value, value2? }.
    if (
        isPlainObject(value) &&
        "value" in value &&
        Object.keys(value).length <= 2
    ) {
        const inner = value;
        const out: Record<string, unknown> = {
            modifier,
            value: inner.value,
        };
        if (
            "value2" in inner &&
            inner.value2 !== undefined &&
            inner.value2 !== null
        ) {
            out.value2 = inner.value2;
        }
        return out;
    }

    // Already-flat shape (strings, arrays of ids, etc.). Pass through.
    return v;
}

export function transformObjectFilter(
    obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    if (!obj || !isPlainObject(obj)) return {};
    const out: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
        if (val === null || val === undefined) continue;

        // Boolean scalar fields: stored string "true"/"false" → boolean.
        if (BOOLEAN_SCALAR_FIELDS.has(key)) {
            out[key] = toBoolean(isPlainObject(val) ? val.value : val);
            continue;
        }

        // String scalar fields: unwrap to the inner value.
        if (STRING_SCALAR_FIELDS.has(key)) {
            out[key] =
                isPlainObject(val) && "value" in val ? val.value : val;
            continue;
        }

        if (!isPlainObject(val) || !("modifier" in val)) {
            // Already input-shaped (custom_fields array, nested
            // *_filter objects, etc.) — pass through.
            out[key] = val;
            continue;
        }

        if (FOLDER_FIELDS.has(key)) {
            // The scenes UI's folder criterion isn't a SceneFilterType
            // field — it applies to the scene's files.
            out.files_filter = {
                parent_folder: transformIdList(val, true),
            };
            continue;
        }

        if (MULTI_CRITERION_FIELDS.has(key)) {
            out[key] = transformIdList(val, false);
            continue;
        }
        if (HIERARCHICAL_CRITERION_FIELDS.has(key)) {
            out[key] = transformIdList(val, true);
            continue;
        }
        if (STASH_ID_FIELDS.has(key)) {
            out[key] = transformStashIds(val, key);
            continue;
        }
        if (DUPLICATED_FIELDS.has(key)) {
            out[key] = transformDuplicated(val);
            continue;
        }
        if (ORIENTATION_FIELDS.has(key)) {
            out[key] = {
                value: Array.isArray(val.value) ? val.value : [],
            };
            continue;
        }
        if (PHASH_DISTANCE_FIELDS.has(key)) {
            out[key] = transformPhash(val);
            continue;
        }

        // Any key not modelled above is not a SceneFilterType field on
        // the Stash version this was built against. The Stash UI
        // silently drops criteria it cannot express on load; dropping
        // here keeps the saved filter usable instead of 400-ing the
        // whole query.
        if (!KNOWN_SCENE_FILTER_FIELDS.has(key)) {
            console.warn(
                `[binge] dropping unsupported saved-filter criterion "${key}" (not a SceneFilterType field)`,
            );
            continue;
        }

        out[key] = transformCriterion(val, key);
    }

    return out;
}

// The remaining SceneFilterType fields that flow through the generic
// criterion transform (Int / String / Date / Timestamp / resolution /
// phash…). Anything NOT in this set is either handled above or unknown
// (dropped). Kept in sync with the schema's SceneFilterType.
const KNOWN_SCENE_FILTER_FIELDS: ReadonlySet<string> = new Set([
    ...BOOLEAN_SCALAR_FIELDS,
    ...STRING_SCALAR_FIELDS,
    ...MULTI_CRITERION_FIELDS,
    ...HIERARCHICAL_CRITERION_FIELDS,
    ...STASH_ID_FIELDS,
    ...DUPLICATED_FIELDS,
    ...ORIENTATION_FIELDS,
    ...PHASH_DISTANCE_FIELDS,
    ...FOLDER_FIELDS,
    ...INT_CRITERION_FIELDS,
    "title",
    "code",
    "details",
    "director",
    "oshash",
    "checksum",
    "phash",
    "path",
    "resolution",
    "url",
    "captions",
    "video_codec",
    "audio_codec",
    "date",
    "production_date",
    "created_at",
    "updated_at",
    "last_played_at",
    "custom_fields",
]);

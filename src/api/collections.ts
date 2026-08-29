import { gql } from "./graphql";
import { findTagByName, findTagsContaining } from "./queries";
import {
    sceneUpdate,
    tagCreate,
    tagDestroy,
    tagRename,
    tagSetParents,
} from "./mutations";

// "Save to ..." folder system. Each collection is a Stash tag; the
// bookmark sheet lists all known collections + lets the user create new
// ones inline.
//
// ── Tag naming convention ────────────────────────────────────────────
// Collections use the trailing " 📁" suffix so they're distinguishable
// from other tags in Stash's tag manager and so we can discover them
// in a single substring query at app start. Mirrors the way ASR uses
// " ★" to mark its rating tags.
//
// Two exceptions:
//   1. The "Favourites" collection uses ASR's existing "Favourite ★"
//      tag — we want interop with ASR's UI, not a parallel tag.
//   2. The "Watch Later" default is created on first use with the new
//      suffix. (Was unsuffixed in the prior version of this code; that
//      tag is harmless to leave orphaned.)
//
// v0.4.15: binge 自建的两个默认合集 tagName 从英文改为中文
// （"Watch Later 📁" → "稍后观看 📁"，"My Favourite ❤️" → "我的最爱 ❤️"），
// 与界面显示名一致。旧英文 tag 通过 migrateLegacyTagNamesIfNeeded
// 自动 rename 迁移。Favourite ★ 保持英文（ASR 共享，改名会破坏互操作）。
// v0.4.16: "稍后观看"的 emoji 从文件夹 📁 改为时钟 🕐，与 binge UI
// 里的时钟图标及 Stash 标签管理器的视觉一致。用户自建合集仍用 📁
// 后缀。只迁移英文 → 中文（"Watch Later 📁" → "稍后观看 🕐"），
// 不迁移 v0.4.15 创建的 "稍后观看 📁" → "稍后观看 🕐"（用户明确要求）。

export const COLLECTION_TAG_SUFFIX = " 📁";
const FAVOURITES_TAG_NAME = "Favourite ★"; // ASR 共享，始终英文

// v0.4.17：i18n 联动。Stash 标签名跟随界面语言，通过 syncTagLanguage()
// 手动触发改名。标签语言状态记录在 localStorage（binge.tagLanguage），
// 不做自动检测——用户切换语言后，语言选项下方弹出"同步 Stash 标签"
// 按钮，点击后执行 rename 并更新状态。
// 命名约定：显示名在前，emoji 图标在后（📁 / 🕐 / ❤️）。
interface TagNamesByLang {
    watchLater: string;
    myFavourite: string;
    parent: string;
    favouritesDisplay: string;
    watchLaterDisplay: string;
    myFavouriteDisplay: string;
}
const TAG_NAMES: Record<string, TagNamesByLang> = {
    zh: {
        watchLater: "稍后观看 🕐",
        myFavourite: "我的最爱 ❤️",
        parent: "binge 合集",
        favouritesDisplay: "收藏夹",
        watchLaterDisplay: "稍后观看",
        myFavouriteDisplay: "我的最爱",
    },
    en: {
        watchLater: "Watch Later 🕐",
        myFavourite: "My Favourite ❤️",
        parent: "binge Collections",
        favouritesDisplay: "Favourites",
        watchLaterDisplay: "Watch Later",
        myFavouriteDisplay: "My Favourite",
    },
};
const TAG_LANGUAGE_KEY = "binge.tagLanguage";

export function getTagLanguage(): string {
    try {
        const lang = localStorage.getItem(TAG_LANGUAGE_KEY);
        return lang && TAG_NAMES[lang] ? lang : "zh";
    } catch {
        return "zh";
    }
}

function currentTagNames(): TagNamesByLang {
    return TAG_NAMES[getTagLanguage()] || TAG_NAMES.zh;
}

// 旧英文 → 中文的一次性迁移映射（v0.4.15）。目标固定为中文，不受
// 当前语言影响。
const LEGACY_TAG_NAMES: Record<string, string> = {
    "Watch Later 📁": TAG_NAMES.zh.watchLater,
    "My Favourite ❤️": TAG_NAMES.zh.myFavourite,
};
const LEGACY_PARENT_TAG_NAME = "binge Collections";

export type CollectionIconName =
    | "favourite"
    | "watchLater"
    | "myFavourite"
    | "generic";

export interface CollectionDef {
    name: string; // display label (no suffix, no star)
    tagName: string; // exact Stash tag name (with suffix or ★)
    // The Stash tag id, when this collection's tag exists. Empty for a
    // default that has not been created yet.
    //
    // Carried because the destructive path used to re-resolve the tag
    // from its NAME at delete time, through a lookup that is a SQL LIKE
    // underneath. The id is already in hand here - it came back with
    // the name - and an id cannot near-miss.
    id: string;
    icon: CollectionIconName;
    // Default collections render with their dedicated icon + can't be
    // removed by the user via binge. User-created collections render
    // with the generic folder icon.
    isDefault: boolean;
}

// Display name = tag name with the suffix stripped, for the menu.
function stripSuffix(tagName: string): string {
    if (tagName.endsWith(COLLECTION_TAG_SUFFIX)) {
        return tagName.slice(0, -COLLECTION_TAG_SUFFIX.length);
    }
    return tagName;
}

// ── In-memory cache ──────────────────────────────────────────────────
// Collections list + each tag's resolved Stash id. Cached because every
// SceneSlide that mounts wants both, and we'd rather make one round-trip
// per session than one per slide.

let cachedCollectionsPromise: Promise<CollectionDef[]> | null = null;
let cachedTagIdsPromise: Promise<Map<string, string>> | null = null;
// The same map, resolved without creating anything. Kept separate so a
// read can never be served a result that skipped creation to a caller
// that needed it, nor the other way round.
let cachedReadOnlyTagIdsPromise: Promise<Map<string, string>> | null = null;
type Subscriber = () => void;
const subscribers = new Set<Subscriber>();
function notifySubscribers(): void {
    for (const s of subscribers) s();
}

// React components subscribe so they re-render when a new collection
// is created mid-session.
export function subscribeCollections(fn: Subscriber): () => void {
    subscribers.add(fn);
    return () => {
        subscribers.delete(fn);
    };
}

// Loads the collections list. Always starts with Favourites + Watch
// Later (default), then appends any user-created tags ending in the
// suffix. Default tags are find-or-created lazily on first toggle —
// we don't want loading the menu to mutate the user's tag list.
//
// Bug 9：默认合集的 display name（界面显示名）翻译为中文。
// v0.4.15：binge 自建的两个 tagName 也改为中文（"稍后观看 📁" /
// "我的最爱 ❤️"），与界面显示名一致；Favourite ★ 仍保持英文，因为
// 它由 ASR 插件拥有并共享，改名会破坏 ASR 互操作。
export function getCollections(): Promise<CollectionDef[]> {
    if (cachedCollectionsPromise) return cachedCollectionsPromise;
    cachedCollectionsPromise = (async () => {
        // Ends with, not contains. Stash can only search by substring,
        // so the filter happens here: a tag that merely mentions the
        // suffix somewhere in the middle is the user's own, and
        // enrolling it made binge reparent it without asking and offer
        // it for deletion on the Saved page, where deleting drops the
        // tag from every scene, image and performer in the library.
        const userTags = (
            await findTagsContaining(COLLECTION_TAG_SUFFIX)
        ).filter((t) => t.name.endsWith(COLLECTION_TAG_SUFFIX));
        const byName = new Map(userTags.map((t) => [t.name, t.id]));
        // 需求3：第三个默认合集"我的最爱 ❤️"。tagName 是
        // "My Favourite ❤️"（无 " 📁" 后缀），不会被上面的
        // findTagsContaining 拉回，所以总是从 defaults 数组显式
        // 注入。de-dup 仍按 tagName + 显示名兜底，避免用户手动
        // 建过同名 tag 时出现两个"我的最爱"。
        const names = currentTagNames();
        const defaults: CollectionDef[] = [
            {
                name: names.favouritesDisplay,
                tagName: FAVOURITES_TAG_NAME,
                id: byName.get(FAVOURITES_TAG_NAME) ?? "",
                icon: "favourite",
                isDefault: true,
            },
            {
                name: names.watchLaterDisplay,
                tagName: names.watchLater,
                id: byName.get(names.watchLater) ?? "",
                icon: "watchLater",
                isDefault: true,
            },
            {
                name: names.myFavouriteDisplay,
                tagName: names.myFavourite,
                id: byName.get(names.myFavourite) ?? "",
                icon: "myFavourite",
                isDefault: true,
            },
        ];
        // 需求6：过滤掉与默认合集重复的用户 tag。原先只按 tagName
        // 过滤（"稍后观看 📁"），但如果用户库里有同名的中文 tag
        // （stripSuffix 后与默认 name 相同），会导致列表出现两个
        // "稍后观看"。现在按 stripSuffix 后的 display name 与所有
        // 默认 name 比对，同时仍按 tagName 过滤以排除默认 tag 本身。
        const defaultNames = new Set(defaults.map((d) => d.name));
        const defaultTagNames = new Set(defaults.map((d) => d.tagName));
        const userCollections: CollectionDef[] = userTags
            .filter((t) => !defaultTagNames.has(t.name))
            .filter((t) => !defaultNames.has(stripSuffix(t.name)))
            .map((t) => ({
                name: stripSuffix(t.name),
                tagName: t.name,
                id: t.id,
                icon: "generic" as const,
                isDefault: false,
            }));
        return [...defaults, ...userCollections];
    })().catch((err) => {
        cachedCollectionsPromise = null;
        throw err;
    });
    return cachedCollectionsPromise;
}

// Find-or-create the parent tag every binge collection lives
// under. Created with no children initially — children get the
// parent_ids link set on their own creation (or via reparent for
// existing tags that pre-date the hierarchy). ignore_auto_tag is
// on because the parent is organizational, not metadata.
let cachedParentIdPromise: Promise<string> | null = null;
function ensureCollectionsParentTagId(): Promise<string> {
    if (cachedParentIdPromise) return cachedParentIdPromise;
    cachedParentIdPromise = (async () => {
        const parentName = currentTagNames().parent;
        const existing = await findTagByName(parentName);
        if (existing) return existing.id;
        const created = await tagCreate(parentName, true);
        return created.id;
    })().catch((err) => {
        cachedParentIdPromise = null;
        throw err;
    });
    return cachedParentIdPromise;
}

// Resolve every collection's tag id. Lazy-creates any default tag
// that doesn't exist yet in Stash AND nests every binge-managed
// collection tag under the "binge Collections" parent (creating
// the parent if missing). Existing tags that pre-date the
// hierarchy get reparented in place on first run — a one-time
// migration the user doesn't see.
// Resolve the collection tag ids, creating the default tags if they do
// not exist yet.
//
// `create` exists because this used to create unconditionally and was
// called on mount, so merely scrolling one scene wrote three tags into
// the user's tag tree: someone who installed binge, looked at it and
// uninstalled was left with tags they never asked for, one of them in
// another plugin's namespace. That contradicted this module's own rule
// a few lines up, that loading the menu must not mutate anything. The
// membership display now reads without creating, and the tags appear
// when the user first saves something, which is what the rule intended.
export function getCollectionTagIds(
    create = true,
): Promise<Map<string, string>> {
    if (!create) {
        // Cached like the creating path. Leaving it uncached meant one
        // lookup per collection, serially, on every slide and card
        // mount, and both live under a virtualizer that remounts them
        // constantly: a fifty-slide scroll became hundreds of queries.
        // The rule this module states a hundred lines up is one round
        // trip per session, and the read-only path was doing the
        // opposite of it.
        if (cachedReadOnlyTagIdsPromise) return cachedReadOnlyTagIdsPromise;
        cachedReadOnlyTagIdsPromise = resolveCollectionTagIds(false).catch(
            (err) => {
                cachedReadOnlyTagIdsPromise = null;
                throw err;
            },
        );
        return cachedReadOnlyTagIdsPromise;
    }
    if (cachedTagIdsPromise) return cachedTagIdsPromise;
    cachedTagIdsPromise = resolveCollectionTagIds(true)
        .then((map) => {
            // The creating path may have just made the tags the
            // read-only path failed to find, so its cached answer is
            // now wrong. Clearing only on failure left a fresh install
            // showing empty membership everywhere until a reload,
            // because a slide mounts and caches "nothing exists"
            // before the first save creates anything.
            cachedReadOnlyTagIdsPromise = null;
            return map;
        })
        .catch((err) => {
            cachedTagIdsPromise = null;
            cachedReadOnlyTagIdsPromise = null;
            throw err;
        });
    return cachedTagIdsPromise;
}

function resolveCollectionTagIds(
    create: boolean,
): Promise<Map<string, string>> {
    return (async () => {
        const collections = await getCollections();
        // Creating the parent is itself a write, so a read-only
        // resolution must not do it either.
        const parentId = create ? await ensureCollectionsParentTagId() : "";
        const map = new Map<string, string>();
        for (const c of collections) {
            const existing = await findTagByName(c.tagName);
            // Favourite ★ is owned by Advanced Rating — leave its
            // hierarchy alone so we don't yank it out of ASR's
            // parent tree.
            const reparent = create && c.tagName !== FAVOURITES_TAG_NAME;
            if (existing) {
                if (
                    reparent &&
                    !existing.parents.some((p) => p.id === parentId)
                ) {
                    // Append the binge-collections parent without
                    // dropping any others the user has set up.
                    const next = Array.from(
                        new Set([
                            ...existing.parents.map((p) => p.id),
                            parentId,
                        ]),
                    );
                    try {
                        await tagSetParents(existing.id, next);
                    } catch (err) {
                        console.warn(
                            "[binge] reparent of " + c.tagName + " failed",
                            err,
                        );
                    }
                }
                map.set(c.tagName, existing.id);
                continue;
            }
            if (!create) continue;
            const created = await tagCreate(
                c.tagName,
                true,
                reparent ? [parentId] : undefined,
            );
            map.set(c.tagName, created.id);
        }
        return map;
    })();
}

// Create a new user collection from a display name. The Stash tag
// is `<displayName> 📁`, nested under the "binge Collections"
// parent so it joins the rest of the hierarchy. After creation we
// wipe the caches so the next read picks up the new collection,
// then notify subscribers so any open SaveSheet re-renders.
export async function createCollection(
    displayName: string,
): Promise<CollectionDef> {
    const trimmed = displayName.trim();
    if (!trimmed) throw new Error("Collection name cannot be empty");
    const tagName = `${trimmed}${COLLECTION_TAG_SUFFIX}`;
    const parentId = await ensureCollectionsParentTagId();
    // Avoid duplicate creation if the user races: find first.
    const existing = await findTagByName(tagName);
    let id = existing?.id ?? "";
    if (!existing) {
        id = (await tagCreate(tagName, true, [parentId])).id;
    } else if (!existing.parents.some((p) => p.id === parentId)) {
        // Tag existed without the parent (e.g. pre-migration);
        // reparent in place.
        const next = Array.from(
            new Set([...existing.parents.map((p) => p.id), parentId]),
        );
        await tagSetParents(existing.id, next);
    }
    cachedCollectionsPromise = null;
    cachedTagIdsPromise = null;
    cachedReadOnlyTagIdsPromise = null;
    notifySubscribers();
    return {
        name: trimmed,
        tagName,
        id,
        icon: "generic",
        isDefault: false,
    };
}

// Delete a collection. The Stash tag is destroyed (which drops its
// scene associations); the scene files themselves are untouched.
// We refuse to delete the Favourites collection because it's ASR's
// tag and the user probably doesn't want to nuke their ASR favourites
// state. Returns true on success.
//
// 需求3：默认合集（收藏夹 / 稍后观看 / 我的最爱）一律不可删除 —
// 它们是 binge 内置分类，删除后下次启动又会被 ensureDefaultCollections
// 重建，徒增困惑。Favourite ★ 另有 ASR 共享原因。
export async function deleteCollection(def: CollectionDef): Promise<boolean> {
    if (def.tagName === FAVOURITES_TAG_NAME) {
        throw new Error(
            "收藏夹合集与 ASR 共享，无法从 binge 中删除。",
        );
    }
    const names = currentTagNames();
    if (
        def.tagName === names.watchLater ||
        def.tagName === names.myFavourite
    ) {
        throw new Error("默认合集无法删除。");
    }
    // The id this collection was listed with, not a fresh lookup.
    //
    // Two separate faults lived in the old line. It re-resolved the tag
    // by NAME through a lookup that is a SQL LIKE, so a name holding an
    // underscore or a percent destroyed a different collection. And it
    // resolved through getCollectionTagIds(), whose default is
    // create: true - so pressing Delete first CREATED the two default
    // collection tags and the parent, one of them in another plugin's
    // namespace. Someone who made one collection, disliked it and
    // deleted it finished with more tags than they started with.
    const id = def.id;
    if (!id) return false;
    await tagDestroy(id);
    cachedCollectionsPromise = null;
    cachedTagIdsPromise = null;
    cachedReadOnlyTagIdsPromise = null;
    notifySubscribers();
    return true;
}

// 需求3：首次访问"已保存"页时，自动在 Stash 创建 3 个默认合集
// （收藏夹★ / 稍后观看📁 / 我的最爱❤️）对应的 tag。原先默认 tag
// 是懒创建（首次保存场景时才建），用户进入"已保存"页看到的是
// 空列表，体验不好。现在改为应用启动时一次性 ensure。
//
// 用 `binge.defaultCollectionsSeeded` localStorage flag 保证只跑
// 一次：第一次成功后写 true，后续启动直接短路。如果用户在 Stash
// 里手动删了某个默认 tag，下次 ensure 仍会重建（因为 getCollectionTagIds
// 的 find-or-create 逻辑会补回缺失项），但要等到 flag 被清除
// （例如清空 localStorage）才会重新触发 ensure。这是可接受的
// 折中：避免每次启动都打 findTagByName 三个 round-trip。
const DEFAULT_COLLECTIONS_SEEDED_KEY = "binge.defaultCollectionsSeeded";

// v0.4.15：将旧英文 tagName rename 为新中文 tagName。幂等——旧 tag
// 不存在则跳过。用独立 localStorage flag 保证只跑一次，在 seeded
// 短路之前执行，确保已 seeded 的老用户也能迁移。
//
// 边缘情况：若旧 tag 和新 tag 同时存在（用户手动建过新名 tag，或
// 迁移中断后重跑），不处理——保留旧 tag 残留，避免数据丢失。用户
// 可在 Stash 标签管理器手动清理。
const LEGACY_MIGRATION_DONE_KEY = "binge.legacyTagNamesMigrated.v0.4.15";

async function migrateLegacyTagNamesIfNeeded(): Promise<void> {
    let migrated = false;
    try {
        migrated =
            localStorage.getItem(LEGACY_MIGRATION_DONE_KEY) === "1";
    } catch {
        // localStorage 不可用——退化为每次都跑迁移（幂等，安全）
    }
    if (migrated) return;
    try {
        for (const [oldName, newName] of Object.entries(LEGACY_TAG_NAMES)) {
            const oldTag = await findTagByName(oldName);
            if (!oldTag) continue;
            const newTag = await findTagByName(newName);
            if (newTag) {
                // 新 tag 已存在——不处理，避免冲突。旧 tag 残留为
                // 孤儿，用户可在 Stash 标签管理器手动清理。
                console.warn(
                    `[binge] 跳过迁移 ${oldName} → ${newName}：新 tag 已存在，请手动清理旧 tag`
                );
                continue;
            }
            await tagRename(oldTag.id, newName);
        }
        // 迁移父标签 "binge Collections" → "binge 合集"。rename 不改
        // tag id，子标签的 parent_ids 关系自动保留。同样处理边缘情况。
        const legacyParent = await findTagByName(LEGACY_PARENT_TAG_NAME);
        if (legacyParent) {
            const newParent = await findTagByName(TAG_NAMES.zh.parent);
            if (!newParent) {
                await tagRename(legacyParent.id, TAG_NAMES.zh.parent);
            } else {
                console.warn(
                    `[binge] 跳过迁移父标签 ${LEGACY_PARENT_TAG_NAME} → ${TAG_NAMES.zh.parent}：新 tag 已存在`
                );
            }
        }
        try {
            localStorage.setItem(LEGACY_MIGRATION_DONE_KEY, "1");
        } catch {
            /* ignore quota / privacy mode errors */
        }
    } catch (err) {
        console.warn(
            "[binge] legacy tag migration failed — will retry next launch",
            err
        );
    }
}

export async function ensureDefaultCollections(): Promise<void> {
    // v0.4.15：先迁移旧英文 tagName 为中文，再走原有 ensure 逻辑。
    // 迁移在 seeded 短路之前执行，确保已 seeded 的老用户也能迁移。
    await migrateLegacyTagNamesIfNeeded();
    let alreadySeeded = false;
    try {
        alreadySeeded =
            localStorage.getItem(DEFAULT_COLLECTIONS_SEEDED_KEY) === "1";
    } catch {
        // localStorage 不可用时退化为每次都跑 ensure — 不会损坏数据，
        // 只是多几个 round-trip。
    }
    if (alreadySeeded) return;
    try {
        // getCollectionTagIds 会 find-or-create 每个默认 tag 并挂到
        // binge Collections 父标签下。任何一个失败都会 reject，
        // flag 不写入，下次启动会重试。
        await getCollectionTagIds();
        try {
            localStorage.setItem(DEFAULT_COLLECTIONS_SEEDED_KEY, "1");
        } catch {
            /* ignore quota / privacy mode errors */
        }
        // 通知订阅者：第一次创建后 SaveSheet / SavedPage 可以拿到
        // 新鲜的封面/计数（虽然此时三个合集都是空的）。
        notifySubscribers();
    } catch (err) {
        console.warn(
            "[binge] ensureDefaultCollections failed — will retry next launch",
            err
        );
    }
}

// v0.4.17：将 binge 自有的 Stash 标签（稍后观看 / 我的最爱 / 父标签）
// 从当前语言 rename 为目标语言。Favourite ★ 不受影响（ASR 共享）。
// 找到旧名 tag → rename 为新名。如果旧名不存在或新名已存在则跳过。
// 成功后更新 localStorage 中的标签语言状态并清空缓存。
export async function syncTagLanguage(targetLang: string): Promise<void> {
    const currentLang = getTagLanguage();
    if (currentLang === targetLang) return;
    if (!TAG_NAMES[targetLang]) return;

    const current = TAG_NAMES[currentLang];
    const target = TAG_NAMES[targetLang];

    await renameTagIfExists(current.watchLater, target.watchLater);
    await renameTagIfExists(current.myFavourite, target.myFavourite);
    await renameTagIfExists(current.parent, target.parent);

    try {
        localStorage.setItem(TAG_LANGUAGE_KEY, targetLang);
    } catch { /* ignore */ }

    cachedCollectionsPromise = null;
    cachedTagIdsPromise = null;
    cachedParentIdPromise = null;
    notifySubscribers();
}

async function renameTagIfExists(oldName: string, newName: string): Promise<void> {
    const oldTag = await findTagByName(oldName);
    if (!oldTag) return;
    const newTag = await findTagByName(newName);
    if (newTag) return;
    await tagRename(oldTag.id, newName);
}

// A scene's tags as Stash holds them right now.
//
// Deliberately not cached and not passed in. Collection membership is
// stored as a tag, and Stash's sceneUpdate replaces the whole tag_ids
// array, so a write built from anything but a fresh read silently
// deletes every tag added since that read was taken.
const SCENE_TAG_IDS = `
    query SceneTagIds($id: ID!) {
        findScene(id: $id) {
            id
            tags { id }
        }
    }
`;

async function currentSceneTagIds(sceneId: string): Promise<string[]> {
    const data = await gql<{
        findScene: { id: string; tags: { id: string }[] } | null;
    }>(SCENE_TAG_IDS, { id: sceneId });
    // Fail closed. A missing scene must never be read as "this scene has
    // no tags", because the next step writes that back as the truth.
    if (!data.findScene) {
        throw new Error(`scene ${sceneId} not found`);
    }
    return data.findScene.tags.map((t) => t.id);
}

// Turn a scene's tag ids into a "which collections is it in" map, given
// the tagName -> id mapping. Lets a caller refresh every row from the
// tags a write returned rather than trusting its own intent.
export function membershipFromTagIds(
    tagIds: string[],
    tagIdMap: Map<string, string>,
): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [tagName, id] of tagIdMap) {
        out[tagName] = tagIds.includes(id);
    }
    return out;
}

// Toggle a scene's membership in a collection.
//
// The scene's current tags are read here rather than supplied by the
// caller. They used to be passed in, and every caller had the same
// thing to hand: the tag array from the query that first populated the
// feed, held in React state for the life of the session and never
// refreshed. Since this function overwrites the whole array, that made
// an ordinary sequence destructive. Rate a scene, which writes score
// tags through a different path, then bookmark it: the bookmark rebuilt
// tag_ids from the page-load snapshot, the score tags were not in it,
// and they were deleted. The Advanced Rating hook then recomputed the
// scene's rating from the tags that survived, which were none. Two
// bookmarks in a row lost the first. A tag added from Stash's own UI in
// another tab was reverted by any bookmark here.
//
// Returns the membership Stash actually holds afterwards, not the
// intent, so a caller cannot show a tick for a write that did not land.
export async function setSceneInCollection(
    sceneId: string,
    tagName: string,
    next: boolean,
): Promise<{ inCollection: boolean; tagIds: string[] }> {
    const tagIds = await getCollectionTagIds();
    const id = tagIds.get(tagName);
    if (!id) return { inCollection: !next, tagIds: [] };

    const current = await currentSceneTagIds(sceneId);
    const has = current.includes(id);
    if (has === next) return { inCollection: next, tagIds: current };

    const newTagIds = next ? [...current, id] : current.filter((t) => t !== id);
    const updated = await sceneUpdate({ id: sceneId, tag_ids: newTagIds });
    // Prefer what came back over what we sent.
    const after = updated?.tags?.map((t) => t.id) ?? newTagIds;
    return { inCollection: after.includes(id), tagIds: after };
}

import { findTagByName, findTagsContaining } from "./queries";
import { readDemoMode } from "../home/pluginSettings";
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

export const COLLECTION_TAG_SUFFIX = " 📁";
const FAVOURITES_TAG_NAME = "Favourite ★";
const DEFAULT_WATCH_LATER_TAG_NAME = `稍后观看${COLLECTION_TAG_SUFFIX}`;
// 需求3：第三个默认合集"我的最爱 ❤️"。tag name 与界面显示名一致
// （"我的最爱 ❤️"），与 ASR 无关，可以正常挂到 binge Collections
// 父标签下。v0.4.15：tagName 从英文 "My Favourite ❤️" 改为中文，
// 与界面显示名一致；旧 tag 通过 migrateLegacyTagNamesIfNeeded 迁移。
const DEFAULT_MY_FAVOURITE_TAG_NAME = "我的最爱 ❤️";
// v0.4.15 之前的旧英文 tagName → 新中文 tagName 映射。用于一次性
// 迁移：将旧 tag rename 为新名，保留所有场景关联和 parent 关系。
// Favourite ★ 不在此映射中——它由 ASR 插件拥有并共享，改名会破坏
// ASR 互操作（ASR 仍会用 Favourite ★ 创建独立 tag，导致两套收藏夹
// 互不相通）。
const LEGACY_TAG_NAMES: Record<string, string> = {
    "Watch Later 📁": DEFAULT_WATCH_LATER_TAG_NAME,
    "My Favourite ❤️": DEFAULT_MY_FAVOURITE_TAG_NAME,
};
// Parent under which every binge-managed collection tag is
// nested in Stash's tag tree. Keeps the user's tag list tidy:
// instead of N flat "<name> 📁" tags scattered alphabetically,
// they live in a single hierarchy. Name has no " 📁" suffix so
// it isn't itself listed as a collection in the SaveSheet, but
// is namespaced with the plugin name so its purpose is obvious.
//
// `Favourite ★` is explicitly NOT reparented — it's owned by the
// Advanced Rating plugin and binge only borrows it for the
// Favourites collection. Moving it would break ASR's hierarchy.
//
// v0.4.15：从英文 "binge Collections" 改为中文 "binge 合集"。旧父标签
// 通过 migrateLegacyTagNamesIfNeeded 迁移。rename 不改 tag id，子标签
// 的 parent_ids 关系自动保留。
const COLLECTIONS_PARENT_TAG_NAME = "binge 合集";
const LEGACY_PARENT_TAG_NAME = "binge Collections";

export type CollectionIconName =
    | "favourite"
    | "watchLater"
    | "myFavourite"
    | "generic";

export interface CollectionDef {
    name: string; // display label (no suffix, no star)
    tagName: string; // exact Stash tag name (with suffix or ★)
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
        const userTags = await findTagsContaining(COLLECTION_TAG_SUFFIX);
        // 需求3：第三个默认合集"我的最爱 ❤️"。tagName 是
        // "My Favourite ❤️"（无 " 📁" 后缀），不会被上面的
        // findTagsContaining 拉回，所以总是从 defaults 数组显式
        // 注入。de-dup 仍按 tagName + 显示名兜底，避免用户手动
        // 建过同名 tag 时出现两个"我的最爱"。
        const defaults: CollectionDef[] = [
            {
                name: "收藏夹",
                tagName: FAVOURITES_TAG_NAME,
                icon: "favourite",
                isDefault: true,
            },
            {
                name: "稍后观看",
                tagName: DEFAULT_WATCH_LATER_TAG_NAME,
                icon: "watchLater",
                isDefault: true,
            },
            {
                name: "我的最爱",
                tagName: DEFAULT_MY_FAVOURITE_TAG_NAME,
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
                icon: "generic",
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
        const existing = await findTagByName(COLLECTIONS_PARENT_TAG_NAME);
        if (existing) return existing.id;
        const created = await tagCreate(
            COLLECTIONS_PARENT_TAG_NAME,
            true
        );
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
export function getCollectionTagIds(): Promise<Map<string, string>> {
    if (cachedTagIdsPromise) return cachedTagIdsPromise;
    // Demo: hand each collection a synthetic id (no findTagByName /
    // parent-tag round-trips). findRecentScenesForTag / findScenesByTag
    // hash the id into a deterministic slice, so covers + detail load.
    if (readDemoMode()) {
        cachedTagIdsPromise = getCollections().then((cols) => {
            const m = new Map<string, string>();
            for (const c of cols) m.set(c.tagName, "democol-" + c.tagName);
            return m;
        });
        return cachedTagIdsPromise;
    }
    cachedTagIdsPromise = (async () => {
        const collections = await getCollections();
        const parentId = await ensureCollectionsParentTagId();
        const map = new Map<string, string>();
        for (const c of collections) {
            const existing = await findTagByName(c.tagName);
            // Favourite ★ is owned by Advanced Rating — leave its
            // hierarchy alone so we don't yank it out of ASR's
            // parent tree.
            const reparent = c.tagName !== FAVOURITES_TAG_NAME;
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
                        ])
                    );
                    try {
                        await tagSetParents(existing.id, next);
                    } catch (err) {
                        console.warn(
                            "[binge] reparent of " +
                                c.tagName +
                                " failed",
                            err
                        );
                    }
                }
                map.set(c.tagName, existing.id);
                continue;
            }
            const created = await tagCreate(
                c.tagName,
                true,
                reparent ? [parentId] : undefined
            );
            map.set(c.tagName, created.id);
        }
        return map;
    })().catch((err) => {
        cachedTagIdsPromise = null;
        throw err;
    });
    return cachedTagIdsPromise;
}

// Create a new user collection from a display name. The Stash tag
// is `<displayName> 📁`, nested under the "binge Collections"
// parent so it joins the rest of the hierarchy. After creation we
// wipe the caches so the next read picks up the new collection,
// then notify subscribers so any open SaveSheet re-renders.
export async function createCollection(
    displayName: string
): Promise<CollectionDef> {
    const trimmed = displayName.trim();
    if (!trimmed) throw new Error("Collection name cannot be empty");
    const tagName = `${trimmed}${COLLECTION_TAG_SUFFIX}`;
    const parentId = await ensureCollectionsParentTagId();
    // Avoid duplicate creation if the user races: find first.
    const existing = await findTagByName(tagName);
    if (!existing) {
        await tagCreate(tagName, true, [parentId]);
    } else if (
        !existing.parents.some((p) => p.id === parentId)
    ) {
        // Tag existed without the parent (e.g. pre-migration);
        // reparent in place.
        const next = Array.from(
            new Set([
                ...existing.parents.map((p) => p.id),
                parentId,
            ])
        );
        await tagSetParents(existing.id, next);
    }
    cachedCollectionsPromise = null;
    cachedTagIdsPromise = null;
    notifySubscribers();
    return {
        name: trimmed,
        tagName,
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
export async function deleteCollection(tagName: string): Promise<boolean> {
    if (tagName === FAVOURITES_TAG_NAME) {
        throw new Error(
            "收藏夹合集与 ASR 共享，无法从 binge 中删除。"
        );
    }
    if (
        tagName === DEFAULT_WATCH_LATER_TAG_NAME ||
        tagName === DEFAULT_MY_FAVOURITE_TAG_NAME
    ) {
        throw new Error("默认合集无法删除。");
    }
    const tagIds = await getCollectionTagIds();
    const id = tagIds.get(tagName);
    if (!id) return false;
    await tagDestroy(id);
    cachedCollectionsPromise = null;
    cachedTagIdsPromise = null;
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
    if (readDemoMode()) return;
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
            const newParent = await findTagByName(COLLECTIONS_PARENT_TAG_NAME);
            if (!newParent) {
                await tagRename(legacyParent.id, COLLECTIONS_PARENT_TAG_NAME);
            } else {
                console.warn(
                    `[binge] 跳过迁移父标签 ${LEGACY_PARENT_TAG_NAME} → ${COLLECTIONS_PARENT_TAG_NAME}：新 tag 已存在`
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
    if (readDemoMode()) return;
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

// Toggle a scene's membership in a collection. Caller passes the scene's
// CURRENT tag ids; we diff and sceneUpdate. Returns the new state.
export async function setSceneInCollection(
    sceneId: string,
    currentTagIds: string[],
    tagName: string,
    next: boolean
): Promise<boolean> {
    const tagIds = await getCollectionTagIds();
    const id = tagIds.get(tagName);
    if (!id) return !next;
    const has = currentTagIds.includes(id);
    if (has === next) return next;
    const newTagIds = next
        ? [...currentTagIds, id]
        : currentTagIds.filter((t) => t !== id);
    await sceneUpdate({ id: sceneId, tag_ids: newTagIds });
    return next;
}

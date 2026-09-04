// 活动数据源（active stash-box source）——binge 发现/联动链路的单一事实源。
//
// binge 的热门流、发现流、stories、关注、AddScene、演员页"未拥有"混排
// 全部指向同一个 stash-box 实例（默认 stashdb.org）。实例通过 Stash 插件
// 设置页的 `sourceEndpoint`（binge.yml settings 块）切换，语义为
// "每次页面加载以插件配置为准"：
//   - 不落 localStorage（与 serverUrl 的"一次性种子"模式相反）——库是
//     部署级共享的，不存在"这个浏览器看 javstash、那个看 stashdb"的
//     合理场景；
//   - 模块级 memo 只在 SPA 会话内存活，页面重开即重建——改配置后
//     重新打开 binge 页即切换到新源，天然无热切换旧状态问题；
//   - 启动时一条合并查询同时读 general.stashBoxes 与插件配置，零额外
//     往返（旧 getStashDBBox 每次调用都独立查一次 configuration）。
//
// 回退规则：未设置 / 空值 / 归一化后与 stashBoxes 的 endpoint 都不匹配
// → 一律回退 stashdb.org，并记录原因供设置页展示。

import { gql } from "./graphql";

export const DEFAULT_SOURCE_ENDPOINT = "https://stashdb.org/graphql";

export interface ActiveSource {
    // 归一化后的 graphql endpoint（如 https://javstash.org/graphql）
    endpoint: string;
    // 展示用 host（如 javstash.org）
    host: string;
    // 匹配到的 stashBoxes 条目的 api_key；null = 没有任何 box 匹配活动
    // endpoint（含默认源未配置的情况），等价于旧 getStashDBBox 返回 null
    apiKey: string | null;
    // 在 stashBoxes 中的下标，scrapeSinglePerformer(stash_box_index) 用；
    // -1 = 未匹配
    boxIndex: number;
    // 活动源是否为默认源 stashdb.org（无论是显式配置还是回退）
    isDefault: boolean;
    // 回退原因；null = 按配置生效（含"未配置即默认"之外的正常路径）
    fallbackReason: "unset" | "empty" | "no-match" | null;
}

// 归一化：trim + 去尾部斜杠。stashBoxes 里存的是 Stash 配置原文，
// 插件设置里的值由用户手填，两侧统一归一化后再精确匹配。
function normalizeEndpoint(v: string): string {
    return v.trim().replace(/\/+$/, "");
}

// graphql endpoint → web base（https://javstash.org/graphql →
// https://javstash.org），用于外链 URL 拼接（/scenes/{id} 等）。
export function sourceWebBase(endpoint: string): string {
    try {
        return new URL(endpoint).origin;
    } catch {
        return endpoint.replace(/\/graphql\/?$/, "").replace(/\/+$/, "");
    }
}

export function sourceHost(endpoint: string): string {
    try {
        return new URL(endpoint).host;
    } catch {
        return endpoint;
    }
}

export function sourceSceneUrl(endpoint: string, id: string): string {
    return `${sourceWebBase(endpoint)}/scenes/${id}`;
}

export function sourcePerformerUrl(endpoint: string, id: string): string {
    return `${sourceWebBase(endpoint)}/performers/${id}`;
}

// 展示名：默认源叫 "StashDB"（品牌名本就不带 .org），其余实例用去掉
// .org 后缀的 host（javstash.org → "javstash"；非 .org 后缀原样保留）。
// i18n 的 sourceName 后处理器（i18n/config.ts）把文案里的 "StashDB"
// 替换成它，所以这里提供同步读取的模块级缓存，首帧（源未解析时）
// 返回 "StashDB" 与默认行为一致。
export function sourceDisplayName(host: string): string {
    if (host === sourceHost(DEFAULT_SOURCE_ENDPOINT)) return "StashDB";
    return host.replace(/\.org$/, "");
}

let activeDisplayName = "StashDB";

export function activeSourceDisplayName(): string {
    return activeDisplayName;
}

const SOURCE_CONFIG_QUERY = /* GraphQL */ `
    query ActiveSourceConfig {
        configuration {
            general {
                stashBoxes {
                    endpoint
                    api_key
                    name
                }
            }
            plugins(include: ["binge"])
        }
    }
`;

async function resolveActiveSource(): Promise<ActiveSource> {
    const data = await gql<{
        configuration: {
            general: {
                stashBoxes: { endpoint: string; api_key: string }[];
            };
            plugins?: Record<string, Record<string, unknown> | null>;
        };
    }>(SOURCE_CONFIG_QUERY);
    const boxes = data.configuration.general.stashBoxes ?? [];
    const raw = data.configuration.plugins?.["binge"]?.["sourceEndpoint"];

    const configured =
        typeof raw === "string" && raw.trim() ? normalizeEndpoint(raw) : null;
    const target = configured ?? DEFAULT_SOURCE_ENDPOINT;

    const matchBox = (endpoint: string) =>
        boxes.findIndex(
            (b) => b.endpoint && normalizeEndpoint(b.endpoint) === endpoint,
        );

    let index = matchBox(target);
    // 配置了却不匹配 → 回退默认源；默认源本身也允许 trailing slash 差异。
    let effective = target;
    let fallbackReason: ActiveSource["fallbackReason"] = null;
    if (configured && index < 0) {
        fallbackReason = "no-match";
        effective = DEFAULT_SOURCE_ENDPOINT;
        index = matchBox(DEFAULT_SOURCE_ENDPOINT);
    } else if (!configured) {
        fallbackReason = typeof raw === "string" ? "empty" : "unset";
    }

    const endpoint =
        index >= 0 ? normalizeEndpoint(boxes[index].endpoint) : effective;
    const apiKey = index >= 0 ? boxes[index].api_key || null : null;

    activeDisplayName = sourceDisplayName(sourceHost(endpoint));

    return {
        endpoint,
        host: sourceHost(endpoint),
        apiKey,
        boxIndex: index,
        isDefault: endpoint === DEFAULT_SOURCE_ENDPOINT,
        fallbackReason,
    };
}

// 会话级 memo。失败（Stash 不可达）不缓存：清掉槽位让下一个调用方重试，
// 与 stashdb.ts 里 ownedIdsPromise 的处理一致。
let sourceMemo: Promise<ActiveSource> | null = null;

export function getActiveSource(): Promise<ActiveSource> {
    if (!sourceMemo) {
        const p = resolveActiveSource().catch((err) => {
            if (sourceMemo === p) sourceMemo = null;
            throw err;
        });
        sourceMemo = p;
    }
    return sourceMemo;
}

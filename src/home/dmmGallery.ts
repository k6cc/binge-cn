// DMM 图床剧照获取（双通道）。发现页卡片的场景数据源（stash-box
// 架构）里 images[] 只有单张封面（实测 javstash 与 stashdb.org 皆
// 然），剧照不在场景数据内——但 r18.dev 的详情页 / JSON 端点直接
// 引用 FANZA/DMM 图床，URL 模式固定：
//   https://pics.dmm.co.jp/digital/video/{id}/{id}jp-{N}.jpg
//   （awsimgsrc.dmm.com/dig/... 同批文件的镜像域名，字节一致）
// id = 场景 urls 里 r18.dev 链接的 id 参数（VRKM-1884 →
// vrkm01884）。contentId 必须取自该参数——部分厂牌的 id 无法从
// 番号推导（Prestige ABF-383 → 118abf383，带数字前缀）。
//
// 主路径：r18.dev JSON 端点（combined={contentId}/json）一次请求
// 返回 gallery[]（image_full/image_thumb），数量与链接权威，响应
// 带 access-control-allow-origin: *，浏览器 fetch 直连即可。注意
// 个别厂牌（Prestige）的 image_full 指向无 jp 前缀的缩略图 URL，
// 因此统一把文件名修正为 jp 变体（全尺寸）再使用。
//
// 回退路径：JSON 端点依赖 r18.dev 站点（套 Cloudflare，HEAD 会被
// 403，网络/风控可能失败），失败时逐号穷举探测 DMM 图床（实测无
// 拦截、无 Referer 校验，<img> 直载即可）。两条通道拿同一批 jp
// 变体图，互不依赖，任一可用即可出剧照。
const GALLERY_BASE = "https://awsimgsrc.dmm.com/dig/digital/video";
// r18.dev JSON 端点基址：combined={contentId}/json。
const R18_JSON_BASE = "https://r18.dev/videos/vod/movies/detail/-/combined";
const R18_JSON_TIMEOUT_MS = 8_000;
// 序号上限：300 分钟 BEST 实测 20 张；60 是防异常死循环的护栏。
const MAX_GALLERY_IMAGES = 60;
// 批量探测用动态批：全成功批 6 张（20 张序列约 4 轮往返）；批内
// 一旦出现失败，说明序列接近终点，下一批缩为 3 张确认批——全 404
// 即终止（容错跳号：确认批内有 200 混排则恢复推进）。若固定 6 张
// 批跑到底，终点后要多付 6 张 404 的冗余请求。
const PROBE_BATCH = 6;
const CONFIRM_BATCH = 3;
const PROBE_TIMEOUT_MS = 10_000;

// r18.dev 链接 → DMM content_id。链接的 id 参数即图床 contentId
// （VRKM-1884 → vrkm01884、ABF-383 → 118abf383），是唯一可靠来
// 源；URL 不含 id 或格式不符时返回 null。
export function contentIdFromR18Url(url: string): string | null {
    const m = url.match(
        /r18\.dev\/videos\/vod\/movies\/detail\/-\/id=([A-Za-z0-9]+)/,
    );
    return m ? m[1] : null;
}

// 番号 → DMM content_id 的兜底推导（多数厂牌 VRKM-1884 →
// vrkm01884 成立，Prestige 等带前缀厂牌不成立）。不匹配常见 JAV
// 番号格式（字母前缀-数字）时返回 null。
export function deriveContentId(code: string | null): string | null {
    if (!code) return null;
    const m = code.trim().match(/^([A-Za-z]{2,10})-(\d{2,6})$/);
    if (!m) return null;
    return m[1].toLowerCase() + m[2].padStart(5, "0");
}

export function dmmGalleryUrl(contentId: string, n: number): string {
    return `${GALLERY_BASE}/${contentId}/${contentId}jp-${n}.jpg`;
}

// JSON 端点里的全尺寸图 URL（pics.dmm.co.jp 域名，jp 变体），与
// awsimgsrc 镜像域名同批文件，浏览器 <img> 直载即可。
function dmmGalleryUrlPics(contentId: string, n: number): string {
    return `https://pics.dmm.co.jp/digital/video/${contentId}/${contentId}jp-${n}.jpg`;
}

// r18.dev JSON 端点主路径：一次请求拿全部剧照。返回内容：
//   gallery: [{ image_full, image_thumb }, ...]  // 数量即剧照数
//   jacket_full_url / runtime_mins / title_ja ...
// 响应头 access-control-allow-origin: *，浏览器 fetch 直连即可。
// 成功返回剧照 URL 数组（用 jp 全尺寸变体）；任何失败（网络/403/
// 超时/无 gallery）返回 null，由调用方回退到穷举探测。注意：个别
// 厂牌（Prestige）的 image_full 指向无 jp 前缀的缩略图，因此统一
// 用固定 jp 变体模式生成 URL，不直接采用 image_full 字段。
async function fetchDmmGalleryJson(
    contentId: string,
): Promise<string[] | null> {
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), R18_JSON_TIMEOUT_MS);
        try {
            const res = await fetch(
                `${R18_JSON_BASE}=${contentId}/json`,
                { signal: ctrl.signal },
            );
            if (!res.ok) return null;
            const data = await res.json();
            const gallery = data?.gallery;
            if (!Array.isArray(gallery) || gallery.length === 0) return null;
            // 只信任数量（gallery.length 即剧照数），URL 用固定 jp
            // 变体模式，规避 Prestige 等 image_full 是缩略图的情况。
            return gallery.map((_: unknown, i: number) =>
                dmmGalleryUrlPics(contentId, i + 1),
            );
        } finally {
            clearTimeout(timer);
        }
    } catch {
        return null;
    }
}

// 单张探测：new Image() onload/onerror。探测的图片直接进浏览器缓
// 存，预览窗右划时零延迟显示。
//
// DMM 图床对不存在的序号不总返回 404：浏览器 img 请求（带页面
// Referer / sec-fetch 头）实测会收到 200 的 90×122 占位图并触发
// onload，而同 URL 用 curl 直接请求是 404。因此不能只信 onerror，
// onload 后还要按尺寸过滤——真实剧照最窄 533px，占位图 90px，
// 300 是安全分界线。
function probeImage(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => {
            img.src = "";
            resolve(false);
        }, PROBE_TIMEOUT_MS);
        img.onload = () => {
            clearTimeout(timer);
            resolve(img.naturalWidth >= 300 && img.naturalHeight >= 200);
        };
        img.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
        img.src = url;
    });
}

// 会话缓存 + 同 contentId 去重：预览窗重开不重探。
const galleryCache = new Map<string, Promise<string[]>>();

// 回退路径：穷举探测剧照序列。每张确认即通过 onImage 回调（按序
// 号顺序），消费方可渐进展示；Promise resolve 时序列定稿。批内全
// 部 404 → 提前结束。仅当 JSON 端点失败时才走到这里。
async function probeDmmGalleryByEnumeration(
    contentId: string,
    onImage?: (url: string) => void,
): Promise<string[]> {
    const found: string[] = [];
    let n = 1;
    let batch = PROBE_BATCH;
    while (n <= MAX_GALLERY_IMAGES) {
        const nums: number[] = [];
        for (
            let k = 0;
            k < batch && n + k <= MAX_GALLERY_IMAGES;
            k++
        ) {
            nums.push(n + k);
        }
        const results = await Promise.all(
            nums.map(async (num) => ({
                num,
                ok: await probeImage(dmmGalleryUrl(contentId, num)),
            })),
        );
        let anyOk = false;
        let anyMiss = false;
        for (const r of results) {
            if (r.ok) {
                anyOk = true;
                found.push(dmmGalleryUrl(contentId, r.num));
                onImage?.(dmmGalleryUrl(contentId, r.num));
            } else {
                anyMiss = true;
            }
        }
        // 全 404 → 序列结束；有失败 → 缩批确认；全成功 → 恢复整批。
        if (!anyOk) break;
        batch = anyMiss ? CONFIRM_BATCH : PROBE_BATCH;
        n += nums.length;
    }
    return found;
}

// 探测剧照序列（双通道）。优先 r18.dev JSON 端点一次拿全量；失败
// 回退穷举探测。两种路径都产出 jp 全尺寸变体 URL。
export function probeDmmGallery(
    contentId: string,
    onImage?: (url: string) => void,
): Promise<string[]> {
    const cached = galleryCache.get(contentId);
    if (cached) return cached;
    const p = (async () => {
        const viaJson = await fetchDmmGalleryJson(contentId);
        if (viaJson) {
            // JSON 一次给全量，无需渐进回调；resolve 定稿即可。
            return viaJson;
        }
        return probeDmmGalleryByEnumeration(contentId, onImage);
    })();
    galleryCache.set(contentId, p);
    return p;
}

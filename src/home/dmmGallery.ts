// DMM 图床剧照探测。发现页卡片的场景数据源（stash-box 架构）里
// images[] 只有单张封面（实测 javstash 与 stashdb.org 皆然），剧
// 照不在场景数据内——但 r18.dev 页面的剧照直接引用 FANZA/DMM 图
// 床，URL 模式固定：
//   https://awsimgsrc.dmm.com/dig/digital/video/{id}/{id}jp-{N}.jpg
// id = 场景 urls 里 r18.dev 链接的 id 参数（VRKM-1884 →
// vrkm01884）。contentId 必须取自该参数——部分厂牌的 id 无法从
// 番号推导（Prestige ABF-383 → 118abf383，带数字前缀）。实测：
// 存在的序号返回 200，不存在的返回 404，无 Referer 校验——浏览器
// <img> 直载即可探测，无需代理。因此 javstash 模式的剧照 = 按
// r18.dev 链接判定场景有记录后，用其 id 参数生成序列并逐号探测。
const GALLERY_BASE = "https://awsimgsrc.dmm.com/dig/digital/video";
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

// 探测剧照序列。每张确认即通过 onImage 回调（按序号顺序），消费方
// 可渐进展示；Promise resolve 时序列定稿。批内全部 404 → 提前结束。
export function probeDmmGallery(
    contentId: string,
    onImage?: (url: string) => void,
): Promise<string[]> {
    const cached = galleryCache.get(contentId);
    if (cached) return cached;
    const p = (async () => {
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
    })();
    galleryCache.set(contentId, p);
    return p;
}

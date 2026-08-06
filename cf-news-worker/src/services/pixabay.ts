import { Bindings } from '../types';

// Pixabay 免费额度：100 req/60s。插画类型用于新闻配图（比照片更贴合抽象话题）。
// 图片一律下载到 R2 自托管（Pixabay 条款禁止热链），image_url 存 /api/image 代理 URL。
const PIXABAY_API = 'https://pixabay.com/api/';

// 英文标题常见虚词，关键词提取时过滤
const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had',
    'were', 'will', 'would', 'should', 'could', 'your', 'youre', 'their',
    'what', 'when', 'where', 'which', 'while', 'about', 'after', 'before',
    'into', 'over', 'under', 'than', 'then', 'them', 'they', 'these', 'those',
    'there', 'here', 'been', 'being', 'was', 'are', 'can', 'cant', 'dont',
    'does', 'did', 'doing', 'just', 'more', 'most', 'some', 'such', 'only',
    'also', 'new', 'how', 'why', 'not', 'but', 'its', 'it\'s', 'out', 'get',
    'got', 'one', 'two', 'via', 'per', 'may', 'might', 'must', 'shall',
]);

// 分类兜底搜索词：标题没有可用英文关键词时使用
const CATEGORY_TERMS: Record<string, string> = {
    tech: 'technology computer',
    ai: 'artificial intelligence robot',
    finance: 'finance money business',
    stocks: 'stock market trading',
    funds: 'investment finance',
    entertainment: 'entertainment cinema music',
    news: 'news newspaper',
    general: 'news abstract',
};

const EXT_MAP: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

/** 从标题提取英文关键词（≥3 字母、非虚词），最多 4 个；无可用词时返回分类兜底词 */
export function extractKeywords(title: string, category: string): string {
    const words = (title || '')
        .replace(/[^a-zA-Z\s]/g, ' ')
        .split(/\s+/)
        .map(w => w.toLowerCase())
        .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

    const unique = Array.from(new Set(words)).slice(0, 4);
    if (unique.length >= 2) return unique.join(' ');
    return CATEGORY_TERMS[category] || CATEGORY_TERMS.general;
}

interface PixabayHit {
    webformatURL?: string;
    largeImageURL?: string;
    imageWidth?: number;
    imageHeight?: number;
}

/** 搜索 Pixabay，返回最佳图片 URL；无命中或失败返回 null */
export async function searchPixabay(
    env: Bindings,
    query: string,
    imageType: 'illustration' | 'photo' = 'illustration'
): Promise<string | null> {
    const key = (env as any).PIXABAY_API_KEY as string | undefined;
    if (!key) return null;

    // Pixabay 条款要求搜索结果缓存 24 小时（同时避免重复消耗配额）
    const cacheKey = `pixabay:${imageType}:${encodeURIComponent(query)}`;
    if (env.KV) {
        try {
            const cached = await env.KV.get(cacheKey);
            if (cached) return cached;
        } catch (e) {
            console.error('Pixabay KV 缓存读取失败:', e);
        }
    }

    const params = new URLSearchParams({
        key,
        q: query.slice(0, 100),
        image_type: imageType,
        per_page: '3',
        safesearch: 'true',
        lang: 'en',
        min_width: '400',
    });

    try {
        const resp = await fetch(`${PIXABAY_API}?${params}`, { signal: AbortSignal.timeout(10_000) });
        if (!resp.ok) {
            console.error(`Pixabay search HTTP ${resp.status} for "${query}"`);
            return null;
        }
        const data = await resp.json() as { hits?: PixabayHit[] };
        const hits = Array.isArray(data.hits) ? data.hits : [];
        if (hits.length === 0) return null;

        // 优先竖版/横版比例更接近 16:9 的结果，避免卡片裁剪过度
        const best = hits.sort((a, b) => {
            const arA = a.imageWidth && a.imageHeight ? a.imageWidth / a.imageHeight : 0;
            const arB = b.imageWidth && b.imageHeight ? b.imageWidth / b.imageHeight : 0;
            return Math.abs(arA - 16 / 9) - Math.abs(arB - 16 / 9);
        })[0];
        const imageUrl = best?.largeImageURL || best?.webformatURL || null;

        if (imageUrl && env.KV) {
            await env.KV.put(cacheKey, imageUrl, { expirationTtl: 86_400 }).catch(e => console.error('Pixabay KV 缓存写入失败:', e));
        }
        return imageUrl;
    } catch (e) {
        console.error(`Pixabay search error for "${query}":`, e);
        return null;
    }
}

/**
 * 下载图片到 R2，返回 /api/image 代理 URL。
 * 失败返回 null（调用方应跳过该新闻，保留原布局）。
 */
export async function storeStockImageToR2(
    env: Bindings,
    newsId: number,
    imageUrl: string
): Promise<string | null> {
    try {
        const imgRes = await fetch(imageUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsPixabay/1.0)' },
            signal: AbortSignal.timeout(15_000),
        });
        if (!imgRes.ok) return null;
        const contentType = (imgRes.headers.get('Content-Type') || '').split(';')[0].trim();
        const ext = EXT_MAP[contentType];
        if (!ext) return null;

        const key = `stock/${newsId}.${ext}`;
        if (env.R2_IMAGES) {
            await env.R2_IMAGES.put(key, imgRes.body, { httpMetadata: { contentType } });
        }
        // 返回代理 URL（R2 对象经 /api/image?url=r2://... 提供），前端 <img> 直接可加载
        return `/api/image?url=${encodeURIComponent('r2://' + key)}`;
    } catch (e) {
        console.error(`Pixabay store-to-R2 error for news-${newsId}:`, e);
        return null;
    }
}

/** 完整流程：搜索（插画优先，无结果回退照片）→ 下载 R2 → 返回代理 URL */
export async function illustrateFromStock(
    env: Bindings,
    newsId: number,
    title: string,
    category: string
): Promise<string | null> {
    const query = extractKeywords(title, category);
    let imageUrl = await searchPixabay(env, query, 'illustration');
    if (!imageUrl) imageUrl = await searchPixabay(env, query, 'photo');
    if (!imageUrl) return null;
    return storeStockImageToR2(env, newsId, imageUrl);
}

import { Bindings } from '../types';

// Pixabay 免费额度：100 req/60s。插画类型用于新闻配图（比照片更贴合抽象话题）。
// 图片一律下载到 R2 自托管（Pixabay 条款禁止热链），image_url 存 /api/image 代理 URL。
const PIXABAY_API = 'https://pixabay.com/api/';

// 英文标题常见虚词/功能词，关键词提取时过滤。
// 除虚词外还包含高频动词/形容词（said/stick/test/next...），这些词在 Pixabay
// 上是噪音：如 "Warsh Said to Stick With Fed Messaging" 里的 stick 会搜到叼树枝的狗。
const STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had',
    'were', 'will', 'would', 'should', 'could', 'your', 'youre', 'their',
    'what', 'when', 'where', 'which', 'while', 'about', 'after', 'before',
    'into', 'over', 'under', 'than', 'then', 'them', 'they', 'these', 'those',
    'there', 'here', 'been', 'being', 'was', 'are', 'can', 'cant', 'dont',
    'does', 'did', 'doing', 'just', 'more', 'most', 'some', 'such', 'only',
    'also', 'new', 'how', 'why', 'not', 'but', 'its', 'it\'s', 'out', 'get',
    'got', 'one', 'two', 'via', 'per', 'may', 'might', 'must', 'shall',
    // 高频功能词（动词/形容词/时间词），对 Pixabay 搜索无区分度
    'said', 'says', 'told', 'make', 'makes', 'made', 'take', 'takes', 'took',
    'set', 'sets', 'next', 'back', 'still', 'like', 'much', 'many', 'year',
    'years', 'day', 'days', 'week', 'weeks', 'month', 'months', 'first',
    'last', 'best', 'big', 'top', 'stick', 'stuck', 'keep', 'keeps', 'found',
    'find', 'look', 'looks', 'looking', 'watch', 'test', 'tests', 'plan',
    'plans', 'show', 'shows', 'puts', 'put', 'sees', 'see', 'wants', 'want',
    'need', 'needs', 'try', 'tries', 'use', 'uses', 'used', 'help', 'helps',
    'deal', 'deals', 'cut', 'cuts', 'rise', 'rises', 'fall', 'falls', 'grow',
    'grows', 'drop', 'drops', 'gain', 'gains', 'lose', 'loses', 'turn',
    'turns', 'move', 'moves', 'moved', 'going', 'come', 'comes',
    'long', 'short', 'high', 'low', 'full', 'half', 'early', 'late',
    'open', 'opens', 'close', 'closes', 'closed', 'start', 'starts', 'stop',
    'stops', 'run', 'runs', 'win', 'wins', 'beats', 'beat', 'hits',
    'hit', 'calls', 'call', 'names', 'name', 'claims', 'claim',
    'reports', 'urges', 'urge', 'bans', 'ban', 'backs',
]);

// 分类兜底搜索词：标题没有可用英文关键词时使用（英文）
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

// 中文分类兜底搜索词：中文标题 zh 搜索失败时，用中文兜底词 + lang=zh 重试，
// 避免直接 fallback 到英文泛图（英文泛图与中文新闻主题脱节，且同一词缓存导致大量重复）。
const CATEGORY_TERMS_ZH: Record<string, string> = {
    tech: '科技 电脑 数码',
    ai: '人工智能 机器人',
    finance: '金融 货币 财经',
    stocks: '股票 证券 市场',
    funds: '基金 投资 理财',
    entertainment: '娱乐 电影 音乐',
    news: '新闻 时事',
    general: '新闻 资讯',
};

const EXT_MAP: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

/**
 * 从标题提取搜索关键词。
 * 中文标题：去 [标签] 前缀和标点，取核心片段，lang=zh 直接搜中文。
 * 英文标题：提取英文实词（≥3 字母、非虚词），lang=en。
 * 两者都无可用词时退回分类兜底词（仅作最后保险，不再是主路径）。
 */
export function extractKeywords(title: string, category: string): { query: string; lang: 'zh' | 'en' } {
    const t = (title || '').trim();
    if (/[\u4e00-\u9fff]/.test(t)) {
        const cleaned = t
            .replace(/^\[[^\]]*\]/g, ' ')
            .replace(/[，。！？、；：""''（）()【】\-\|_/\\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const segs = cleaned.split(/\s+/).filter((s) => s.length >= 2).slice(0, 4);
        if (segs.length > 0) return { query: segs.join(' ').slice(0, 100), lang: 'zh' };
    }

    const words = t
        .replace(/[^a-zA-Z\s]/g, ' ')
        .split(/\s+/)
        .map(w => w.toLowerCase())
        .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    const unique = Array.from(new Set(words)).slice(0, 4);
    if (unique.length >= 2) return { query: unique.join(' '), lang: 'en' };

    return { query: CATEGORY_TERMS[category] || CATEGORY_TERMS.general, lang: 'en' };
}

interface PixabayHit {
    webformatURL?: string;
    largeImageURL?: string;
    imageWidth?: number;
    imageHeight?: number;
    tags?: string;
}

/** 提取 query 的关键词集合（中英文都拆词，用于与 Pixabay tags 匹配） */
function queryTerms(query: string): string[] {
    return query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .slice(0, 8);
}

/** 计算 hit 与 query 的主题相关分：tags 与 query 关键词重叠越多分越高。
 * 中文场景：query 是长片段而 tags 是短词（如 query"布加迪预告新品" vs tag"布加迪"），
 * 只要任一 tag 词（≥2字）是 query 片段的子串即计分，避免把相关图误判为 score=0。
 * 英文场景：仅当 tag 词与 term 互为子串（≥3 字母）时计分，避免 "ai" 命中 "train" 式假阳性。 */
function relevanceScore(hit: PixabayHit, terms: string[]): number {
    if (!hit.tags || terms.length === 0) return 0;
    const tagWords = hit.tags.toLowerCase().split(/[,\s]+/).filter((w) => w.length >= 2);
    if (tagWords.length === 0) return 0;
    let score = 0;
    for (const t of terms) {
        if (t.length >= 3) {
            if (tagWords.some((w) => w.length >= 3 && (t.includes(w) || w.includes(t)))) { score++; continue; }
        }
        if (/[\u4e00-\u9fff]/.test(t) && t.length >= 2) {
            if (tagWords.some((w) => t.includes(w))) score++;
        }
    }
    return score;
}

/**
 * 搜索 Pixabay，返回按 16:9 接近度排序的候选图 URL 列表（最多 3 张）。
 * KV 缓存整个候选列表（Pixabay 条款要求结果缓存 24h），同一 query 的多个新闻
 * 由调用方按 newsId 取模选不同候选，避免同一关键词的新闻全部共用同一张图。
 * 兼容旧缓存格式（单 URL 字符串）：读到旧格式时包装成单元素数组。
 */
export async function searchPixabay(
    env: Bindings,
    query: string,
    imageType: 'illustration' | 'photo' = 'illustration',
    lang: 'zh' | 'en' = 'en'
): Promise<string[] | null> {
    const key = (env as any).PIXABAY_API_KEY as string | undefined;
    if (!key) return null;

    const cacheKey = `pixabay:v2:${imageType}:${lang}:${encodeURIComponent(query)}`;
    if (env.KV) {
        try {
            const cached = await env.KV.get(cacheKey);
            if (cached) {
                try {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') return parsed;
                } catch { /* 旧格式：单 URL 字符串，走下方兼容分支 */ }
                if (typeof cached === 'string' && cached.startsWith('http')) return [cached];
            }
        } catch (e) {
            console.error('Pixabay KV 缓存读取失败:', e);
        }
    }

    const params = new URLSearchParams({
        key,
        q: query.slice(0, 100),
        image_type: imageType,
        per_page: '6',
        safesearch: 'true',
        lang,
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

        // 排序策略：优先 tags 与 query 主题相关（tags 含 query 关键词越多越靠前），
        // 同分再按比例接近 16:9（避免卡片裁剪过度）。取前 6 张候选。
        const terms = queryTerms(query);
        const scored = hits
            .map((h) => ({
                url: h.largeImageURL || h.webformatURL || '',
                ar: h.imageWidth && h.imageHeight ? h.imageWidth / h.imageHeight : 0,
                score: relevanceScore(h, terms),
            }))
            .filter((h) => h.url);

        // 降级策略：query 能提取关键词（terms 非空）时，丢弃 tags 零相关的候选（score=0）。
        // 若全部不相关 → 返回 null，由调用方走分类兜底；兜底也无 → 不配图（保持无图布局），
        // 避免给"亚里士多德语录"硬配一张"独角兽兔子"这类完全无关的图。
        let candidates = scored;
        if (terms.length > 0) {
            const relevant = scored.filter((h) => h.score > 0);
            if (relevant.length === 0) return null;
            candidates = relevant;
        }

        const sorted = candidates
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return Math.abs(a.ar - 16 / 9) - Math.abs(b.ar - 16 / 9);
            })
            .slice(0, 6)
            .map((h) => h.url);
        if (sorted.length === 0) return null;

        if (env.KV) {
            await env.KV.put(cacheKey, JSON.stringify(sorted), { expirationTtl: 86_400 }).catch(e => console.error('Pixabay KV 缓存写入失败:', e));
        }
        return sorted;
    } catch (e) {
        console.error(`Pixabay search error for "${query}":`, e);
        return null;
    }
}

/** 从候选列表中按 newsId 取模选一张（同一 query 的多个新闻拿到不同候选，减少重复） */
function pickCandidate(candidates: string[] | null, newsId: number): string | null {
    if (!candidates || candidates.length === 0) return null;
    return candidates[newsId % candidates.length] ?? candidates[0];
}

/**
 * 下载图片到 R2，返回 /api/image 代理 URL。
 * 字节数过小（<8KB）视为坏图/纯黑图，返回 null（调用方应跳过该新闻，保留原布局）。
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

        const buf = await imgRes.arrayBuffer();
        if (buf.byteLength < 8 * 1024) {
            console.error(`Pixabay store-to-R2 rejected tiny image (${buf.byteLength}B) for news-${newsId}: ${imageUrl}`);
            return null;
        }

        const key = `stock/${newsId}.${ext}`;
        if (env.R2_IMAGES) {
            await env.R2_IMAGES.put(key, buf, { httpMetadata: { contentType } });
        }
        // 返回代理 URL（R2 对象经 /api/image?url=r2://... 提供），前端 <img> 直接可加载
        return `/api/image?url=${encodeURIComponent('r2://' + key)}`;
    } catch (e) {
        console.error(`Pixabay store-to-R2 error for news-${newsId}:`, e);
        return null;
    }
}

/** 完整流程：按标题语言搜索（插画优先，无结果回退照片）→ 中文标题 zh 失败再走中文兜底词 → 下载 R2 → 返回代理 URL */
export async function illustrateFromStock(
    env: Bindings,
    newsId: number,
    title: string,
    category: string
): Promise<string | null> {
    const { query, lang } = extractKeywords(title, category);
    let imageUrl = pickCandidate(await searchPixabay(env, query, 'illustration', lang), newsId);
    if (!imageUrl) imageUrl = pickCandidate(await searchPixabay(env, query, 'photo', lang), newsId);

    // 中文标题优先中文兜底词（lang=zh），避免直接 fallback 到英文泛图造成主题脱节与大量重复
    if (!imageUrl && lang === 'zh') {
        const zhFallback = CATEGORY_TERMS_ZH[category] || CATEGORY_TERMS_ZH.general;
        imageUrl = pickCandidate(await searchPixabay(env, zhFallback, 'illustration', 'zh'), newsId);
        if (!imageUrl) imageUrl = pickCandidate(await searchPixabay(env, zhFallback, 'photo', 'zh'), newsId);
    }

    // 最后保险：英文分类兜底词（仅当中文兜底也失败时使用）
    if (!imageUrl) {
        const fallback = CATEGORY_TERMS[category] || CATEGORY_TERMS.general;
        imageUrl = pickCandidate(await searchPixabay(env, fallback, 'illustration', 'en'), newsId);
        if (!imageUrl) imageUrl = pickCandidate(await searchPixabay(env, fallback, 'photo', 'en'), newsId);
    }
    if (!imageUrl) return null;
    return storeStockImageToR2(env, newsId, imageUrl);
}

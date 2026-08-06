import { Bindings } from '../types';

// Cloudflare Radar API 补充趋势数据（免费，需 token 带 Account:Radar 权限）。
// 用缓存（KV，TTL 6h）避免每次请求都打 Radar API——排行数据是日更级别。

const CACHE_KEY = 'radar:internet-services-top';
const CACHE_TTL = 6 * 3600; // 6 小时

interface RadarServiceRank {
    rank: number;
    service: string;
}

interface RadarTopResponse {
    success: boolean;
    result?: {
        top_0?: RadarServiceRank[];
    };
}

/** 拉取全球互联网服务热度排行（如 Google/Facebook/OpenAI），失败返回空数组。 */
export async function fetchInternetServiceRanking(env: Bindings): Promise<RadarServiceRank[]> {
    // 优先读 KV 缓存
    try {
        const cached = await env.KV.get(CACHE_KEY);
        if (cached) {
            return JSON.parse(cached) as RadarServiceRank[];
        }
    } catch (e) {
        console.error('Radar cache read failed:', e);
    }

    // Radar API 需要专门的 token（CLOUDFLARE_API_TOKEN 需含 Account:Radar 权限）
    const token = (env as any).RADAR_API_TOKEN || (env as any).CLOUDFLARE_API_TOKEN;
    if (!token) return [];

    try {
        const resp = await fetch('https://api.cloudflare.com/client/v4/radar/ranking/internet_services/top?limit=15', {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) return [];
        const data = await resp.json() as RadarTopResponse;
        const ranks = data?.result?.top_0 ?? [];
        if (ranks.length > 0) {
            await env.KV.put(CACHE_KEY, JSON.stringify(ranks), { expirationTtl: CACHE_TTL });
        }
        return ranks;
    } catch (e) {
        console.error('Radar API failed:', e);
        return [];
    }
}

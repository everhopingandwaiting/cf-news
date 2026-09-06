import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import { providers, providerModels, aiCallLog, appConfig } from '../db/schema';
import { getConfig, getConfigInt, getProviderInfo, getProviderOrder } from './aiProvider';
import type { Bindings } from '../types';

/**
 * 模型目录自动刷新服务（modelRefresher）
 * -------------------------------------------------------------
 * 目标：不再靠手动 migration 维护 provider_models 目录。定时任务自动：
 *
 *   1) 目录校准（reconcile）：对每个有有效 API key 的 provider 调用
 *      `GET {base_url}/models`，拿到 live 模型清单后：
 *      - 新增：live 有、目录没有 → INSERT enabled=0（安全默认），进入候选池待探针
 *      - 失效：目录 enabled=1、live 没有 → UPDATE enabled=0（永远无法成功）
 *
 *   2) 质量探针（quality probe）：对候选池（enabled=0 且近期未探针）取一小批，
 *      发一个极小的真实 chat completion。返回真实内容 → enabled=1，并给一个
 *      **低于** 已验证主力模型的基线分（当 fallback，不抢主力）；失败则保持 0。
 *
 *   3) 证据裁剪（evidence pruning）：查 ai_call_log 近 N 天，对启用中的模型
 *      若尝试次数足够且成功率≈0（说明启用后死掉/下架）→ enabled=0。
 *
 * 安全设计：
 *   - 所有外部探测都放在独立 cron（`model_sync_cron`），与抓取/摘要 cron 分开，
 *     避免抢 subrequest 预算。
 *   - **节流**：目录校准每 provider 1 次 /models fetch；质量探针每 run 最多
 *     `model_sync_max_probes`（默认 3）个模型，避免爆 50-subrequest 上限。
 *   - 新增模型一律先从 enabled=0 开始，只有通过真实探针才启用。
 *   - 通过 app_config 可一键关闭：`model_sync_enabled=0`。
 *   - cloudflare（Workers AI /models 用 CF 网关，非 OpenAI 兼容）跳过。
 */

const DEFAULT_MAX_PROBES = 3;             // 每次 run 最多质量探针模型数
const DEFAULT_SUMMARY_WINDOW_DAYS = 2;    // 证据裁剪回看窗口（天）
const DEFAULT_EVIDENCE_MIN_ATTEMPTS = 20; // 证据裁剪最少尝试次数
const DEFAULT_BASELINE_SCORE = 60;        // 新启用模型的基线分（低于已验证主力 80+）
const DEFAULT_FREE_SCORE_BONUS = 20;      // 免费模型优先级加分（免费优先于同分付费模型）
const QUALIFY_PROMPT = 'Reply with exactly: ok';
const QUALIFY_MAX_TOKENS = 4;
const QUALIFY_TIMEOUT_MS = 20000;

interface LiveModel {
    id: string;
    contextSize?: number;
    maxOutput?: number;
    type?: string;
    isFree?: boolean;
    endpointTypes?: string[];
}

/**
 * 判断一个模型是否为“免费”模型（在不同 provider 上标记不同）：
 *  - OpenRouter: id 带 `:free` 后缀 且/或 pricing.prompt === '0'
 *  - Zen / OrcaRouter: id 带 `-free` 后缀
 *  - 其他：id 内含 `free` 标记
 * 显式 `isFree`（探测时从 pricing 字段已解析）优先。
 */
function isFreeModel(id: string, isFree?: boolean): boolean {
    if (isFree !== undefined) return isFree;
    const lower = id.toLowerCase();
    return lower.endsWith(':free') || lower.endsWith('-free') || /(^|[\/_-])(free)([\/_-]|$)/.test(lower) || /^(free\/|free-)/.test(lower);
}

/**
 * 从模型 id 推断类型（用于完全缺失 type 字段的 provider，如 Agnes）。
 * - 命中 `-image-` / `image` → image
 * - 命中 `-video-` / `video` → video
 * - 命中 `-audio-` / `tts` / `stt` / `whisper` → audio
 * - 命中 `-embedding-` / `embed` / `rerank` → embedding
 * - 否则 → text（生成式文本模型默认）
 */
function inferTypeFromId(id: string): string {
    const lower = id.toLowerCase();
    if (/(^|[\/_-])(image|img)([\/_-]|$)/.test(lower)) return 'image';
    if (/(^|[\/_-])(video)([\/_-]|$)/.test(lower)) return 'video';
    if (/(^|[\/_-])(audio|tts|stt|whisper)([\/_-]|$)/.test(lower)) return 'audio';
    if (/(^|[\/_-])(embedding|embed|rerank|reranker)([\/_-]|$)/.test(lower)) return 'embedding';
    return 'text';
}

/** 固定的生成式文本/图片模型类型（可作为 AI 摘要/问答候选） */
const GENERATIVE_TYPES = new Set(['text', 'chat', 'llm']);

/** 判断 live 模型的 endpoint 是否支持 OpenAI 兼容 chat（用于可用性校验） */
function isChatCallable(endpointTypes?: string[]): boolean {
    if (!endpointTypes || endpointTypes.length === 0) return true; // 缺失字段 → 假定可用
    const lower = endpointTypes.map((t) => t.toLowerCase());
    return lower.some((t) =>
        t.includes('chat') || t.includes('text') || t.includes('openai') ||
        t.includes('reasoning') || t === 'llm' || t === 'completion'
    );
}

/**
 * 读取当前已存在的模型目录，返回 { provider: Set<model_id> }。
 * 用于判断「新增」与「失效」。
 */
async function readCatalog(env: Bindings): Promise<Map<string, Map<string, {
    score: number; enabled: number; type: string; context_size: number; max_output: number;
}>>> {
    const db = getDb(env);
    const rows = await db.select({
        provider: providerModels.provider,
        model_id: providerModels.model_id,
        score: providerModels.score,
        enabled: providerModels.enabled,
        type: providerModels.type,
        context_size: providerModels.context_size,
        max_output: providerModels.max_output,
    }).from(providerModels).all();
    const map = new Map<string, Map<string, { score: number; enabled: number; type: string; context_size: number; max_output: number }>>();
    for (const r of rows) {
        if (!map.has(r.provider)) map.set(r.provider, new Map());
        map.get(r.provider)!.set(r.model_id, {
            score: r.score ?? DEFAULT_BASELINE_SCORE,
            enabled: r.enabled ?? 1,
            type: r.type ?? 'text',
            context_size: r.context_size ?? 131072,
            max_output: r.max_output ?? 4096,
        });
    }
    return map;
}

/**
 * 探测单个 provider 的 /models 端点，返回 live 模型清单。
 * 复用 getProviderInfo（已处理 disabled/expired/缺 key），失败返回 null。
 */
async function probeModels(env: Bindings, provider: string): Promise<LiveModel[] | null> {
    const info = await getProviderInfo(env, provider);
    if (!info) return null;
    const url = info.base_url.endsWith('/models')
        ? info.base_url
        : `${info.base_url.replace(/\/+$/, '')}/models`;
    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${info.api_key}`, 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
            console.log(`[modelRefresher] ${provider} /models HTTP ${res.status}`);
            return null;
        }
        const body: any = await res.json();
        const list: any[] = Array.isArray(body) ? body : (body?.data ?? []);
        return list.map((m) => {
            const id = String(typeof m === 'string' ? m : (m?.id ?? ''));
            const ctx = m?.context_length ?? m?.context_window ?? m?.max_context ?? (m?.meta?.['max_context']);
            const out = m?.max_output_tokens ?? m?.max_tokens ?? m?.meta?.['max_output_tokens'];
            // pricing.prompt === '0' → 免费（OpenRouter 等）；Agnes 无 pricing 字段 → undefined
            const pricingPrompt = m?.pricing?.prompt;
            const isFree = typeof pricingPrompt === 'number' ? pricingPrompt === 0
                : (typeof pricingPrompt === 'string' && pricingPrompt === '0');
            const endpointTypes = Array.isArray(m?.supported_endpoint_types)
                ? m.supported_endpoint_types.map((t: any) => String(t))
                : undefined;
            let type = m?.type && typeof m.type === 'string' ? m.type : '';
            if (!type) type = inferTypeFromId(id); // 修复：Agnes 等缺失 type 字段时按 id 推断
            return {
                id,
                contextSize: typeof ctx === 'number' ? ctx : undefined,
                maxOutput: typeof out === 'number' ? out : undefined,
                type,
                isFree: isFreeModel(id, isFree),
                endpointTypes,
            };
        }).filter(m => m.id.length > 0);
    } catch (e) {
        console.log(`[modelRefresher] ${provider} /models error: ${String(e)}`);
        return null;
    }
}

/**
 * 质量探针：对单个候选模型发一个极小 chat completion。
 * 返回 true 表示可用（真实返回内容），false 表示不可用/失败。
 */
async function qualityProbe(env: Bindings, provider: string, baseUrl: string, apiKey: string, model: string): Promise<boolean> {
    const url = baseUrl.endsWith('/chat/completions')
        ? baseUrl
        : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: QUALIFY_PROMPT }],
                max_tokens: QUALIFY_MAX_TOKENS,
                temperature: 0,
            }),
            signal: AbortSignal.timeout(QUALIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.log(`[modelRefresher] ${provider}/${model} probe HTTP ${res.status}`);
            return false;
        }
        const body: any = await res.json();
        const text = body?.choices?.[0]?.message?.content || body?.choices?.[0]?.text || '';
        return typeof text === 'string' && text.trim().length > 0;
    } catch (e) {
        console.log(`[modelRefresher] ${provider}/${model} probe error: ${String(e)}`);
        return false;
    }
}

/**
 * 读取「最近一次质量探针时间戳」表（存于 app_config，key 前缀 model_sync_probed:）。
 * 用内存 Map 简化：每次 run 内部去重即可；跨 run 节流由 enabled=0 → probed 状态转换保证
 * （probe 失败会写入 app_config 时间戳，避免每次 run 反复试同一个死模型）。
 */
async function readProbeTs(env: Bindings, provider: string, model: string): Promise<number> {
    const key = `model_sync_probed:${provider}:${model}`;
    const v = await getConfig(env, key);
    const n = parseInt(v || '0', 10);
    return Number.isFinite(n) ? n : 0;
}

async function writeProbeTs(env: Bindings, provider: string, model: string): Promise<void> {
    const db = getDb(env);
    const key = `model_sync_probed:${provider}:${model}`;
    await db.run(sql`INSERT OR REPLACE INTO app_config (key, value) VALUES (${key}, ${String(Math.floor(Date.now() / 1000))})`);
}

/**
 * 主入口：执行一轮模型目录自动刷新。
 */
export async function refreshModelCatalog(env: Bindings): Promise<{ reconciled: string[]; probed: string[]; pruned: string[] }> {
    const enabled = await getConfigInt(env, 'model_sync_enabled', 1);
    if (enabled !== 1) {
        console.log('[modelRefresher] disabled (model_sync_enabled=0)');
        return { reconciled: [], probed: [], pruned: [] };
    }

    const db = getDb(env);
    const order = await getProviderOrder(env);
    // 只处理在 provider_order 里、且非 cloudflare 的 provider（cloudflare 用 Workers AI 网关）
    const providersToSync = order.filter(p => p !== 'cloudflare');

    const catalog = await readCatalog(env);
    const reconciled: string[] = [];
    const probed: string[] = [];
    const pruned: string[] = [];

    const maxProbes = await getConfigInt(env, 'model_sync_max_probes', DEFAULT_MAX_PROBES);
    let probesUsed = 0;

    for (const provider of providersToSync) {
        const live = await probeModels(env, provider);
        if (!live) continue; // 无 key / disabled / 端点失败 → 跳过

        const liveById = new Map<string, LiveModel>();
        for (const m of live) liveById.set(m.id, m);

        const providerCatalog = catalog.get(provider) || new Map();

        // ① 失效：目录 enabled=1 但 live 没有 → 禁用（永远无法成功）
        for (const [modelId, meta] of providerCatalog.entries()) {
            if (meta.enabled !== 1) continue;
            if (!liveById.has(modelId)) {
                await db.update(providerModels)
                    .set({ enabled: 0 })
                    .where(sql`provider = ${provider} AND model_id = ${modelId}`);
                reconciled.push(`disable:${provider}/${modelId}`);
                console.log(`[modelRefresher] ${provider}/${modelId} no longer live → disabled`);
            }
        }

        // ② 新增：live 有、目录没有 → INSERT enabled=0（进候选池）
        for (const [modelId, liveMeta] of liveById.entries()) {
            if (providerCatalog.has(modelId)) continue;
            // 过滤明显的非生成模型（embedding/router/rerank 等）
            const t = (liveMeta.type || 'text').toLowerCase();
            if (t && !GENERATIVE_TYPES.has(t)) continue;
            // 可用性校验：显式 empty supported_endpoint_types → 非 OpenAI chat 可调用（如 image/video 专用）
            if (!isChatCallable(liveMeta.endpointTypes)) continue;
            await db.run(sql`INSERT OR IGNORE INTO provider_models
                (provider, model_id, score, enabled, type, context_size, max_output, is_free)
                VALUES (${provider}, ${modelId}, ${DEFAULT_BASELINE_SCORE}, 0, ${t || 'text'}, ${liveMeta.contextSize ?? 131072}, ${liveMeta.maxOutput ?? 4096}, ${liveMeta.isFree ? 1 : 0})`);
            reconciled.push(`new:${provider}/${modelId}`);
            console.log(`[modelRefresher] discovered ${provider}/${modelId} → candidate (disabled, free=${liveMeta.isFree ? 1 : 0})`);
        }

        // ③ 质量探针：对「目录里 enabled=0、live 且有 key、近期未试过」的候选取一小批探测
        const freeBonus = await getConfigInt(env, 'model_sync_free_score_bonus', DEFAULT_FREE_SCORE_BONUS);
        if (probesUsed < maxProbes) {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
            const now = Math.floor(Date.now() / 1000);
            const cooldown = await getConfigInt(env, 'model_sync_probe_cooldown', 86400);

            // 候选：未启用、类型为生成式、endpoint 可 chat 调用（免费优先）
            const candidates: { model_id: string; isFree: boolean }[] = [];
            for (const [modelId, meta] of providerCatalog.entries()) {
                if (meta.enabled !== 0) continue;
                const lm = liveById.get(modelId);
                if (!lm) continue;
                const t = (lm.type || meta.type || '').toLowerCase();
                if (t && !GENERATIVE_TYPES.has(t)) continue;
                if (!isChatCallable(lm.endpointTypes)) continue;
                candidates.push({ model_id: modelId, isFree: !!lm.isFree });
            }
            // 免费优先：免费候选排到前面，确保优先探测（用户需求：优先用 Free 模型）
            candidates.sort((a, b) => Number(b.isFree) - Number(a.isFree));

            if (candidates.length > 0 && candidates.length < 5) {
                console.log(`[modelRefresher] ${provider}: only ${candidates.length} candidate(s) — consider verifying availability manually`);
            }

            for (const cand of candidates) {
                if (probesUsed >= maxProbes) break;
                const last = await readProbeTs(env, provider, cand.model_id);
                if (now - last < cooldown) continue;

                probesUsed++;
                const ok = await qualityProbe(env, provider, info.base_url, info.api_key, cand.model_id);
                await writeProbeTs(env, provider, cand.model_id);
                if (ok) {
                    const baseline = await getConfigInt(env, 'model_sync_baseline_score', DEFAULT_BASELINE_SCORE);
                    const score = cand.isFree ? baseline + freeBonus : baseline;
                    await db.update(providerModels)
                        .set({ enabled: 1, score })
                        .where(sql`provider = ${provider} AND model_id = ${cand.model_id}`);
                    probed.push(`enable:${provider}/${cand.model_id}`);
                    console.log(`[modelRefresher] ${provider}/${cand.model_id} probe OK → enabled (score=${score}${cand.isFree ? ', free bonus' : ''})`);
                } else {
                    probed.push(`keep-disabled:${provider}/${cand.model_id}`);
                    console.log(`[modelRefresher] ${provider}/${cand.model_id} probe FAILED → stays disabled`);
                }
            }
        }
    }

    // ④ 证据裁剪：对启用中的模型，若近期尝试足够但成功率≈0 → 禁用
    const windowDays = await getConfigInt(env, 'model_sync_summary_window_days', DEFAULT_SUMMARY_WINDOW_DAYS);
    const minAttempts = await getConfigInt(env, 'model_sync_evidence_min_attempts', DEFAULT_EVIDENCE_MIN_ATTEMPTS);
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const stats = await db.all<{ provider: string; model: string; attempts: number; successes: number }>(sql`
        SELECT provider, model, COUNT(*) AS attempts, SUM(success) AS successes
        FROM ai_call_log
        WHERE created_at >= ${windowStart}
          AND model IS NOT NULL
        GROUP BY provider, model
    `);
    for (const s of stats) {
        if (!s.model) continue;
        const attempts = Number(s.attempts) || 0;
        const successes = Number(s.successes) || 0;
        if (attempts < minAttempts) continue;
        if (successes > 0) continue;
        // 命中：启用中但近窗口内 0 成功
        const meta = catalog.get(s.provider)?.get(s.model);
        if (!meta || meta.enabled !== 1) continue;
        await db.update(providerModels)
            .set({ enabled: 0 })
            .where(sql`provider = ${s.provider} AND model_id = ${s.model}`);
        pruned.push(`disable:${s.provider}/${s.model}`);
        console.log(`[modelRefresher] ${s.provider}/${s.model} 0/${attempts} success in ${windowDays}d → disabled`);
    }

    return { reconciled, probed, pruned };
}

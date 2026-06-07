import { Bindings } from '../types';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems } from '../db/schema';
import { checkQuota, recordUsage, estimateEmbeddingNeurons } from './quota';

const EMBEDDING_MODELS = [
    '@cf/qwen/qwen3-embedding-0.6b',
    '@cf/baai/bge-m3',
];

function normalizeText(text: string): string {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function computeHash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

async function checkByHash(env: Bindings, hash: string): Promise<boolean> {
    const db = getDb(env);
    const existing = await db.select({ id: newsItems.id })
        .from(newsItems)
        .where(sql`dedup_hash = ${hash} AND is_deleted = 0`)
        .limit(1)
        .get();
    return !!existing;
}

async function generateEmbedding(env: Bindings, text: string): Promise<number[] | null> {
    for (const model of EMBEDDING_MODELS) {
        try {
            const embedding = await env.AI.run(model, { text: [text] });
            const vector = embedding.data[0];
            if (vector) return vector;
        } catch (e) {
            console.error(`Embedding failed with ${model}:`, e);
        }
    }
    return null;
}

async function checkByVector(env: Bindings, text: string): Promise<boolean> {
    if (!env.VECTORIZE) return false;

    const tokenEstimate = Math.ceil(text.length / 4);
    const neuronsNeeded = estimateEmbeddingNeurons(tokenEstimate);

    if (!(await checkQuota(env, neuronsNeeded))) return false;

    const vector = await generateEmbedding(env, text);
    if (!vector) return false;

    await recordUsage(env, neuronsNeeded);

    try {
        const matches = await env.VECTORIZE.query(vector, { topK: 1, returnMetadata: false });
        if (matches.count === 0) return false;

        return matches.matches[0]?.score !== undefined && matches.matches[0].score > 0.95;
    } catch (e) {
        console.error('Vectorize query failed:', e);
        return false;
    }
}

export async function checkDuplicate(env: Bindings, title: string, description?: string): Promise<boolean> {
    const normalized = normalizeText(`${title} ${description || ''}`);
    const hash = computeHash(normalized);

    if (await checkByHash(env, hash)) return true;
    return checkByVector(env, normalized);
}

export async function storeDedupHash(env: Bindings, newsId: number, title: string, description?: string): Promise<void> {
    const normalized = normalizeText(`${title} ${description || ''}`);
    const hash = computeHash(normalized);
    const db = getDb(env);

    try {
        await db.update(newsItems)
            .set({ dedupHash: hash })
            .where(eq(newsItems.id, newsId));
    } catch (e) {
        console.error('Failed to store dedup hash:', e);
    }

    if (!env.VECTORIZE) return;

    const tokenEstimate = Math.ceil(normalized.length / 4);
    const neuronsNeeded = estimateEmbeddingNeurons(tokenEstimate);

    if (!(await checkQuota(env, neuronsNeeded))) return;

    const vector = await generateEmbedding(env, normalized);
    if (vector) {
        try {
            await env.VECTORIZE.upsert([{
                id: newsId.toString(),
                values: vector,
            }]);
            await recordUsage(env, neuronsNeeded);
        } catch (e) {
            console.error('Failed to store vector:', e);
        }
    }
}

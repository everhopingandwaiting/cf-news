import { Bindings } from '../types';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { neuronUsage } from '../db/schema';

const DAILY_NEURON_LIMIT = 9500;

async function getDailyUsage(env: Bindings): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const db = getDb(env);
    try {
        const row = await db.select({ count: neuronUsage.count })
            .from(neuronUsage)
            .where(eq(neuronUsage.date, today))
            .get();
        return row?.count ?? 0;
    } catch {
        return 0;
    }
}

async function addDailyUsage(env: Bindings, neurons: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const db = getDb(env);
    try {
        await db.run(sql`INSERT INTO neuron_usage (date, count) VALUES (${today}, ${neurons}) ON CONFLICT(date) DO UPDATE SET count = count + ${neurons}`);
    } catch (e) {
        console.error('Failed to record neuron usage:', e);
    }
}

export async function checkQuota(env: Bindings, estimatedNeurons: number): Promise<boolean> {
    const usage = await getDailyUsage(env);
    return (usage + estimatedNeurons) < DAILY_NEURON_LIMIT;
}

export async function recordUsage(env: Bindings, neurons: number): Promise<void> {
    await addDailyUsage(env, neurons);
}

export function estimateEmbeddingNeurons(tokenCount: number): number {
    return Math.ceil((tokenCount / 1_000_000) * 1075);
}

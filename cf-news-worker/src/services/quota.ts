import { Bindings } from '../types';

const DAILY_NEURON_LIMIT = 9500;

async function getDailyUsage(env: Bindings): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    try {
        const row = await env.DB.prepare(
            'SELECT count FROM neuron_usage WHERE date = ?'
        ).bind(today).first<{ count: number }>();
        return row?.count ?? 0;
    } catch {
        return 0;
    }
}

async function addDailyUsage(env: Bindings, neurons: number): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    try {
        await env.DB.prepare(
            'INSERT INTO neuron_usage (date, count) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET count = count + ?'
        ).bind(today, neurons, neurons).run();
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

// @cf/qwen/qwen3-embedding-0.6b: 1075 neurons per M tokens
export function estimateEmbeddingNeurons(tokenCount: number): number {
    return Math.ceil((tokenCount / 1_000_000) * 1075);
}

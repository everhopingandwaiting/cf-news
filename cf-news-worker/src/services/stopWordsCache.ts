import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';

/**
 * Isolate-level stop_words cache — 全表扫描 ~2500 行，trending/summarizer/AI related
 * 每次调用都读会烧 D1 读配额；词表几乎不变，缓存到 isolate 生命周期结束即可。
 * 调用方自行做 normalizeKeyword / toLowerCase（各处归一化规则不同）。
 */
let _words: string[] | null = null;

export async function loadStopWords(db: DbClient): Promise<string[]> {
    if (_words) return _words;
    const rows = await db.all<{ word: string }>(sql`SELECT word FROM stop_words`);
    _words = rows.map(r => r.word);
    return _words;
}

/** 测试用：跨用例隔离 MockD1 种子 */
export function resetStopWordsCache(): void {
    _words = null;
}

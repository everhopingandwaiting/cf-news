import { Bindings, NewsQueueMessage } from '../types';
import { generateSummaryForNews } from './summarizer';
import { indexNewsItem } from './tokenizer';
import { fetchSourceNews } from './newsFetcher';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems } from '../db/schema';

/**
 * Queue consumer: processes messages from the news-processing-queue.
 * Offloads heavy work from cron triggers to avoid Worker timeouts.
 */
export async function handleNewsQueue(batch: MessageBatch<NewsQueueMessage>, env: Bindings): Promise<void> {
    for (const message of batch.messages) {
        try {
            const msg = message.body;
            switch (msg.type) {
                case 'fetch_source':
                    if (msg.sourceId) {
                        const count = await fetchSourceNews(env, msg.sourceId, msg.skipSummary ?? false);
                        console.log(`Queue: fetched ${count} items from source ${msg.sourceId}`);
                    }
                    break;
                case 'generate_summary':
                    if (msg.newsId && msg.title) {
                        await generateSummaryForNews(env, msg.newsId, {
                            id: msg.newsId,
                            title: msg.title,
                            description: msg.description,
                            content: msg.content,
                            url: msg.url,
                        } as any);
                        console.log(`Queue: generated summary for news ${msg.newsId}`);
                    }
                    break;
                case 'generate_take':
                    if (msg.newsId && msg.title) {
                        // AI 毒舌点评独立入队：每条消息在独立 invocation 中执行
                        // （独立 50-external-subrequest 预算），避免 summary cron
                        // 单次 invocation 内逐条遍历 provider 链烧爆上限。
                        const { generateAITake } = await import('./summarizer');
                        await generateAITake(env, msg.newsId, {
                            title: msg.title,
                            description: msg.description,
                            content: msg.content,
                        });
                        console.log(`Queue: generated AI take for news ${msg.newsId}`);
                    }
                    break;
                case 'generate_entities':
                    if (msg.newsId && msg.title) {
                        const { extractEntities } = await import('./entityExtractor');
                        await extractEntities(env, msg.newsId, {
                            title: msg.title,
                            description: msg.description,
                            content: msg.content,
                        });
                        console.log(`Queue: extracted entities for news ${msg.newsId}`);
                    }
                    break;
                case 'index_news':
                    if (msg.newsId && msg.title) {
                        await indexNewsItem(env, msg.newsId, msg.title, msg.description);
                        console.log(`Queue: indexed news ${msg.newsId}`);
                    }
                    break;
                case 'illustrate_stock':
                    if (msg.newsId && msg.title) {
                        const { illustrateFromStock } = await import('./pixabay');
                        const proxyUrl = await illustrateFromStock(env, msg.newsId, msg.title, msg.category || 'general');
                        if (proxyUrl) {
                            const db = getDb(env);
                            await db.update(newsItems)
                                .set({ image_url: proxyUrl })
                                .where(eq(newsItems.id, msg.newsId));
                            console.log(`Queue: illustrated stock image for news ${msg.newsId}`);
                        } else {
                            console.log(`Queue: no stock image for news ${msg.newsId} (searched, no hit)`);
                        }
                    }
                    // Pixabay 免费额度 100 req/min：每条消息最多 2-4 次搜索，
                    // 串行处理时人为限速 ~1.2s/条，避免批量入队瞬间打爆配额导致全部失败
                    await new Promise((r) => setTimeout(r, 1200));
                    break;
            }
            message.ack();
        } catch (e) {
            console.error(`Queue: failed to process message:`, e);
            message.retry();
        }
    }
}

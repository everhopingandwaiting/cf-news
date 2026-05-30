import { Bindings, NewsQueueMessage } from '../types';
import { generateSummaryForNews } from './summarizer';
import { indexNewsItem } from './tokenizer';
import { fetchSourceNews } from './newsFetcher';

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
                        const count = await fetchSourceNews(env, msg.sourceId);
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
                case 'index_news':
                    if (msg.newsId && msg.title) {
                        await indexNewsItem(env, msg.newsId, msg.title, msg.description);
                        console.log(`Queue: indexed news ${msg.newsId}`);
                    }
                    break;
            }
            message.ack();
        } catch (e) {
            console.error(`Queue: failed to process message:`, e);
            message.retry();
        }
    }
}

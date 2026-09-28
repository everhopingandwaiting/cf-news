import { sql } from 'drizzle-orm';
import { Bindings } from '../types';
import { callAI, getProviderOrder } from './aiProvider';
import { dbForNews } from './archive';

const ENTITY_PROMPT = '从以下新闻中提取关键实体。输出JSON数组，每项格式: {"type":"person|organization|location|number|event","value":"实体名称","context":"一句话说明"}。提取人物、组织机构、地点、关键数字/金额、重要事件。最多提取15项。\n\n新闻标题：{{TITLE}}\n内容：{{TEXT}}';
const VALID_TYPES = new Set(['person', 'organization', 'location', 'number', 'event']);

type EntityType = 'person' | 'organization' | 'location' | 'number' | 'event';

interface NewsEntityInput {
    title: string;
    description?: string;
    content?: string;
}

interface ExtractedEntity {
    type: EntityType;
    value: string;
    context: string | null;
}

function cleanText(text: string): string {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseEntities(text: string): ExtractedEntity[] | null {
    try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return null;

        const parsed: unknown = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) return null;

        const entities: ExtractedEntity[] = [];
        for (const item of parsed) {
            if (!isRecord(item)) continue;
            const type = item.type;
            const value = item.value;
            const context = item.context;
            if (typeof type !== 'string' || !VALID_TYPES.has(type)) continue;
            if (typeof value !== 'string' || value.trim().length === 0) continue;
            entities.push({
                type: type as EntityType,
                value: value.trim().substring(0, 200),
                context: typeof context === 'string' && context.trim().length > 0
                    ? context.trim().substring(0, 500)
                    : null,
            });
            if (entities.length >= 15) break;
        }
        return entities;
    } catch {
        return null;
    }
}

export async function extractEntities(env: Bindings, newsId: number, item: NewsEntityInput): Promise<void> {
    const text = cleanText(item.content || item.description || '');
    const input = text.length > 1500 ? text.substring(0, 1500) : text;
    if (`${item.title} ${input}`.trim().length < 20) return;

    const order = await getProviderOrder(env);
    if (order.length === 0) return;

    const prompt = ENTITY_PROMPT
        .replace('{{TITLE}}', item.title || '')
        .replace('{{TEXT}}', input);

    const result = await callAI(env, prompt, {
        max_tokens: 800,
        temperature: 0.2,
        news_id: newsId,
        news_title: item.title,
        system_prompt: '你是新闻结构化信息抽取助手。只输出合法 JSON 数组，不要输出解释。',
    });
    if (!result) return;

    const entities = parseEntities(result);
    if (!entities) return;

    // 冷热分库：实体写在新闻所在侧；文章行缺失时回落主库（不新增前置条件，
    // 与旧行为一致——生产中该场景由 news_id 外键在写入时报错）
    const { db } = await dbForNews(env, newsId);
    await db.run(sql`DELETE FROM news_entities WHERE news_id = ${newsId}`);
    for (const entity of entities) {
        await db.run(sql`
            INSERT OR REPLACE INTO news_entities (news_id, entity_type, entity_value, entity_context)
            VALUES (${newsId}, ${entity.type}, ${entity.value}, ${entity.context})
        `);
    }
}

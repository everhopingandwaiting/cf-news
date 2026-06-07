import { Bindings } from '../types';
import { eq, sql, and, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { users, userPreferences, newsItems, newsSources } from '../db/schema';

async function sendDigestEmail(env: Bindings, to: string, username: string, items: any[]): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const siteUrl = 'https://news.slivermoss.site';

    let newsHtml = '';
    for (const item of items.slice(0, 15)) {
        const desc = (item.ai_summary || item.description || '').replace(/<[^>]+>/g, '').substring(0, 150);
        newsHtml += `
        <div style="padding:16px 0;border-bottom:1px solid #eee;">
            <div style="font-size:11px;color:#666;margin-bottom:4px;">${item.source_name || ''} · ${item.category || ''}</div>
            <a href="${siteUrl}/?id=${item.id}" style="color:#1a1b2e;text-decoration:none;font-size:15px;font-weight:600;">${item.title}</a>
            ${desc ? `<p style="color:#666;font-size:13px;margin:6px 0 0;line-height:1.5;">${desc}</p>` : ''}
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
    <div style="text-align:center;padding:20px 0;">
        <div style="font-size:24px;">✦</div>
        <h1 style="font-size:20px;margin:8px 0;color:#1a1b2e;">AI News Hub 每日摘要</h1>
        <p style="color:#666;font-size:13px;">${today} · 共 ${items.length} 条</p>
    </div>
    <div style="background:#fff;border:1px solid #eee;border-radius:12px;padding:20px;">
        ${newsHtml || '<p style="color:#666;text-align:center;">今日暂无新闻</p>'}
    </div>
    <div style="text-align:center;padding:20px;color:#999;font-size:12px;">
        <a href="${siteUrl}" style="color:#6366f1;text-decoration:none;">访问 AI News Hub</a>
    </div>
</body></html>`;

    const text = items.slice(0, 10).map((item, i) => `${i + 1}. ${item.title} (${item.source_name || ''})`).join('\n');

    try {
        await env.EMAIL.send({
            to,
            from: { email: 'digest@slivermoss.site', name: 'AI News Hub' },
            subject: `✦ AI News Hub 每日摘要 - ${today}`,
            html,
            text,
        });
        return true;
    } catch (e) {
        console.error(`Failed to send digest to ${to}:`, e);
        return false;
    }
}

export async function sendDailyDigest(env: Bindings): Promise<{ sent: number; failed: number }> {
    const db = getDb(env);
    const usersList = await db.select({ email: users.email, username: users.username })
        .from(users)
        .innerJoin(userPreferences, eq(userPreferences.user_id, users.id))
        .where(eq(userPreferences.receive_digest, 1))
        .all();

    if (usersList.length === 0) return { sent: 0, failed: 0 };

    const news = await db.all<any>(sql`
        SELECT n.id, n.title, n.description, n.content, n.category, s.name as source_name
        FROM news_items n
        LEFT JOIN news_sources s ON n.source_id = s.id
        WHERE n.created_at > datetime('now', '-24 hours')
        AND n.is_deleted = 0
        ORDER BY n.created_at DESC
        LIMIT 20
    `);

    let sent = 0, failed = 0;
    for (const user of usersList) {
        const ok = await sendDigestEmail(env, user.email!, user.username!, news);
        if (ok) sent++; else failed++;
    }

    return { sent, failed };
}

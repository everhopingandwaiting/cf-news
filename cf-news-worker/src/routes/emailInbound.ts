import { Bindings } from '../types';
import { getDb } from '../db';
import { userPreferences, users } from '../db/schema';
import { eq } from 'drizzle-orm';

// Email Routing 入站处理：digest@slivermoss.site 收到含「退订」的邮件时，
// 关闭发件人账号的每日摘要订阅（Email Routing 免费，入站不限量）。
export async function handleInboundEmail(message: ForwardableEmailMessage, env: Bindings): Promise<void> {
    const to = message.to.toLowerCase();
    if (!to.includes('digest@') && !to.includes('unsubscribe@')) {
        message.forward('351022095@qq.com');
        return;
    }

    const from = (message.from || '').toLowerCase().replace(/^.*<|>.*$/g, '');
    const subject = message.headers.get('subject') || '';
    const text = await new Response(message.raw).text();
    const wantsUnsub = /退订|unsubscribe|stop/i.test(subject + ' ' + text.slice(0, 2000));

    if (!wantsUnsub) {
        message.forward('351022095@qq.com');
        return;
    }

    const db = getDb(env);
    const user = await db.select({ id: users.id }).from(users).where(eq(users.email, from)).get();
    if (user) {
        await db.update(userPreferences)
            .set({ receive_digest: 0 })
            .where(eq(userPreferences.user_id, user.id))
            .run();
        console.log(`Email unsubscribe: ${from} disabled digest`);
    }
    message.setReject(user ? '已退订每日摘要' : '已退订（未找到账号，可忽略本邮件）');
}

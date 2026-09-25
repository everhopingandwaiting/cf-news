import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { checkRadarPush } from '../../services/radarPush';

// Web Push 出站边界：真实发送会 hit network —— 在边界 mock 掉
const sendPushMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/webPush', () => ({
  sendPushNotification: sendPushMock,
}));

let db: MockD1;

/** 内存 KV：记录水位线写入，测试结束后可断言 */
function makeKV(map: Map<string, string>) {
  return {
    get: async (key: string) => map.get(key) ?? null,
    put: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

function makeEnv(kvMap: Map<string, string> = new Map()): any {
  return { DB: db, KV: makeKV(kvMap) };
}

function utcNow(): string {
  return new Date().toISOString().substring(0, 19).replace('T', ' ');
}

async function seedRadarFixture(newsIds: number[]) {
  await db.seed('user_alert_keywords', [{ user_id: 1, keyword: 'AI' }]);
  await db.seed('push_subscriptions', [
    { user_id: 1, endpoint: 'https://push/1', p256dh_key: 'k', auth_key: 'a' },
  ]);
  await db.seed(
    'news_items',
    newsIds.map(id => ({
      id,
      source_id: 1,
      title: `AI news ${id}`,
      url: `https://n/${id}`,
      created_at: utcNow(),
      is_deleted: 0,
    }))
  );
}

beforeEach(() => {
  resetDb();
  db = new MockD1();
  sendPushMock.mockReset();
  sendPushMock.mockResolvedValue(true);
});

describe('checkRadarPush - watermark pushdown', () => {
  it('pushes matching news on first run and stores the id watermark', async () => {
    await seedRadarFixture([500]);
    const kvMap = new Map<string, string>();

    const result = await checkRadarPush(makeEnv(kvMap));

    expect(result.sent).toBe(1);
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    // 水位线推进到已推送的最大 id
    expect(kvMap.get('radar-push:1:AI')).toBe('500');
  });

  it('skips news at or below the stored watermark (SQL id > watermark)', async () => {
    await seedRadarFixture([500]);
    const kvMap = new Map([['radar-push:1:AI', '500']]);

    const result = await checkRadarPush(makeEnv(kvMap));

    expect(result.sent).toBe(0);
    expect(sendPushMock).not.toHaveBeenCalled();
    // 无可推送项 → 水位线不写
    expect(kvMap.get('radar-push:1:AI')).toBe('500');
  });

  it('pushes only ids newer than the watermark and advances it', async () => {
    await seedRadarFixture([500, 501]);
    const kvMap = new Map([['radar-push:1:AI', '500']]);

    const result = await checkRadarPush(makeEnv(kvMap));

    expect(result.sent).toBe(1);
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(kvMap.get('radar-push:1:AI')).toBe('501');
  });

  it('skips everything when KV is not bound', async () => {
    await seedRadarFixture([500]);

    const result = await checkRadarPush({ DB: db } as any);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sendPushMock).not.toHaveBeenCalled();
  });
});

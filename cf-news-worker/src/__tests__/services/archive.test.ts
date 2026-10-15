import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request, MOCK_ENV } from '../helpers';
import { resetDb } from '../../db';
import {
  evictBatch,
  resolveNewsSide,
  fetchNewsBundle,
  fetchNewsDetail,
  fetchCommentCounts,
  searchFtsBoth,
  existsArchivedUrl,
} from '../../services/archive';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];
let archive: ReturnType<typeof buildTestApp>['archive'];
let env: any;

beforeAll(async () => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  // Turnstile siteverify 走网络 → 桩掉（register 用例需要）
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
  archive = built.archive;
  env = { ...MOCK_ENV, DB: db, DB_ARCHIVE: archive };

  // 双侧基础数据：主库热文 id1，归档冷文 id900
  await db.seed('news_sources', [{ id: 1, name: 'MainSrc', feed_url: 'https://rss-main', category: 'tech', language: 'en' }]);
  await archive.seed('news_sources', [{ id: 1, name: 'MainSrc', feed_url: 'https://rss-main', category: 'tech', language: 'en' }]);
  await db.seed('news_items', [
    { id: 1, source_id: 1, title: 'Hot Article', url: 'https://hot/1', category: 'tech', created_at: '2026-09-25 10:00:00', is_deleted: 0 },
  ]);
  await archive.seed('news_items', [
    {
      id: 900, source_id: 1, title: 'Cold Article', url: 'https://cold/900', category: 'world',
      description: 'archived description', content: 'x'.repeat(600),
      created_at: '2026-01-05 08:00:00', is_deleted: 0,
    },
  ]);
  await db.seed('news_summaries', [{ id: 1, news_id: 1, summary: 'hot summary' }]);
  await archive.seed('news_summaries', [{ id: 2, news_id: 900, summary: 'cold summary' }]);
  await archive.seed('news_entities', [
    { id: 1, news_id: 900, entity_type: 'person', entity_value: 'Archived Person', entity_context: 'ctx' },
  ]);
  await db.prepare('INSERT INTO news_fts(rowid, title, description) VALUES (?,?,?)')
    .bind(1, 'hot quantum chips advance', 'hot desc').run();
  await archive.prepare('INSERT INTO news_fts(rowid, title, description) VALUES (?,?,?)')
    .bind(900, 'cold quantum leap batteries', 'cold desc').run();
  await db.seed('news_comments', [
    { id: 1, news_id: 1, user_id: 1, content: 'c1', is_deleted: 0 },
    { id: 2, news_id: 1, user_id: 1, content: 'c2', is_deleted: 0 },
    { id: 3, news_id: 900, user_id: 1, content: 'cold comment', is_deleted: 0 },
  ]);
});

describe('archive service — 解析与水合', () => {
  it('resolveNewsSide — 主库优先，miss 回落归档，双侧缺失为 null', async () => {
    expect(await resolveNewsSide(env, 1)).toBe('main');
    expect(await resolveNewsSide(env, 900)).toBe('archive');
    expect(await resolveNewsSide(env, 424242)).toBeNull();
  });

  it('fetchNewsBundle — 混合 id 批量水合（含 source/摘要），缺失 id 不出现', async () => {
    const bundle = await fetchNewsBundle(env, [1, 900, 555]);
    expect(bundle.get(1).title).toBe('Hot Article');
    expect(bundle.get(1).ai_summary).toBe('hot summary');
    expect(bundle.get(1).source_name).toBe('MainSrc');
    expect(bundle.get(900).title).toBe('Cold Article');
    expect(bundle.get(900).ai_summary).toBe('cold summary');
    expect(bundle.has(555)).toBe(false);
  });

  it('fetchNewsDetail — 主库优先，归档回落，缺失 null', async () => {
    expect((await fetchNewsDetail(env, 1))?.title).toBe('Hot Article');
    expect((await fetchNewsDetail(env, 900))?.title).toBe('Cold Article');
    expect(await fetchNewsDetail(env, 424242)).toBeNull();
  });

  it('existsArchivedUrl — 归档侧 URL 命中 / 未命中 / 无绑定降级', async () => {
    expect(await existsArchivedUrl(env, 'https://cold/900')).toBe(true);
    expect(await existsArchivedUrl(env, 'https://cold/none')).toBe(false);
    expect(await existsArchivedUrl(env, undefined)).toBe(false);
    const noArchiveEnv = { ...MOCK_ENV, DB: db } as any;
    expect(await existsArchivedUrl(noArchiveEnv, 'https://cold/900')).toBe(false);
  });

  it('fetchCommentCounts — 评论永驻主库，即使 id 已归档也从主库取', async () => {
    const counts = await fetchCommentCounts(env, [1, 900, 555]);
    expect(counts.get(1)).toBe(2);
    expect(counts.get(900)).toBe(1);
    expect(counts.has(555)).toBe(false);
  });

  it('searchFtsBoth — FTS 索引不可用时优雅返回 null 不抛错（MockD1 无 FTS5，走生产同款 catch 路径）', async () => {
    // 生产 D1 有 FTS5 → 返回双库并集；MockD1 回退普通表 → MATCH 失败 → null，
    // 两个分支都不得抛异常。跨库检索的用户可见行为由下方 HTTP 搜索用例覆盖。
    const ids = await searchFtsBoth(env, 'quantum*', 50);
    if (ids !== null) {
      expect(ids.slice().sort((a, b) => a - b)).toEqual([1, 900]);
    } else {
      expect(await searchFtsBoth(env, 'quantum*', 50)).toBeNull();
    }
  });
});

describe('archive service — 读路由（HTTP）', () => {
  it('GET /api/news/:id — 归档文章详情回落', async () => {
    const { status, body } = await request(app, db, '/api/news/900');
    expect(status).toBe(200);
    expect(body.news.title).toBe('Cold Article');
    expect(body.news.ai_summary).toBe('cold summary');
    expect(body.news.source_name).toBe('MainSrc');
  });

  it('GET /api/news — 列表双库拼接：热文在前归档在后，total 为两侧之和', async () => {
    const { status, body } = await request(app, db, '/api/news');
    expect(status).toBe(200);
    expect(body.news.map((n: any) => n.id)).toEqual([1, 900]);
    expect(body.pagination.total).toBe(2);
    // 归档行评论数回主库水合（归档侧 SQL 恒 0）
    const cold = body.news.find((n: any) => n.id === 900);
    expect(cold.comments_count).toBe(1);
    const hot = body.news.find((n: any) => n.id === 1);
    expect(hot.comments_count).toBe(2);
  });

  it('GET /api/news — 深页（limit=1 page=2）路由到归档分片', async () => {
    const { status, body } = await request(app, db, '/api/news?page=2&limit=1');
    expect(status).toBe(200);
    expect(body.news).toHaveLength(1);
    expect(body.news[0].id).toBe(900);
  });

  it('GET /api/news/categories/list — 分类计数为双库合并', async () => {
    const { status, body } = await request(app, db, '/api/news/categories/list');
    expect(status).toBe(200);
    const byCat = new Map(body.categories.map((c: any) => [c.category, c.count]));
    expect(byCat.get('tech')).toBe(1);
    expect(byCat.get('world')).toBe(1); // 仅存在于归档侧的分类
  });

  it('GET /api/news/:id/entities — 归档文章实体回落', async () => {
    const { status, body } = await request(app, db, '/api/news/900/entities');
    expect(status).toBe(200);
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0].value).toBe('Archived Person');
  });

  it('GET /api/news/:id/credibility — 归档侧执行（详情+佐证同库）', async () => {
    const { status, body } = await request(app, db, '/api/news/900/credibility');
    expect(status).toBe(200);
    expect(typeof body.score).toBe('number');
  });

  it('GET /api/news/:id/content — 归档文章正文回落（>500B 直接返回）', async () => {
    const { status, body } = await request(app, db, '/api/news/900/content');
    expect(status).toBe(200);
    expect(body.content).toHaveLength(600);
  });

  it('GET /api/news?search= — 搜索结果跨双库（FTS 不可用时 LIKE 兜底同样扇出）', async () => {
    const { status, body } = await request(app, db, '/api/news?search=Article');
    expect(status).toBe(200);
    expect(body.news.map((n: any) => n.id).sort()).toEqual([1, 900]);
    expect(body.pagination.total).toBe(2);
  });

  it('GET /api/news/:id — 双侧都不存在返回 404', async () => {
    const { status } = await request(app, db, '/api/news/424242');
    expect(status).toBe(404);
  });
});

describe('archive service — evictBatch 驱逐', () => {
  it('默认未开启 — archive.enabled 缺失时直接跳过', async () => {
    const r = await evictBatch(env);
    expect(r.moved).toBe(0);
    expect(r.reason).toBe('disabled');
  });

  it('开启后把超过热窗口的行（含摘要/实体/FTS）成组迁入归档，主库侧清除', async () => {
    await db.seed('news_items', [
      { id: 600, source_id: 1, title: 'Old battery breakthrough', url: 'https://old/600', category: 'tech', created_at: '2026-01-01 00:00:00', is_deleted: 0 },
      { id: 601, source_id: 1, title: 'Fresh headline', url: 'https://new/601', category: 'tech', created_at: '2026-09-26 00:00:00', is_deleted: 0 },
    ]);
    await db.seed('news_summaries', [{ id: 600, news_id: 600, summary: 'old summary' }]);
    await db.seed('news_entities', [{ id: 600, news_id: 600, entity_type: 'event', entity_value: 'Old Event' }]);
    await db.prepare('INSERT INTO news_fts(rowid, title, description) VALUES (?,?,?)')
      .bind(600, 'old battery breakthrough', 'archivable').run();
    await db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    // 计数缓存先置为有效值，驱逐后必须被失效（expires_at=0 → 下次重算）
    await db.prepare("INSERT OR REPLACE INTO kv_cache (cache_key, value, expires_at) VALUES ('news_items_active_count', '99', 9999999999)").run();

    const r = await evictBatch(env);
    expect(r.error).toBeUndefined();
    expect(r.moved).toBe(1); // 只有 id600 超过 90 天热窗口

    // 归档侧完整接收
    expect(await resolveNewsSide(env, 600)).toBe('archive');
    expect((await fetchNewsDetail(env, 600))?.title).toBe('Old battery breakthrough');
    const archSum = await archive.prepare('SELECT news_id FROM news_summaries WHERE news_id = 600').first();
    expect(archSum).toBeTruthy();
    const archEnt = await archive.prepare('SELECT id FROM news_entities WHERE news_id = 600').first();
    expect(archEnt).toBeTruthy();

    // 主库侧清除（父行 + 子表 + FTS rowid）
    expect(await db.prepare('SELECT id FROM news_items WHERE id = 600').first()).toBeNull();
    expect(await db.prepare('SELECT id FROM news_summaries WHERE news_id = 600').first()).toBeNull();
    expect(await db.prepare('SELECT id FROM news_entities WHERE news_id = 600').first()).toBeNull();
    const mainFtsHit = await db.prepare('SELECT rowid FROM news_fts WHERE rowid = 600').all();
    expect(mainFtsHit.results).toHaveLength(0);
    const archFtsHit = await archive.prepare('SELECT rowid FROM news_fts WHERE rowid = 600').all();
    expect(archFtsHit.results).toHaveLength(1);

    // 热行不动 + news_sources 已同步 + 计数缓存已失效
    expect(await resolveNewsSide(env, 601)).toBe('main');
    const srcCount = await archive.prepare('SELECT COUNT(*) as c FROM news_sources').first() as any;
    expect(srcCount.c).toBeGreaterThanOrEqual(1);
    const cnt = await db.prepare("SELECT expires_at FROM kv_cache WHERE cache_key = 'news_items_active_count'").first() as any;
    expect(cnt.expires_at).toBe(0);
  });

  it('幂等 — 无可迁移行时 moved=0 且不报错', async () => {
    const r = await evictBatch(env);
    expect(r.error).toBeUndefined();
    expect(r.moved).toBe(0);
  });

  it('日额度帽 — 当日已迁量达到 archive.evict_max_rows 后直接返回 daily-cap', async () => {
    await db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.evict_max_rows', '1')").run();
    const r = await evictBatch(env);
    expect(r.moved).toBe(0);
    expect(r.reason).toBe('daily-cap');
    await db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.evict_max_rows', '3000')").run();
  });

  it('崩溃重跑幂等 — 归档已有同 id 副本（上次中途崩溃残留）时不重复、主库照删', async () => {
    await db.seed('news_items', [
      { id: 700, source_id: 1, title: 'Crash Leftover', url: 'https://old/700', category: 'tech', created_at: '2026-01-02 00:00:00', is_deleted: 0 },
    ]);
    // 模拟"归档侧已写入、主库侧未删"的崩溃现场
    await archive.seed('news_items', [
      { id: 700, source_id: 1, title: 'Crash Leftover', url: 'https://old/700', category: 'tech', created_at: '2026-01-02 00:00:00', is_deleted: 0 },
    ]);

    const r = await evictBatch(env);
    expect(r.error).toBeUndefined();
    expect(r.moved).toBe(1);
    expect(await db.prepare('SELECT id FROM news_items WHERE id = 700').first()).toBeNull();
    const dup = await archive.prepare('SELECT COUNT(*) AS c FROM news_items WHERE id = 700').first() as any;
    expect(dup.c).toBe(1); // OR IGNORE：不产生第二份
  });

  it('无归档绑定 — 降级为不做任何事', async () => {
    const noArchiveEnv = { ...MOCK_ENV, DB: db } as any;
    const r = await evictBatch(noArchiveEnv);
    expect(r.reason).toBe('no-archive-binding');
  });

  // 2026-10 事故：驱逐连续三日静默返回 0，console.log 是唯一出口且 wrangler
  // tail 在本环境不可用，导致"没候选/被上限挡住/抛错"三者无法区分。
  it('运行快照落库 — 成功时记录 moved/batches 且 error 为 null', async () => {
    await db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    await db.seed('news_items', [
      { id: 800, source_id: 1, title: 'Snapshot me', url: 'https://old/800', category: 'tech', created_at: '2026-01-03 00:00:00', is_deleted: 0 },
    ]);

    const r = await evictBatch(env);
    expect(r.error).toBeUndefined();
    const snap = await db.prepare("SELECT value FROM kv_cache WHERE cache_key = 'archive:evict:last'").first() as any;
    expect(snap).toBeTruthy();
    const parsed = JSON.parse(snap.value);
    expect(parsed.moved).toBe(r.moved);
    expect(parsed.error).toBeNull();
    expect(typeof parsed.at).toBe('string');
  });

  it('运行快照落库 — 抛错时记录 error 文本（不再静默）', async () => {
    const b = buildTestApp();
    const failEnv = { ...MOCK_ENV, DB: b.db, DB_ARCHIVE: b.archive } as any;
    await b.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    await b.db.seed('news_items', [
      { id: 810, source_id: 1, title: 'Boom', url: 'https://old/810', category: 'tech', created_at: '2026-01-04 00:00:00', is_deleted: 0 },
    ]);
    // 破坏归档侧表结构 → 跨库写入必然抛错（模拟生产上的 schema 漂移）
    await b.archive.prepare('DROP TABLE news_items').run();

    const r = await evictBatch(failEnv);
    expect(r.error).toBeTruthy();
    const snap = await b.db.prepare("SELECT value FROM kv_cache WHERE cache_key = 'archive:evict:last'").first() as any;
    const parsed = JSON.parse(snap.value);
    expect(parsed.error).toBeTruthy();
    expect(parsed.error).toBe(r.error);
  });

  it('中途失败不虚增当日计数器 — 额度按实际搬走的行计', async () => {
    const b = buildTestApp();
    const failEnv = { ...MOCK_ENV, DB: b.db, DB_ARCHIVE: b.archive } as any;
    await b.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    await b.db.seed('news_items', [
      { id: 820, source_id: 1, title: 'Partial A', url: 'https://old/820', category: 'tech', created_at: '2026-01-05 00:00:00', is_deleted: 0 },
      { id: 821, source_id: 1, title: 'Partial B', url: 'https://old/821', category: 'tech', created_at: '2026-01-05 00:00:00', is_deleted: 0 },
    ]);
    await b.archive.prepare('DROP TABLE news_items').run();

    const r = await evictBatch(failEnv);
    expect(r.error).toBeTruthy();
    expect(r.moved).toBe(0); // 首批即失败，没有真正搬成的行
    const counterKey = `archive:evict:${new Date().toISOString().slice(0, 10)}`;
    const counter = await b.db.prepare('SELECT value FROM kv_cache WHERE cache_key = ?').bind(counterKey).first() as any;
    expect(counter).toBeNull(); // 额度未被这次失败消耗
    const snap = await b.db.prepare("SELECT value FROM kv_cache WHERE cache_key = 'archive:evict:last'").first() as any;
    expect(JSON.parse(snap.value).error).toBeTruthy();
  });

  // 2026-10-15 事故：08:00 调用里 retention 跑完、驱逐段未执行（同 invocation 被
  // 平台掐断）且毫无痕迹。*/5 cron 用 notBeforeHourUtc 重试补齐——未到点必须
  // 快速跳过且不写快照，否则会盖掉当日真实运行记录。
  it('not-due-yet — 未到自愈时间窗直接跳过，不迁移也不写快照', async () => {
    const b = buildTestApp();
    const e = { ...MOCK_ENV, DB: b.db, DB_ARCHIVE: b.archive } as any;
    await b.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    await b.db.seed('news_items', [
      { id: 830, source_id: 1, title: 'Not due', url: 'https://old/830', category: 'tech', created_at: '2026-01-08 00:00:00', is_deleted: 0 },
    ]);

    const r = await evictBatch(e, { notBeforeHourUtc: 24 }); // 24 > 任何 UTC 小时 → 必定未到点
    expect(r.reason).toBe('not-due-yet');
    expect(r.moved).toBe(0);
    const snap = await b.db.prepare("SELECT value FROM kv_cache WHERE cache_key = 'archive:evict:last'").first();
    expect(snap).toBeNull();
    const stillMain = await b.db.prepare('SELECT COUNT(*) AS c FROM news_items WHERE id = 830').first() as any;
    expect(stillMain.c).toBe(1); // 行仍在主库
  });

  it('每批落盘当日计数器 — 迁移后计数器等于已迁行数（被掐断也不丢账）', async () => {
    const b = buildTestApp();
    const e = { ...MOCK_ENV, DB: b.db, DB_ARCHIVE: b.archive } as any;
    await b.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    await b.db.seed('news_items', [
      { id: 840, source_id: 1, title: 'Count A', url: 'https://old/840', category: 'tech', created_at: '2026-01-09 00:00:00', is_deleted: 0 },
      { id: 841, source_id: 1, title: 'Count B', url: 'https://old/841', category: 'tech', created_at: '2026-01-09 00:00:00', is_deleted: 0 },
    ]);

    const r = await evictBatch(e);
    expect(r.moved).toBe(2);
    const counterKey = `archive:evict:${new Date().toISOString().slice(0, 10)}`;
    const counter = await b.db.prepare('SELECT value FROM kv_cache WHERE cache_key = ?').bind(counterKey).first() as any;
    expect(Number(counter.value)).toBe(2);
  });

  it('超帽早退不覆盖当日快照 — */5 自愈不得盖掉真实运行记录', async () => {
    const b = buildTestApp();
    const e = { ...MOCK_ENV, DB: b.db, DB_ARCHIVE: b.archive } as any;
    await b.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')").run();
    await b.db.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.evict_max_rows', '1')").run();
    await b.db.seed('news_items', [
      { id: 850, source_id: 1, title: 'Cap A', url: 'https://old/850', category: 'tech', created_at: '2026-01-10 00:00:00', is_deleted: 0 },
    ]);
    const first = await evictBatch(e);
    expect(first.moved).toBe(1);
    const snapBefore = await b.db.prepare("SELECT value FROM kv_cache WHERE cache_key = 'archive:evict:last'").first() as any;

    const second = await evictBatch(e); // 当日额度已用满
    expect(second.reason).toBe('daily-cap');
    const snapAfter = await b.db.prepare("SELECT value FROM kv_cache WHERE cache_key = 'archive:evict:last'").first() as any;
    expect(snapAfter.value).toBe(snapBefore.value);
  });
});

describe('健壮性 — 归档库故障降级', () => {
  it('归档侧表损坏时：列表/分类返回主库数据 200，计数/水合不 500', async () => {
    // 独立 app 三件套，避免污染前面的用例
    const broken = buildTestApp();
    await broken.db.seed('news_sources', [{ id: 1, name: 'S', feed_url: 'https://rss-b', category: 'tech', language: 'en' }]);
    await broken.db.seed('news_items', [
      { id: 10, source_id: 1, title: 'Hot Only', url: 'https://h/10', category: 'tech', created_at: '2026-09-27 00:00:00', is_deleted: 0 },
    ]);
    // 归档库"损坏"：直接删掉 news_items 表 → 归档查询抛错
    await broken.archive.ready;
    await broken.archive.exec('DROP TABLE news_items');

    const list = await request(broken.app, broken.db, '/api/news');
    expect(list.status).toBe(200);
    expect(list.body.news.map((n: any) => n.id)).toEqual([10]);
    expect(list.body.pagination.total).toBe(1); // 归档计数降级 0

    const cats = await request(broken.app, broken.db, '/api/news/categories/list');
    expect(cats.status).toBe(200);
    expect(cats.body.categories).toEqual([{ category: 'tech', count: 1 }]);

    const detail = await request(broken.app, broken.db, '/api/news/10');
    expect(detail.status).toBe(200); // 主库命中，不触归档

    // 收藏水合：不存在的 news_id 在归档查询抛错时也只丢行不 500
    const reg = await request(broken.app, broken.db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'brk@test.com', password: 'pass123', username: 'brk' },
    });
    await broken.db.seed('user_favorites', [
      { id: 1, user_id: reg.body.user?.id ?? 1, news_id: 10, created_at: '2026-09-27 01:00:00' },
      { id: 2, user_id: reg.body.user?.id ?? 1, news_id: 424242, created_at: '2026-09-27 01:00:01' },
    ]);
    const favs = await request(broken.app, broken.db, '/api/user/favorites', {
      headers: { Authorization: `Bearer ${reg.body.token}` },
    });
    expect(favs.status).toBe(200);
    expect(favs.body.favorites.map((f: any) => f.id)).toEqual([10]); // 424242 被降级丢弃
  });
});

describe('健壮性 — 入参钳制', () => {
  it('page=abc / limit=abc 回退默认值；limit 超上限被钳到 100', async () => {
    const bad = await request(app, db, '/api/news?page=abc&limit=abc');
    expect(bad.status).toBe(200);
    expect(bad.body.pagination.page).toBe(1);
    expect(bad.body.pagination.limit).toBe(20);

    const huge = await request(app, db, '/api/news?limit=999999');
    expect(huge.status).toBe(200);
    expect(huge.body.pagination.limit).toBe(100);
    expect(huge.body.news.length).toBeLessThanOrEqual(100);

    const neg = await request(app, db, '/api/news?page=-5');
    expect(neg.status).toBe(200);
    expect(neg.body.pagination.page).toBe(1);
  });
});

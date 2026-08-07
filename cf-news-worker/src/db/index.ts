import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DbClient = DrizzleD1Database<typeof schema>;

// Per-DB-instance cache (not a singleton): fire-and-forget background tasks in
// summarizer re-call getDb() after tests reset the cache — keying by env.DB keeps
// each MockD1 isolated and prevents stale re-population. Production behavior is
// unchanged (one stable DB binding per isolate).
let _clients = new WeakMap<object, DbClient>();

export function getDb(env: { DB: D1Database }): DbClient {
    let db = _clients.get(env.DB);
    if (!db) {
        db = drizzle(env.DB, { schema });
        _clients.set(env.DB, db);
    }
    return db;
}

/** Reset cached DB clients — used in tests to isolate MockD1 instances */
export function resetDb(): void {
    _clients = new WeakMap();
}

export { schema };

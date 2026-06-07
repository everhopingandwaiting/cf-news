import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DbClient = DrizzleD1Database<typeof schema>;

let _db: DbClient | null = null;

export function getDb(env: { DB: D1Database }): DbClient {
    if (!_db) {
        _db = drizzle(env.DB, { schema });
    }
    return _db;
}

/** Reset cached DB client — used in tests to isolate MockD1 instances */
export function resetDb(): void {
    _db = null;
}

export { schema };

/**
 * In-memory mock of Cloudflare D1 binding for route-level tests.
 * Backed by sql.js (WebAssembly SQLite) — real SQL engine, no hand-written parser.
 */
import { readFileSync, readdirSync } from 'fs';
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import { resolve } from 'path';

// Module-level singleton — WASM loaded once
let sqlJsPromise: Promise<SqlJsStatic> | null = null;
function getSqlJs(): Promise<SqlJsStatic> {
  const promise = sqlJsPromise ?? initSqlJs();
  sqlJsPromise = promise;
  return promise;
}

// DDL statements extracted from schema.sql (all CREATE/ALTER/INDEX statements, no INSERT)
function loadSchemaDDL(): string[] {
  const schemaPath = resolve(__dirname, '../db/schema.sql');
  const raw = readFileSync(schemaPath, 'utf-8');
  const stmts: string[] = [];
  // Extract all DDL statements (CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE VIRTUAL TABLE)
  const ddlRegex = /^\s*(CREATE\s+(?:TABLE|INDEX|VIRTUAL\s+TABLE)|ALTER\s+TABLE)[\s\S]*?;\s*$/gm;
  let match;
  while ((match = ddlRegex.exec(raw)) !== null) {
    const stmt = match[0].trim();
    if (stmt && !/^\s*--/.test(stmt)) {
      stmts.push(stmt);
    }
  }
  return stmts;
}

/** Load all migration SQL statements (sorted by filename) */
function loadMigrationSQLs(): string[] {
  const migrationsDir = resolve(__dirname, '../../migrations');
  let files: string[];
  try {
    files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  } catch {
    return [];
  }

  const stmts: string[] = [];
  for (const file of files) {
    if (file === '001-initial.sql') continue; // already applied via schema.sql
    try {
      const raw = readFileSync(resolve(migrationsDir, file), 'utf-8');
      // Split by semicolons to get individual statements, filter empty lines
      const parts = raw.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const part of parts) {
        stmts.push(part + ';');
      }
    } catch (e) {
      // skip unreadable migration files
    }
  }
  return stmts;
}

class MockStatement {
  private db: MockD1;
  private sql: string;
  private params: any[] = [];

  constructor(db: MockD1, sql: string) {
    this.db = db;
    this.sql = sql.trim();
  }

  bind(...args: any[]) {
    this.params = args;
    return this;
  }

  async all<T = any>(): Promise<{ results: T[] }> {
    await this.db.ready;
    let stmt;
    try {
      stmt = this.db._db.prepare(this.sql);
      if (this.params.length > 0) stmt.bind(this.params);
      const results: T[] = [];
      while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, any>;
        results.push(row as T);
      }
      return { results };
    } catch (e: any) {
      throw new Error(`MockD1 SQL error: ${e.message}\nSQL: ${this.sql}`);
    } finally {
      if (stmt) stmt.free();
    }
  }

  async first<T = any>(): Promise<T | null> {
    const { results } = await this.all<T>();
    return results.length > 0 ? results[0] : null;
  }

  async run(): Promise<{ meta: { last_row_id: number; changes: number }; success: boolean }> {
    await this.db.ready;
    this.db._db.run(this.sql, this.params);
    const changes = this.db._db.getRowsModified();
    let lastRowId = 0;
    if (/^\s*INSERT\s/i.test(this.sql)) {
      const stmt = this.db._db.prepare('SELECT last_insert_rowid() as id');
      if (stmt.step()) {
        lastRowId = stmt.getAsObject().id;
      }
      stmt.free();
    }
    return {
      meta: { last_row_id: lastRowId, changes },
      success: true,
    };
  }

  async raw<T = any>(): Promise<T[]> {
    await this.db.ready;
    const stmt = this.db._db.prepare(this.sql);
    if (this.params.length > 0) stmt.bind(this.params);
    if (!stmt.step()) { stmt.free(); return [] as T[]; }
    const colNames = stmt.getColumnNames();
    const results: T[] = [];
    do {
      const row = stmt.getAsObject() as Record<string, any>;
      results.push(colNames.map((c: string) => row[c]) as T);
    } while (stmt.step());
    stmt.free();
    return results;
  }
}

export class MockD1 {
  _db!: SqlJsDatabase;
  ready: Promise<void>;

  constructor() {
    this.ready = getSqlJs().then(SQL => {
      this._db = new SQL.Database();
      // Apply DDL from schema.sql to create all tables
      const ddlStmts = loadSchemaDDL();
      for (const ddl of ddlStmts) {
        try {
          this._db.exec(ddl);
        } catch (e: any) {
          if (/CREATE\s+VIRTUAL\s+TABLE\s+IF\s+NOT\s+EXISTS\s+news_fts/i.test(ddl)) {
            this._db.exec('CREATE TABLE IF NOT EXISTS news_fts (title TEXT, description TEXT)');
          }
          // Ignore other DDL errors (e.g., duplicate columns from ALTER)
        }
      }
      // Apply migration SQLs (002+, excluding 001 which is schema.sql)
      const migrationStmts = loadMigrationSQLs();
      for (const stmt of migrationStmts) {
        try { this._db.exec(stmt); } catch (e: any) { /* ignore idempotent errors */ }
      }
    });
  }

  prepare(sql: string) {
    return new MockStatement(this, sql);
  }

  async batch(stmts: any[]): Promise<any[]> {
    const results: any[] = [];
    for (const stmt of stmts) {
      const result = await stmt.all();
      results.push(Array.isArray(result) ? { results: result } : result);
    }
    return results;
  }

  async exec(_sql: string): Promise<void> {
    await this.ready;
    this._db.exec(_sql);
  }

  /** Extract column names from SELECT clause (in ORDER they appear) */
  parseSelectedColumns(sql: string): string[] {
    const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i);
    if (!selectMatch) return [];
    const columns = selectMatch[1].split(',');
    return columns
      .map(c => {
        const trimmed = c.trim();
        // Prefer alias: col as alias, or "col" as "alias"
        const asMatch = trimmed.match(/(?:"(\w+)")?\.?(?:"(\w+)"|(\w+))\s+(?:as\s+)["']?(\w+)["']?$/i)
          || trimmed.match(/(\w+)\s+(?:as\s+)(\w+)$/i)
          || trimmed.match(/["'](\w+)["']\s+(?:as\s+)["'](\w+)["']$/i);
        if (asMatch) return (asMatch[4] || asMatch[asMatch.length - 1] || asMatch[2] || asMatch[1]).toLowerCase();
        // Extract column name from "table"."col" or "col" or col
        const colMatch = trimmed.match(/(?:"(\w+)"\.)?"(\w+)"|(\w+)/);
        if (colMatch) return (colMatch[2] || colMatch[3] || colMatch[1]).toLowerCase();
        return trimmed.toLowerCase();
      })
      .filter(c => c && c !== '*' && c !== 'n.*');
  }

  /**
   * Seed test data into a table.
   * Uses existing tables (created via schema.sql DDL), falls back to auto-create.
   */
  async seed(table: string, rows: Record<string, any>[]) {
    await this.ready;
    if (rows.length === 0) return;

    // Check if table exists
    const tableCheck = this._db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    );
    tableCheck.bind([table]);
    const exists = tableCheck.step();
    tableCheck.free();

    if (!exists) {
      const sampleRow = rows[0];
      const colDefs = Object.keys(sampleRow)
        .map(c => `"${c}" TEXT`)
        .join(', ');
      this._db.run(`CREATE TABLE IF NOT EXISTS "${table}" (${colDefs})`);
    }

    // Insert rows
    for (const row of rows) {
      const keys = Object.keys(row);
      const quotedCols = keys.map(c => `"${c}"`).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(c => row[c]);
      this._db.run(
        `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders})`,
        values,
      );
    }
  }
}

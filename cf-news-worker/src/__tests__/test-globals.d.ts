declare const __dirname: string;

declare module 'fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'path' {
  export function resolve(...paths: string[]): string;
}

declare module 'sql.js' {
  export interface Statement {
    bind(params: any[]): void;
    step(): boolean;
    getAsObject(): Record<string, any>;
    getColumnNames(): string[];
    free(): void;
  }

  export interface Database {
    prepare(sql: string): Statement;
    run(sql: string, params?: any[]): void;
    exec(sql: string): void;
    getRowsModified(): number;
  }

  export interface SqlJsStatic {
    Database: new () => Database;
  }

  export default function initSqlJs(): Promise<SqlJsStatic>;
}

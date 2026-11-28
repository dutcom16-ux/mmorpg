// Cloudflare Durable Object SQLite backend. The DO storage API is synchronous, so the game's
// transactions stay exactly as atomic as on Node: storage.transactionSync rolls back on throw.
import type { Row, SqlBackend } from './db';

export interface DoSqlCursor {
  toArray(): Row[];
  one(): Row;
}
export interface DoStorage {
  sql: { exec(query: string, ...bindings: any[]): DoSqlCursor };
  transactionSync<T>(fn: () => T): T;
}

export function durableObjectBackend(storage: DoStorage): SqlBackend {
  const sql = storage.sql;
  return {
    exec(q) {
      sql.exec(q).toArray();
    },
    run(q, params) {
      sql.exec(q, ...params).toArray();
      const r = sql.exec('SELECT changes() AS c, last_insert_rowid() AS id').one();
      return { changes: Number(r.c), id: Number(r.id) };
    },
    get(q, params) {
      return sql.exec(q, ...params).toArray()[0];
    },
    all(q, params) {
      return sql.exec(q, ...params).toArray();
    },
    tx(fn) {
      return storage.transactionSync(fn);
    },
  };
}

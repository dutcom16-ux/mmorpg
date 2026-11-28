// node:sqlite backend (local Node server and tests). Requires Node 22.13+.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Row, SqlBackend } from './db';

export function nodeSqliteBackend(file: string): SqlBackend {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  const cache = new Map<string, StatementSync>();
  const prep = (sql: string) => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  return {
    exec: (sql) => db.exec(sql),
    run(sql, params) {
      const r = prep(sql).run(...params);
      return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
    },
    get: (sql, params) => prep(sql).get(...params) as Row | undefined,
    all: (sql, params) => prep(sql).all(...params) as Row[],
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw e;
      }
    },
    close() {
      cache.clear();
      db.close();
    },
  };
}

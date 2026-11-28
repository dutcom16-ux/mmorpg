// Deletes the local SQLite database and recreates it with seed data.
// Usage: npm run db:reset        (or: npx tsx server/src/scripts/reset-db.ts --db=data/other.db)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, useBackend } from '../db';
import { nodeSqliteBackend } from '../db-node';
import { TEST_ACCOUNTS, seedIfEmpty } from '../seed';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = process.argv.find((a) => a.startsWith('--db='))?.slice(5);
const dbPath = path.resolve(ROOT, arg ?? process.env.DB_PATH ?? 'data/chipfall.db');
for (const suffix of ['', '-wal', '-shm']) {
  const f = dbPath + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}
useBackend(nodeSqliteBackend(dbPath));
await seedIfEmpty();
closeDb();
console.log(`Database ready at ${dbPath}`);
console.log('Test accounts (password for all: chipfall):');
for (const a of TEST_ACCOUNTS) console.log(`  ${a.username.padEnd(14)} ${a.name} — ${a.faction} ${a.role}, level 6`);

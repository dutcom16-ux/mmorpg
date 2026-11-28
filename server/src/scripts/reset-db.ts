// Deletes the SQLite database and recreates it with seed data.
// Usage: npm run db:reset        (or: npx tsx server/src/scripts/reset-db.ts --db=data/other.db)
import fs from 'node:fs';
import { config } from '../config';
import { closeDb, openDb } from '../db';
import { TEST_ACCOUNTS, seedIfEmpty } from '../seed';

for (const suffix of ['', '-wal', '-shm']) {
  const f = config.dbPath + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}
openDb(config.dbPath);
seedIfEmpty();
closeDb();
console.log(`Database ready at ${config.dbPath}`);
console.log('Test accounts (password for all: chipfall):');
for (const a of TEST_ACCOUNTS) console.log(`  ${a.username.padEnd(14)} ${a.name} — ${a.faction} ${a.role}, level 6`);

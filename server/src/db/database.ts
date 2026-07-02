import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { runMigrations } from './migrate.ts';

// Ensure the database directory exists before opening the file.
fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

export const db = new DatabaseSync(config.databaseFile);

// Pragmas tuned for a write-heavy, low-latency scan workload:
//  - WAL: concurrent readers never block the writer (progress reads during scans)
//  - foreign_keys: enforce referential integrity (isolation + cascade correctness)
//  - busy_timeout: retry briefly instead of throwing SQLITE_BUSY under contention
//  - synchronous NORMAL: durable enough with WAL, far faster than FULL for rapid scans
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');

runMigrations(db);

/**
 * Run `fn` inside an IMMEDIATE transaction. Commits on success, rolls back on
 * any thrown error. Synchronous - node:sqlite is a synchronous binding, which is
 * exactly what we want for atomic scan increments (no interleaving await points).
 */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback failure; surface the original error */
    }
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

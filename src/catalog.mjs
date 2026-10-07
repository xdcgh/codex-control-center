import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { isUuid } from './policy.mjs';

export function listRootThreads(codexHome, nowMs, limit = 100) {
  const dbPath = path.join(codexHome, 'state_5.sqlite');
  if (!fs.existsSync(dbPath)) throw new Error('desktop-catalog-missing');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map((item) => item.name));
    if (!['id', 'source', 'updated_at', 'archived', 'thread_source'].every((key) => columns.has(key))) throw new Error('desktop-catalog-schema-changed');
    // Catalog discovery never reads prompts/transcripts and never writes SQLite.
    const rows = db.prepare('SELECT id, source, thread_source, updated_at FROM threads WHERE archived=0 AND updated_at>=? AND updated_at<=? ORDER BY updated_at DESC LIMIT ?').all(Math.floor(nowMs / 1000) - 7 * 86400, Math.floor(nowMs / 1000) + 300, limit);
    return rows.filter((row) => isUuid(row.id) && ['cli', 'vscode', 'appServer', 'exec'].includes(row.source) && row.thread_source !== 'agent').map((row) => row.id);
  } finally { db.close(); }
}
export function isRootThreadEligible(codexHome, id) {
  if (!isUuid(id)) return false;
  const db = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT source, thread_source, archived FROM threads WHERE id=?').get(id);
    return row?.archived === 0 && ['cli', 'vscode', 'appServer', 'exec'].includes(row.source) && row.thread_source !== 'agent';
  } finally { db.close(); }
}

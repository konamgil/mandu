import { Database } from "bun:sqlite";
import path from "node:path";

const DB_PATH = path.join(import.meta.dir, "../../data/chat.db");

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
import { mkdirSync } from "node:fs";
try { mkdirSync(dataDir, { recursive: true }); } catch {}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '새 채팅',
    system_prompt TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_content ON messages(content);
`);

export default db;

import { Injectable, OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

@Injectable()
export class DatabaseService implements OnModuleInit {
  db: DatabaseSync;

  onModuleInit() {
    const dir = process.env.DATA_DIR || './data';
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'app.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        settings TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT,
        file_path TEXT,
        status TEXT DEFAULT 'processing',
        chunk_count INTEGER DEFAULT 0,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'chunk',
        seq INTEGER NOT NULL,
        text TEXT NOT NULL,
        parent_id TEXT,
        embedding TEXT NOT NULL DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_user ON chunks(user_id);

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        type TEXT,
        UNIQUE(user_id, name)
      );

      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        relation TEXT NOT NULL,
        UNIQUE(user_id, source, target, relation)
      );

      CREATE TABLE IF NOT EXISTS entity_chunks (
        entity_id INTEGER NOT NULL,
        chunk_id TEXT NOT NULL,
        PRIMARY KEY (entity_id, chunk_id)
      );

      CREATE TABLE IF NOT EXISTS chat_traces (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        status TEXT DEFAULT 'running',
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_traces_user ON chat_traces(user_id);

      CREATE TABLE IF NOT EXISTS trace_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trace_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'done',
        title TEXT,
        detail TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_steps_trace ON trace_steps(trace_id);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sources TEXT,
        trace_id TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id);
    `);

    this.alter('ALTER TABLE conversations ADD COLUMN summary TEXT');
    this.alter('ALTER TABLE chat_traces ADD COLUMN prompt_tokens INTEGER DEFAULT 0');
    this.alter('ALTER TABLE chat_traces ADD COLUMN completion_tokens INTEGER DEFAULT 0');
  }

  private alter(sql: string) {
    try {
      this.db.exec(sql);
    } catch {
      /* column already exists */
    }
  }

  prepare(sql: string) {
    return this.db.prepare(sql);
  }
}
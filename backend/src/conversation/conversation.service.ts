import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ConversationService {
  constructor(private readonly db: DatabaseService) {}

  create(userId: number, title: string): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)')
      .run(id, userId, title);
    return id;
  }

  ensureExists(userId: number, conversationId: string) {
    const row = this.db
      .prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId);
    if (!row) throw new NotFoundException('会话不存在');
  }

  list(userId: number) {
    return this.db
      .prepare(
        'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC',
      )
      .all(userId);
  }

  getMessages(userId: number, conversationId: string) {
    this.ensureExists(userId, conversationId);
    const messages = this.db
      .prepare(
        'SELECT id, role, content, sources, trace_id AS traceId, created_at AS createdAt FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC',
      )
      .all(conversationId, userId) as any[];

    return messages.map((m) => {
      const steps = m.traceId ? this.traceSteps(m.traceId) : [];
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        sources: parseJson(m.sources) ?? [],
        traceId: m.traceId,
        steps,
        createdAt: m.createdAt,
      };
    });
  }

  getRawHistory(userId: number, conversationId: string): { role: string; content: string }[] {
    return this.db
      .prepare(
        'SELECT role, content FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC, id ASC',
      )
      .all(conversationId, userId) as { role: string; content: string }[];
  }

  getSummary(conversationId: string): string | null {
    const row = this.db
      .prepare('SELECT summary FROM conversations WHERE id = ?')
      .get(conversationId) as { summary?: string | null } | undefined;
    return row?.summary || null;
  }

  updateSummary(conversationId: string, summary: string) {
    this.db.prepare('UPDATE conversations SET summary = ? WHERE id = ?').run(summary, conversationId);
  }

  stats(userId: number, conversationId: string) {
    this.ensureExists(userId, conversationId);
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(t.prompt_tokens), 0) AS prompt,
                COALESCE(SUM(t.completion_tokens), 0) AS completion
         FROM messages m JOIN chat_traces t ON m.trace_id = t.id
         WHERE m.conversation_id = ? AND m.user_id = ?`,
      )
      .get(conversationId, userId) as { prompt: number; completion: number };
    const summary = this.getSummary(conversationId);
    return {
      prompt: row.prompt,
      completion: row.completion,
      total: row.prompt + row.completion,
      summary,
      hasSummary: !!summary,
    };
  }

  private traceSteps(traceId: string) {
    const steps = this.db
      .prepare(
        'SELECT type, status, title, detail FROM trace_steps WHERE trace_id = ? ORDER BY seq ASC',
      )
      .all(traceId) as any[];
    return steps.map((s) => ({ type: s.type, status: s.status, title: s.title, detail: parseJson(s.detail) }));
  }

  addMessage(input: {
    conversationId: string;
    userId: number;
    role: 'user' | 'assistant';
    content: string;
    sources?: unknown;
    traceId?: string | null;
  }) {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO messages (id, conversation_id, user_id, role, content, sources, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.conversationId,
        input.userId,
        input.role,
        input.content,
        input.sources != null ? JSON.stringify(input.sources) : null,
        input.traceId ?? null,
      );
    this.db
      .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .run(input.conversationId);
    return id;
  }

  remove(userId: number, conversationId: string) {
    this.ensureExists(userId, conversationId);
    const traces = this.db
      .prepare('SELECT trace_id AS t FROM messages WHERE conversation_id = ? AND trace_id IS NOT NULL')
      .all(conversationId) as { t: string }[];
    for (const { t } of traces) {
      this.db.prepare('DELETE FROM trace_steps WHERE trace_id = ?').run(t);
      this.db.prepare('DELETE FROM chat_traces WHERE id = ?').run(t);
    }
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    this.db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
    return { ok: true };
  }
}

function parseJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

export interface TraceStep {
  type: string;
  title: string;
  status?: string;
  detail?: unknown;
}

@Injectable()
export class TraceService {
  constructor(private readonly db: DatabaseService) {}

  createTrace(userId: number, question: string): string {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO chat_traces (id, user_id, question) VALUES (?, ?, ?)')
      .run(id, userId, question);
    return id;
  }

  addStep(traceId: string, step: TraceStep) {
    const detail = step.detail != null ? JSON.stringify(step.detail) : null;
    const seqRow = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM trace_steps WHERE trace_id = ?')
      .get(traceId) as { s: number };
    this.db
      .prepare(
        'INSERT INTO trace_steps (trace_id, seq, type, status, title, detail) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(traceId, seqRow.s, step.type, step.status || 'done', step.title, detail);
  }

  finalizeTrace(
    traceId: string,
    status: string,
    usage?: { prompt: number; completion: number },
  ) {
    if (usage) {
      this.db
        .prepare(
          'UPDATE chat_traces SET status = ?, prompt_tokens = ?, completion_tokens = ? WHERE id = ?',
        )
        .run(status, usage.prompt, usage.completion, traceId);
    } else {
      this.db.prepare('UPDATE chat_traces SET status = ? WHERE id = ?').run(status, traceId);
    }
  }

  listTraces(userId: number) {
    return this.db
      .prepare(
        'SELECT id, question, status, created_at AS createdAt FROM chat_traces WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      )
      .all(userId);
  }

  getTrace(userId: number, traceId: string) {
    const trace = this.db
      .prepare(
        'SELECT id, question, status, created_at AS createdAt FROM chat_traces WHERE id = ? AND user_id = ?',
      )
      .get(traceId, userId) as any;
    if (!trace) return null;
    const steps = this.db
      .prepare(
        'SELECT type, status, title, detail, created_at AS createdAt FROM trace_steps WHERE trace_id = ? ORDER BY seq ASC',
      )
      .all(traceId) as any[];
    return {
      ...trace,
      steps: steps.map((s) => ({ ...s, detail: parseDetail(s.detail) })),
    };
  }
}

function parseDetail(detail: string | null): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}
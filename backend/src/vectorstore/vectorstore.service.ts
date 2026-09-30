import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

export interface ChunkRef {
  id: string;
  documentId: string;
  seq: number;
  text: string;
  score: number;
  parentId: string | null;
}

@Injectable()
export class VectorstoreService {
  constructor(private readonly db: DatabaseService) {}

  insertChunk(input: {
    documentId: string;
    userId: number;
    kind: 'chunk' | 'parent';
    seq: number;
    text: string;
    parentId?: string | null;
    embedding: number[];
  }) {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO chunks (id, document_id, user_id, kind, seq, text, parent_id, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.documentId,
        input.userId,
        input.kind,
        input.seq,
        input.text,
        input.parentId ?? null,
        JSON.stringify(input.embedding),
      );
    return id;
  }

  removeByDocument(documentId: string, userId: number) {
    this.db
      .prepare('DELETE FROM chunks WHERE document_id = ? AND user_id = ?')
      .run(documentId, userId);
  }

  getByDocument(documentId: string, userId: number) {
    return this.db
      .prepare(
        'SELECT id, document_id as documentId, seq, text, kind, parent_id as parentId FROM chunks WHERE document_id = ? AND user_id = ?',
      )
      .all(documentId, userId) as any[];
  }

  listDocumentNames(userId: number): string[] {
    const rows = this.db
      .prepare("SELECT DISTINCT filename FROM documents WHERE user_id = ? AND status = 'ready'")
      .all(userId) as { filename: string }[];
    return rows.map((r) => r.filename);
  }

  hasChunks(userId: number): boolean {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM chunks WHERE user_id = ? AND kind = 'chunk'")
      .get(userId) as { c: number };
    return row.c > 0;
  }

  searchDense(userId: number, vector: number[], topK: number): ChunkRef[] {
    const rows = this.db
      .prepare("SELECT id, document_id, seq, text, embedding, parent_id FROM chunks WHERE user_id = ? AND kind = 'chunk'")
      .all(userId) as any[];
    const q = normalize(vector);
    const scored = rows.map((r) => {
      const e = safeParseVec(r.embedding);
      return {
        id: r.id,
        documentId: r.document_id,
        seq: r.seq,
        text: r.text,
        parentId: r.parent_id,
        score: e.length ? dot(q, normalize(e)) : 0,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  searchLexical(userId: number, query: string, topK: number): ChunkRef[] {
    const rows = this.db
      .prepare("SELECT id, document_id, seq, text, parent_id FROM chunks WHERE user_id = ? AND kind = 'chunk'")
      .all(userId) as any[];
    if (rows.length === 0) return [];

    const tokens = rows.map((r) => tokenize(r.text));
    const docTokens = tokens.map((t) => new Set(t));
    const queryTokens = tokenize(query);

    const df = new Map<string, number>();
    for (const set of docTokens) {
      for (const t of set) df.set(t, (df.get(t) ?? 0) + 1);
    }
    const N = rows.length;
    const avgdl = tokens.reduce((s, t) => s + t.length, 0) / (N || 1);
    const k1 = 1.5;
    const b = 0.75;

    const scored = rows.map((r, i) => {
      const tf = new Map<string, number>();
      for (const t of tokens[i]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const q of new Set(queryTokens)) {
        const dfq = df.get(q) ?? 0;
        if (dfq === 0) continue;
        const idf = Math.log(1 + (N - dfq + 0.5) / (dfq + 0.5));
        const f = tf.get(q) ?? 0;
        const denom = f + k1 * (1 - b + (b * tokens[i].length) / avgdl);
        score += idf * ((f * (k1 + 1)) / denom);
      }
      return {
        id: r.id,
        documentId: r.document_id,
        seq: r.seq,
        text: r.text,
        parentId: r.parent_id,
        score,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((x) => x.score > 0).slice(0, topK);
  }

  getChunksByIds(ids: string[]) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT c.id, c.document_id as documentId, c.seq, c.text, d.filename
         FROM chunks c LEFT JOIN documents d ON c.document_id = d.id
         WHERE c.id IN (${placeholders})`,
      )
      .all(...ids) as any[];
  }

  getParentSummaries(userId: number, documentIds: string[]) {
    if (documentIds.length === 0) return [];
    const placeholders = documentIds.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT document_id as documentId, text, seq FROM chunks
         WHERE user_id = ? AND kind = 'parent' AND document_id IN (${placeholders})`,
      )
      .all(userId, ...documentIds) as any[];
  }
}

function parseVec(s: string): number[] {
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
const safeParseVec = parseVec;

function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9]+/g) ?? [];
  tokens.push(...latin);
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seq of cjk) {
    if (seq.length === 1) tokens.push(seq);
    else for (let i = 0; i < seq.length - 1; i++) tokens.push(seq.slice(i, i + 2));
  }
  return tokens;
}
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class GraphService {
  private readonly logger = new Logger(GraphService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly llm: LlmService,
  ) {}

  async buildFromChunks(
    userId: number,
    documentId: string,
    chunks: { id: string; text: string }[],
    maxChunks = 20,
  ) {
    const limited = chunks.slice(0, maxChunks);
    const concurrency = Math.max(1, Number(process.env.GRAPH_CONCURRENCY || 4));
    const queue = [...limited];

    const worker = async () => {
      while (queue.length > 0) {
        const chunk = queue.shift()!;
        try {
          const result = await this.llm.extractEntities(chunk.text, userId);
          this.persistChunkEntities(userId, chunk, result);
        } catch (err) {
          this.logger.warn(`entity extraction failed for chunk: ${(err as Error).message}`);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, limited.length) }, () => worker()),
    );
  }

  private persistChunkEntities(
    userId: number,
    chunk: { id: string; text: string },
    result: { entities?: { name: string; type?: string }[]; relations?: { source: string; target: string; relation: string }[] },
  ) {
    const entities = result.entities || [];
    const relations = result.relations || [];

    for (const e of entities) {
      if (!e?.name) continue;
      const entityId = this.upsertEntity(userId, e.name, e.type || '');
      this.linkEntityChunk(entityId, chunk.id);
    }
    for (const rel of relations) {
      if (!rel?.source || !rel?.target || !rel?.relation) continue;
      this.upsertRelation(userId, rel.source, rel.target, rel.relation);
      const sId = this.upsertEntity(userId, rel.source, '');
      const tId = this.upsertEntity(userId, rel.target, '');
      this.linkEntityChunk(sId, chunk.id);
      this.linkEntityChunk(tId, chunk.id);
    }
  }

  private upsertEntity(userId: number, name: string, type: string): number {
    const existing = this.db
      .prepare('SELECT id FROM entities WHERE user_id = ? AND name = ?')
      .get(userId, name) as { id: number } | undefined;
    if (existing) return existing.id;
    const res = this.db
      .prepare('INSERT INTO entities (user_id, name, type) VALUES (?, ?, ?)')
      .run(userId, name, type);
    return Number(res.lastInsertRowid);
  }

  private linkEntityChunk(entityId: number, chunkId: string) {
    this.db
      .prepare('INSERT OR IGNORE INTO entity_chunks (entity_id, chunk_id) VALUES (?, ?)')
      .run(entityId, chunkId);
  }

  private upsertRelation(userId: number, source: string, target: string, relation: string) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO relations (user_id, source, target, relation) VALUES (?, ?, ?, ?)',
      )
      .run(userId, source, target, relation);
  }

  clearDocument(userId: number, documentId: string) {
    this.db
      .prepare(
        `DELETE FROM entity_chunks WHERE chunk_id IN
         (SELECT id FROM chunks WHERE document_id = ? AND user_id = ?)`,
      )
      .run(documentId, userId);

    this.db
      .prepare(
        `DELETE FROM entities WHERE user_id = ? AND id NOT IN
         (SELECT DISTINCT entity_id FROM entity_chunks)`,
      )
      .run(userId);

    this.db
      .prepare(
        `DELETE FROM relations WHERE user_id = ? AND (
           source NOT IN (SELECT name FROM entities WHERE user_id = ?) OR
           target NOT IN (SELECT name FROM entities WHERE user_id = ?)
         )`,
      )
      .run(userId, userId);
  }

  queryChunks(userId: number, queryEntities: string[]): { chunkId: string; score: number }[] {
    if (queryEntities.length === 0) return [];

    const allEntities = this.db
      .prepare('SELECT id, name FROM entities WHERE user_id = ?')
      .all(userId) as { id: number; name: string }[];

    const matchedIds = new Set<number>();
    for (const q of queryEntities) {
      const ql = q.toLowerCase();
      for (const e of allEntities) {
        if (e.name.toLowerCase() === ql || e.name.toLowerCase().includes(ql) || ql.includes(e.name.toLowerCase())) {
          matchedIds.add(e.id);
        }
      }
    }
    if (matchedIds.size === 0) return [];

    const relations = this.db
      .prepare('SELECT source, target FROM relations WHERE user_id = ?')
      .all(userId) as { source: string; target: string }[];

    const nameToId = new Map(allEntities.map((e) => [e.name, e.id]));
    const involved = new Set(matchedIds);
    for (const rel of relations) {
      const s = nameToId.get(rel.source);
      const t = nameToId.get(rel.target);
      if (s && matchedIds.has(s) && t) involved.add(t);
      if (t && matchedIds.has(t) && s) involved.add(s);
    }

    const chunkScores = new Map<string, number>();
    for (const eid of involved) {
      const links = this.db
        .prepare('SELECT chunk_id FROM entity_chunks WHERE entity_id = ?')
        .all(eid) as { chunk_id: string }[];
      for (const l of links) {
        chunkScores.set(l.chunk_id, (chunkScores.get(l.chunk_id) ?? 0) + 1);
      }
    }
    return [...chunkScores.entries()]
      .map(([chunkId, score]) => ({ chunkId, score }))
      .sort((a, b) => b.score - a.score);
  }
}
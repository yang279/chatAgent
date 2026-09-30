import { Injectable } from '@nestjs/common';
import { LlmService, TokenUsage } from '../llm/llm.service';
import { VectorstoreService, ChunkRef } from '../vectorstore/vectorstore.service';
import { GraphService } from '../graph/graph.service';

export interface Source {
  chunkId: string;
  documentId: string;
  filename: string;
  text: string;
  score: number;
}

export interface StepLog {
  type: string;
  title: string;
  detail?: unknown;
}

export interface RetrievalResult {
  context: string;
  sources: Source[];
  steps: StepLog[];
}

@Injectable()
export class RagService {
  constructor(
    private readonly llm: LlmService,
    private readonly vectorstore: VectorstoreService,
    private readonly graph: GraphService,
  ) {}

  async detectIntent(
    userId: number,
    query: string,
    counter?: TokenUsage,
  ): Promise<{ needRetrieval: boolean; entities: string[] }> {
    if (!this.vectorstore.hasChunks(userId)) {
      return { needRetrieval: false, entities: [] };
    }
    const docNames = this.vectorstore.listDocumentNames(userId);
    return this.llm.classifyIntent(query, docNames, userId, counter);
  }

  async retrieve(
    userId: number,
    query: string,
    entities?: string[],
    counter?: TokenUsage,
  ): Promise<RetrievalResult> {
    const topK = Number(process.env.TOP_K || 6);
    const rrfK = Number(process.env.RRF_K || 60);
    const steps: StepLog[] = [];

    const [qvec] = await this.llm.embed([query], userId);

    const vectorHits = this.vectorstore.searchDense(userId, qvec, topK * 3);
    steps.push({ type: 'retrieval', title: '向量召回', detail: this.hitSummary(vectorHits) });

    const lexicalHits = this.vectorstore.searchLexical(userId, query, topK * 3);
    steps.push({ type: 'retrieval', title: '词法召回', detail: this.hitSummary(lexicalHits) });

    const queryEntities = entities ?? (await this.llm.extractQueryEntities(query, userId));
    const graphHits = this.graph.queryChunks(userId, queryEntities);
    const graphChunkIds = graphHits.map((g) => g.chunkId);
    const graphChunkMap = new Map(graphHits.map((g) => [g.chunkId, g.score]));
    const graphRefs: ChunkRef[] = this.vectorstore
      .getChunksByIds(graphChunkIds)
      .map((c) => ({
        id: c.id,
        documentId: c.documentId,
        seq: c.seq,
        text: c.text,
        parentId: null,
        score: graphChunkMap.get(c.id) ?? 0,
      }));
    steps.push({
      type: 'retrieval',
      title: '图谱召回',
      detail: { ...this.hitSummary(graphRefs), entities: queryEntities },
    });

    let fused = this.rrfFuse(
      [vectorHits, lexicalHits, graphRefs],
      rrfK,
      topK * 3,
    );

    const candidateCount = fused.length;
    const rerankedIds = await this.llm.rerank(
      query,
      fused.map((f) => ({ id: f.id, text: f.text })),
      userId,
      counter,
    );
    if (rerankedIds.length > 0) {
      const seen = new Set(rerankedIds);
      const ordered = rerankedIds
        .map((id) => fused.find((f) => f.id === id))
        .filter((f): f is ChunkRef => !!f);
      const rest = fused.filter((f) => !seen.has(f.id));
      fused = [...ordered, ...rest].slice(0, topK);
    } else {
      fused = fused.slice(0, topK);
    }
    steps.push({
      type: 'rerank',
      title: '重排',
      detail: { candidates: candidateCount, selected: fused.length },
    });

    const sources: Source[] = [];
    const docIds = new Set<string>();
    for (const hit of fused) {
      const meta = this.vectorstore
        .getChunksByIds([hit.id])[0];
      docIds.add(hit.documentId);
      sources.push({
        chunkId: hit.id,
        documentId: hit.documentId,
        filename: meta?.filename ?? hit.documentId,
        text: hit.text,
        score: Number(hit.score.toFixed(4)),
      });
    }

    const parents = this.vectorstore.getParentSummaries(userId, [...docIds]);

    const contextParts: string[] = [];
    if (parents.length) {
      contextParts.push('【文档摘要】');
      for (const p of parents) contextParts.push(`- ${p.text}`);
    }
    contextParts.push('【相关片段】');
    for (const s of sources) {
      contextParts.push(`[来源: ${s.filename}] ${s.text}`);
    }

    return {
      context: contextParts.join('\n'),
      sources,
      steps,
    };
  }

  private hitSummary(hits: ChunkRef[]) {
    return {
      count: hits.length,
      top: hits.slice(0, 3).map((h) => ({
        score: Number(h.score.toFixed(4)),
        text: h.text.slice(0, 80),
      })),
    };
  }

  private rrfFuse(rankedLists: ChunkRef[][], k: number, topK: number): ChunkRef[] {
    const scoreMap = new Map<string, ChunkRef>();
    for (const list of rankedLists) {
      list.forEach((item, rank) => {
        const rrf = 1 / (k + rank + 1);
        const existing = scoreMap.get(item.id);
        if (existing) {
          existing.score += rrf;
        } else {
          scoreMap.set(item.id, { ...item, score: rrf });
        }
      });
    }
    return [...scoreMap.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  }

  buildSystemPrompt(persona?: string): string {
    const base = [
      '你是一个智能助手。',
      '当用户消息中带有【检索到的上下文】时，优先参考其中内容回答问题；',
      '如果上下文与问题不相关或不充分，可结合自身知识正常回答。',
      '没有提供上下文时，直接正常回答用户问题。',
      '回答简洁准确，可使用 Markdown 格式。',
    ].join('\n');
    if (persona && persona.trim()) {
      return `【角色设定】\n${persona.trim()}\n\n${base}`;
    }
    return base;
  }
}
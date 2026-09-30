import { DatabaseService } from '../database/database.service';
import { LlmService } from '../llm/llm.service';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import { GraphService } from '../graph/graph.service';
import { ParserService } from './parser.service';
import { splitText } from './chunker';

export interface ProcessorDeps {
  db: DatabaseService;
  llm: LlmService;
  vectorstore: VectorstoreService;
  graph: GraphService;
  parser: ParserService;
  log?: (msg: string) => void;
}

export class DocumentProcessor {
  constructor(private readonly deps: ProcessorDeps) {}

  private log(msg: string) {
    this.deps.log?.(msg);
  }

  async process(id: string, userId: number, buffer: Buffer, mimetype: string): Promise<number> {
    this.log(`[${id}] parse start`);
    const parsed = await this.deps.parser.parse(buffer, mimetype, userId);
    if (!parsed.text || parsed.text.trim().length === 0) {
      throw new Error('未能从文档中提取到文本');
    }

    const maxLen = Number(process.env.CHUNK_SIZE || 800);
    const overlap = Number(process.env.CHUNK_OVERLAP || 100);
    const texts = splitText(parsed.text, maxLen, overlap);

    const embeddings = await this.deps.llm.embed(texts, userId);

    const parentId = await this.createParent(id, userId, parsed.text);
    this.log(`[${id}] parent done`);

    const chunkRecords: { id: string; text: string }[] = [];
    for (let i = 0; i < texts.length; i++) {
      const chunkId = this.deps.vectorstore.insertChunk({
        documentId: id,
        userId,
        kind: 'chunk',
        seq: i,
        text: texts[i],
        parentId,
        embedding: embeddings[i],
      });
      chunkRecords.push({ id: chunkId, text: texts[i] });
    }

    await this.deps.graph.buildFromChunks(userId, id, chunkRecords);
    this.log(`[${id}] graph done`);

    this.deps.db
      .prepare("UPDATE documents SET status = 'ready', chunk_count = ? WHERE id = ?")
      .run(texts.length, id);
    this.log(`[${id}] ready`);

    return texts.length;
  }

  private async createParent(
    id: string,
    userId: number,
    fullText: string,
  ): Promise<string | null> {
    try {
      const summary = await this.deps.llm.summarize(fullText, userId);
      if (!summary) return null;
      const [summaryVec] = await this.deps.llm.embed([summary], userId);
      return this.deps.vectorstore.insertChunk({
        documentId: id,
        userId,
        kind: 'parent',
        seq: 0,
        text: summary,
        parentId: null,
        embedding: summaryVec,
      });
    } catch (err) {
      this.log(`[${id}] summary failed: ${(err as Error).message}`);
      return null;
    }
  }
}

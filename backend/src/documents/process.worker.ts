import * as fs from 'node:fs';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../config/settings.service';
import { LlmService } from '../llm/llm.service';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import { GraphService } from '../graph/graph.service';
import { ParserService } from './parser.service';
import { DocumentProcessor } from './processor';

interface Payload {
  id: string;
  userId: number;
  filePath: string;
  mimetype: string;
}

async function main() {
  const payload = JSON.parse(process.env.WORKER_PAYLOAD || '{}') as Payload;

  const db = new DatabaseService();
  db.onModuleInit();

  const settings = new SettingsService(db);
  const llm = new LlmService(settings);
  const vectorstore = new VectorstoreService(db);
  const graph = new GraphService(db, llm);
  const parser = new ParserService(llm);
  const processor = new DocumentProcessor({
    db,
    llm,
    vectorstore,
    graph,
    parser,
    log: (msg) => console.log(msg),
  });

  try {
    const buffer = fs.readFileSync(payload.filePath);
    await processor.process(payload.id, payload.userId, buffer, payload.mimetype);
    process.exit(0);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    db.prepare("UPDATE documents SET status = 'failed', error = ? WHERE id = ?").run(
      msg,
      payload.id,
    );
    console.error(`[${payload.id}] worker failed: ${msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('worker bootstrap failed:', (err as Error).message);
  process.exit(1);
});

import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseService } from '../database/database.service';
import { VectorstoreService } from '../vectorstore/vectorstore.service';
import { GraphService } from '../graph/graph.service';

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly vectorstore: VectorstoreService,
    private readonly graph: GraphService,
  ) {}

  onModuleInit() {
    const res = this.db
      .prepare("UPDATE documents SET status = 'failed', error = ? WHERE status = 'processing'")
      .run('服务重启导致解析中断，请重新上传');
    if (res.changes > 0) {
      this.logger.warn(`标记 ${res.changes} 个遗留处理中文档为失败`);
    }
  }

  private uploadDir() {
    const dir = process.env.UPLOAD_DIR || './data/uploads';
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async processUpload(file: Express.Multer.File, userId: number) {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const id = randomUUID();
    const safeName = `${id}-${file.originalname}`;
    const filePath = path.join(this.uploadDir(), safeName);
    fs.writeFileSync(filePath, file.buffer);

    this.db
      .prepare(
        'INSERT INTO documents (id, user_id, filename, mime_type, file_path) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, userId, file.originalname, file.mimetype, filePath);

    this.spawnWorker(id, userId, filePath, file.mimetype);

    return { id, filename: file.originalname };
  }

  private spawnWorker(id: string, userId: number, filePath: string, mimetype: string) {
    const workerPath = path.join(__dirname, 'process.worker.js');
    const maxHeap = Number(process.env.WORKER_MAX_HEAP || 1024);
    const payload = JSON.stringify({ id, userId, filePath, mimetype });

    const child = fork(workerPath, [], {
      execArgv: [`--max-old-space-size=${maxHeap}`],
      env: { ...process.env, WORKER_PAYLOAD: payload },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    child.stdout?.on('data', (d: Buffer) => this.logger.log(d.toString().trim()));
    child.stderr?.on('data', (d: Buffer) => this.logger.error(d.toString().trim()));

    child.on('error', (err) => {
      this.logger.error(`worker ${id} error: ${err.message}`);
      this.markFailed(id, err.message);
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        this.markFailed(id, `解析进程异常退出(code=${code})，请重新上传`);
      }
    });
  }

  private markFailed(id: string, error: string) {
    this.db
      .prepare("UPDATE documents SET status = 'failed', error = ? WHERE id = ? AND status = 'processing'")
      .run(error, id);
  }

  list(userId: number) {
    return this.db
      .prepare(
        'SELECT id, filename, mime_type as mimeType, status, chunk_count as chunkCount, error, created_at as createdAt FROM documents WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(userId);
  }

  remove(userId: number, id: string) {
    const doc = this.db
      .prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?')
      .get(id, userId) as any;
    if (!doc) throw new NotFoundException('文档不存在');

    this.graph.clearDocument(userId, id);
    this.vectorstore.removeByDocument(id, userId);
    this.db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(id, userId);

    if (doc.file_path && fs.existsSync(doc.file_path)) {
      try {
        fs.unlinkSync(doc.file_path);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }
}

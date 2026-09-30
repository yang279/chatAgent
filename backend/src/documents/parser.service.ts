import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';
import { LlmService } from '../llm/llm.service';

export interface ParsedFile {
  text: string;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<any>;

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  constructor(private readonly llm: LlmService) {}

  async parse(buffer: Buffer, mimetype: string, userId: number): Promise<ParsedFile> {
    const mime = (mimetype || '').toLowerCase();
    if (mime === 'text/plain' || mime.includes('text/')) {
      return { text: buffer.toString('utf8') };
    }
    if (mime === 'application/pdf') {
      return this.parsePdf(buffer, userId);
    }
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime.includes('word')
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value };
    }
    if (mime.startsWith('image/')) {
      const base64 = buffer.toString('base64');
      const text = await this.llm.visionOCR(base64, userId, mime);
      return { text };
    }
    if (mime === 'application/msword') {
      return { text: buffer.toString('utf8') }; // legacy .doc unsupported, best-effort
    }
    throw new Error(`不支持的文件类型: ${mimetype}`);
  }

  private async parsePdf(buffer: Buffer, userId: number): Promise<ParsedFile> {
    try {
      const data = await pdfParse(buffer);
      if (data.text && data.text.trim().length > 0) {
        return { text: data.text };
      }
    } catch (err) {
      this.logger.warn(`pdf text extraction failed, falling back to OCR: ${(err as Error).message}`);
    }

    return this.ocrPdf(buffer, userId);
  }

  private async ocrPdf(buffer: Buffer, userId: number): Promise<ParsedFile> {
    const maxPages = Number(process.env.OCR_MAX_PAGES || 20);
    const scale = Number(process.env.OCR_SCALE || 1.5);

    const { pdf } = await dynamicImport('pdf-to-img');
    const doc = await pdf(buffer, { scale, format: 'jpg' });

    const parts: string[] = [];
    try {
      let i = 0;
      for await (const page of doc) {
        if (i >= maxPages) {
          this.logger.warn(`PDF has more than ${maxPages} pages, only first ${maxPages} were OCR'd`);
          break;
        }
        const base64 = (page as Buffer).toString('base64');
        const text = await this.llm.visionOCR(base64, userId, 'image/jpeg');
        if (text && text.trim().length > 0) {
          parts.push(text.trim());
        }
        i++;
      }
    } finally {
      await doc.destroy();
    }

    return { text: parts.join('\n') };
  }
}

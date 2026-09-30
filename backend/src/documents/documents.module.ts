import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { ParserService } from './parser.service';
import { LlmModule } from '../llm/llm.module';
import { VectorstoreModule } from '../vectorstore/vectorstore.module';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [LlmModule, VectorstoreModule, GraphModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ParserService],
})
export class DocumentsModule {}
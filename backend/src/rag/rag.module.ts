import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { LlmModule } from '../llm/llm.module';
import { VectorstoreModule } from '../vectorstore/vectorstore.module';
import { GraphModule } from '../graph/graph.module';

@Module({
  imports: [LlmModule, VectorstoreModule, GraphModule],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
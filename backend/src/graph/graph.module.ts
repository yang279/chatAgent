import { Module } from '@nestjs/common';
import { GraphService } from './graph.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [GraphService],
  exports: [GraphService],
})
export class GraphModule {}
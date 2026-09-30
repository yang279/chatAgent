import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RagModule } from '../rag/rag.module';
import { LlmModule } from '../llm/llm.module';
import { ConfigAppModule } from '../config/config.module';

@Module({
  imports: [RagModule, LlmModule, ConfigAppModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
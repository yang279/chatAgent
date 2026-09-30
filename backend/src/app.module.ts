import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { ConfigAppModule } from './config/config.module';
import { LlmModule } from './llm/llm.module';
import { AuthModule } from './auth/auth.module';
import { DocumentsModule } from './documents/documents.module';
import { VectorstoreModule } from './vectorstore/vectorstore.module';
import { GraphModule } from './graph/graph.module';
import { RagModule } from './rag/rag.module';
import { ChatModule } from './chat/chat.module';
import { TraceModule } from './trace/trace.module';
import { ConversationModule } from './conversation/conversation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    ConfigAppModule,
    LlmModule,
    AuthModule,
    DocumentsModule,
    VectorstoreModule,
    GraphModule,
    RagModule,
    ChatModule,
    TraceModule,
    ConversationModule,
  ],
})
export class AppModule {}
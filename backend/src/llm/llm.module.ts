import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ConfigAppModule } from '../config/config.module';

@Module({
  imports: [ConfigAppModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
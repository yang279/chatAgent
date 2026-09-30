import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { ConfigController } from './config.controller';

@Module({
  providers: [SettingsService],
  controllers: [ConfigController],
  exports: [SettingsService],
})
export class ConfigAppModule {}
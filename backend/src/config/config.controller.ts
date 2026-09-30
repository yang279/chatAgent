import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IsOptional, IsString } from 'class-validator';

class UpdateSettingsDto {
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiKey?: string;
  @IsOptional() @IsString() llmModel?: string;
  @IsOptional() @IsString() embeddingModel?: string;
  @IsOptional() @IsString() visionModel?: string;
  @IsOptional() @IsString() fastModel?: string;
  @IsOptional() @IsString() persona?: string;
}

@Controller('config')
@UseGuards(JwtAuthGuard)
export class ConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() req: any) {
    const s = this.settings.get(req.user.userId);
    return { ...s, apiKey: s.apiKey ? '****' : '' };
  }

  @Put()
  update(@Req() req: any, @Body() dto: UpdateSettingsDto) {
    const updated = this.settings.set(req.user.userId, dto);
    return { ...updated, apiKey: updated.apiKey ? '****' : '' };
  }
}
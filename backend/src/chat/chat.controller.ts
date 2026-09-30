import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService, HistoryMessage } from './chat.service';
import { TraceService } from '../trace/trace.service';

class ChatDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  history?: HistoryMessage[];

  @IsOptional()
  @IsString()
  conversationId?: string;
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly trace: TraceService,
  ) {}

  @Get('traces')
  listTraces(@Req() req: any) {
    return this.trace.listTraces(req.user.userId);
  }

  @Get('traces/:id')
  getTrace(@Req() req: any, @Param('id') id: string) {
    return this.trace.getTrace(req.user.userId, id);
  }

  @Post()
  async ask(@Body() dto: ChatDto, @Req() req: any, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (data: unknown) => {
      if (res.writableEnded || res.destroyed) return;
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* client disconnected */
      }
    };

    await this.chat.stream(
      req.user.userId,
      dto.message,
      dto.history || [],
      dto.conversationId,
      (e) => {
        send(e);
        if (e.type === 'done' || e.type === 'error') {
          if (!res.writableEnded && !res.destroyed) res.end();
        }
      },
    );
  }
}
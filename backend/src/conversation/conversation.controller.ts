import { Controller, Delete, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationService } from './conversation.service';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Get()
  list(@Req() req: any) {
    return this.conversations.list(req.user.userId);
  }

  @Get(':id/messages')
  messages(@Req() req: any, @Param('id') id: string) {
    return this.conversations.getMessages(req.user.userId, id);
  }

  @Get(':id/stats')
  stats(@Req() req: any, @Param('id') id: string) {
    return this.conversations.stats(req.user.userId, id);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.conversations.remove(req.user.userId, id);
  }
}
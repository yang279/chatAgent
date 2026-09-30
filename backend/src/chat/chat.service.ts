import { Injectable } from '@nestjs/common';
import { RagService, Source, StepLog } from '../rag/rag.service';
import { LlmService, TokenUsage, estimateTokens } from '../llm/llm.service';
import { SettingsService } from '../config/settings.service';
import { TraceService } from '../trace/trace.service';
import { ConversationService } from '../conversation/conversation.service';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatEvent =
  | { type: 'trace'; traceId: string; conversationId: string }
  | { type: 'step'; step: StepLog }
  | { type: 'sources'; sources: Source[] }
  | { type: 'token'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

@Injectable()
export class ChatService {
  constructor(
    private readonly rag: RagService,
    private readonly llm: LlmService,
    private readonly settings: SettingsService,
    private readonly trace: TraceService,
    private readonly conversation: ConversationService,
  ) {}

  async stream(
    userId: number,
    question: string,
    _history: HistoryMessage[],
    conversationId: string | undefined,
    onEvent: (e: ChatEvent) => void,
  ) {
    let traceId: string | null = null;
    const usage: TokenUsage = { prompt: 0, completion: 0 };
    try {
      let convId = conversationId;
      if (convId) {
        this.conversation.ensureExists(userId, convId);
      } else {
        convId = this.conversation.create(userId, titleOf(question));
      }

      // 读取当前问题之前的完整历史（用于记忆压缩）
      const priorHistory = this.conversation.getRawHistory(userId, convId);

      traceId = this.trace.createTrace(userId, question);
      onEvent({ type: 'trace', traceId, conversationId: convId });
      this.conversation.addMessage({
        conversationId: convId,
        userId,
        role: 'user',
        content: question,
      });

      const emitStep = (step: StepLog) => {
        this.trace.addStep(traceId!, step);
        onEvent({ type: 'step', step });
      };

      const intent = await this.rag.detectIntent(userId, question, usage);
      emitStep({
        type: 'intent',
        title: '意图识别',
        detail: { needRetrieval: intent.needRetrieval, entities: intent.entities },
      });

      let context = '';
      let sources: Source[] = [];
      if (intent.needRetrieval) {
        const result = await this.rag.retrieve(userId, question, intent.entities, usage);
        context = result.context;
        sources = result.sources;
        for (const s of result.steps) emitStep(s);
      }
      onEvent({ type: 'sources', sources });

      const contextText =
        sources.length > 0
          ? `【检索到的上下文】\n${context}\n\n【问题】\n${question}`
          : question;

      const messages = await this.buildMessages(userId, convId, priorHistory, contextText, usage);
      messages.push({ role: 'user', content: contextText });

      let thinking = '';
      const answer = await this.llm.streamChat(
        messages as any,
        userId,
        (token) => onEvent({ type: 'token', content: token }),
        (r) => {
          thinking += r;
        },
        usage,
      );

      if (thinking.trim()) {
        emitStep({ type: 'thinking', title: '思考', detail: { text: thinking.slice(0, 3000) } });
      }

      this.conversation.addMessage({
        conversationId: convId,
        userId,
        role: 'assistant',
        content: answer,
        sources,
        traceId,
      });

      this.trace.finalizeTrace(traceId, 'done', usage);
      onEvent({ type: 'done' });
    } catch (err) {
      if (traceId) this.trace.finalizeTrace(traceId, 'error', usage);
      onEvent({ type: 'error', message: (err as Error).message });
    }
  }

  private async buildMessages(
    userId: number,
    convId: string,
    priorHistory: { role: string; content: string }[],
    contextText: string,
    usage: TokenUsage,
  ): Promise<{ role: string; content: string }[]> {
    const persona = this.settings.get(userId).persona;
    const basePrompt = this.rag.buildSystemPrompt(persona);

    const budget = Number(process.env.CONTEXT_TOKEN_BUDGET || 131072);
    const thresholdRatio = Number(process.env.COMPACTION_THRESHOLD || 0.8);
    const recentWindow = Number(process.env.RECENT_WINDOW || 4);
    const threshold = budget * thresholdRatio;

    let summary = this.conversation.getSummary(convId);
    let recent = priorHistory;

    const estimator = () =>
      estimateTokens(basePrompt) +
      estimateTokens(summary || '') +
      estimateTokens(recent.map((m) => m.content).join('\n')) +
      estimateTokens(contextText) +
      8192;

    while (recent.length > recentWindow && estimator() >= threshold) {
      const cut = recent.length - recentWindow;
      const old = recent.slice(0, cut);
      summary = await this.llm.summarizeConversation(old, summary, userId, usage);
      this.conversation.updateSummary(convId, summary);
      recent = recent.slice(cut);
    }

    let systemText = basePrompt;
    if (summary) systemText += `\n\n【对话历史摘要】\n${summary}`;

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: systemText },
    ];
    for (const m of recent) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content });
      }
    }
    return messages;
  }
}

function titleOf(question: string): string {
  const t = question.replace(/\s+/g, ' ').trim();
  return t.length > 15 ? t.slice(0, 15) + '…' : t;
}
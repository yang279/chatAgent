import { Injectable } from '@nestjs/common';
import { SettingsService, LlmSettings } from '../config/settings.service';
import { localEmbed } from './embedding';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TokenUsage {
  prompt: number;
  completion: number;
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = text.replace(/[\u4e00-\u9fff]/g, '').length;
  return Math.ceil(cjk + other / 4);
}

@Injectable()
export class LlmService {
  constructor(private readonly settings: SettingsService) {}

  private url(cfg: LlmSettings, path: string) {
    const base = cfg.baseUrl.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = 180000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(
    messages: ChatMessage[],
    userId: number,
    model?: string,
    counter?: TokenUsage,
    noThinking = false,
  ): Promise<string> {
    const cfg = this.settings.get(userId);
    const res = await this.fetchWithTimeout(this.url(cfg, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: model || cfg.llmModel,
        ...(noThinking ? { enable_thinking: false } : {}),
        messages,
        temperature: 0.3,
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM chat error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    if (counter && data.usage) {
      counter.prompt += data.usage.prompt_tokens || 0;
      counter.completion += data.usage.completion_tokens || 0;
    }
    return data.choices?.[0]?.message?.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    userId: number,
    onToken: (token: string) => void,
    onReasoning?: (chunk: string) => void,
    counter?: TokenUsage,
  ): Promise<string> {
    const cfg = this.settings.get(userId);
    const res = await this.fetchWithTimeout(this.url(cfg, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llmModel,
        messages,
        temperature: 0.3,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!res.ok) {
      throw new Error(`LLM stream error ${res.status}: ${await res.text()}`);
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          if (counter && json.usage) {
            counter.prompt += json.usage.prompt_tokens || 0;
            counter.completion += json.usage.completion_tokens || 0;
          }
          const reasoning: string = json.choices?.[0]?.delta?.reasoning_content ?? '';
          if (reasoning && onReasoning) {
            onReasoning(reasoning);
          }
          const delta: string = json.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            onToken(delta);
          }
        } catch {
          /* ignore partial json */
        }
      }
    }
    return full;
  }

  async embed(texts: string[], userId: number): Promise<number[][]> {
    const cfg = this.settings.get(userId);
    const mode = process.env.EMBEDDING_MODE || 'local';
    if (mode !== 'api' || !cfg.embeddingModel) {
      return localEmbed(texts);
    }
    const res = await this.fetchWithTimeout(this.url(cfg, '/embeddings'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.embeddingModel, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Embedding error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    return data.data
      .sort((a: any, b: any) => a.index - b.index)
      .map((d: any) => d.embedding as number[]);
  }

  async visionOCR(imageBase64: string, userId: number, mimeType = 'image/jpeg'): Promise<string> {
    const cfg = this.settings.get(userId);
    const res = await this.fetchWithTimeout(this.url(cfg, '/chat/completions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.visionModel,
        max_tokens: Number(process.env.OCR_MAX_TOKENS || 2000),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '请提取图片中的全部文字内容，保持原有结构和顺序。只输出文字，不要多余说明。' },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) {
      throw new Error(`Vision OCR error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content ?? '';
  }

  async extractEntities(text: string, userId: number) {
    const prompt = [
      '你是信息抽取助手。请从下面文本中抽取命名实体及它们之间的关系。',
      '只输出 JSON，格式如下（不要输出其它内容）：',
      '{"entities":[{"name":"实体名","type":"类型"}],"relations":[{"source":"实体名","target":"实体名","relation":"关系"}]}',
      '如果没有实体或关系，输出 {"entities":[],"relations":[]}。',
      '文本：',
      text,
    ].join('\n');
    const cfg = this.settings.get(userId);
    const raw = await this.chat(
      [{ role: 'user', content: prompt }],
      userId,
      cfg.fastModel,
      undefined,
      true,
    );
    return this.parseJson(raw);
  }

  async classifyIntent(
    query: string,
    docNames: string[],
    userId: number,
    counter?: TokenUsage,
  ): Promise<{ needRetrieval: boolean; entities: string[] }> {
    const cfg = this.settings.get(userId);
    const docList = docNames.length ? docNames.join('、') : '（暂无文档）';
    const prompt = [
      '本地知识库当前包含这些文档：' + docList + '。',
      '请判断下面这条用户消息，回答它是否需要在本地知识库中检索。',
      '- 如果问题涉及上述文档内容或主题，输出 needRetrieval=true，并在 entities 里给出关键实体（人名、专有名词等）。',
      '- 如果是与文档无关的通用闲聊、常识、计算、编程、翻译等，输出 needRetrieval=false。',
      '只输出 JSON，格式：{"needRetrieval": true或false, "entities": ["实体1","实体2"]}，不要输出其它内容。',
      '用户消息：',
      query,
    ].join('\n');
    const raw = await this.chat([{ role: 'user', content: prompt }], userId, cfg.fastModel, counter, true);
    const parsed = this.parseJson(raw);
    const entities = Array.isArray(parsed.entities)
      ? parsed.entities.filter((x: unknown) => typeof x === 'string')
      : [];
    const needRetrieval =
      parsed.needRetrieval === true || parsed.needRetrieval === 'true' || entities.length > 0;
    return { needRetrieval, entities };
  }

  async rerank(
    query: string,
    candidates: { id: string; text: string }[],
    userId: number,
    counter?: TokenUsage,
  ): Promise<string[]> {
    if (candidates.length === 0) return [];
    const cfg = this.settings.get(userId);
    const lines = candidates
      .map((c, i) => `[${i}] ${c.text.slice(0, 400)}`)
      .join('\n');
    const prompt = [
      '请评估下面每个候选片段与问题的相关性，并按相关性从高到低输出片段编号。',
      '只输出编号的 JSON 数组，例如 [3, 1, 5]，不要输出其它内容。',
      `问题：${query}`,
      '候选片段：',
      lines,
    ].join('\n');
    const raw = await this.chat([{ role: 'user', content: prompt }], userId, cfg.fastModel, counter, true);
    const arr = this.parseJsonArray(raw);
    const ids = arr
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < candidates.length)
      .map((n) => candidates[n].id);
    return [...new Set(ids)];
  }

  async summarizeConversation(
    oldMessages: { role: string; content: string }[],
    prevSummary: string | null,
    userId: number,
    counter?: TokenUsage,
  ): Promise<string> {
    const cfg = this.settings.get(userId);
    const oldText = oldMessages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const prompt = [
      '你是对话记忆压缩助手。请把下面的历史对话压缩成简洁摘要，作为后续对话的长期记忆。',
      '要求：',
      '1. 概括对话的主要内容和结论。',
      '2. 【重要】逐条保留对话中用户提出的所有约束、要求、偏好、禁止事项、承诺，不得遗漏。',
      '3. 严格按下面两部分格式输出：',
      '【历史摘要】<内容概括>',
      '【约束与偏好】<逐条列出；若无则写"无">',
      '4. 保持简洁，总长度控制在 500 字以内。',
      prevSummary ? `已有的历史摘要：\n${prevSummary}\n\n` : '',
      '需要压缩的对话：',
      oldText,
    ].join('\n');
    return this.chat([{ role: 'user', content: prompt }], userId, cfg.fastModel, counter, true);
  }

  async extractQueryEntities(query: string, userId: number) {
    const prompt = [
      '你是信息抽取助手。请从下面问题中抽取关键实体，用于知识图谱检索。',
      '只输出 JSON 数组，格式如 ["实体1","实体2"]，不要输出其它内容。',
      '问题：',
      query,
    ].join('\n');
    const raw = await this.chat(
      [{ role: 'user', content: prompt }],
      userId,
    );
    return this.parseJsonArray(raw);
  }

  async summarize(text: string, userId: number): Promise<string> {
    const prompt = [
      '请为下面文档生成一段简短摘要（不超过150字），用于全文级别检索。',
      '直接输出摘要，不要多余说明。',
      '文档：',
      text.slice(0, 6000),
    ].join('\n');
    const cfg = this.settings.get(userId);
    return this.chat([{ role: 'user', content: prompt }], userId, cfg.fastModel, undefined, true);
  }

  private parseJson(raw: string) {
    const fallback = { entities: [], relations: [] };
    try {
      return JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {
          return fallback;
        }
      }
      return fallback;
    }
  }

  private parseJsonArray(raw: string): string[] {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string');
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      if (m) {
        try {
          const arr = JSON.parse(m[0]);
          if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string');
        } catch {
          /* ignore */
        }
      }
    }
    return [];
  }
}
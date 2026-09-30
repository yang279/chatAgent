import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  llmModel: string;
  embeddingModel: string;
  visionModel: string;
  fastModel: string;
  persona: string;
}

@Injectable()
export class SettingsService {
  constructor(private readonly db: DatabaseService) {}

  private defaults(): LlmSettings {
    return {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.OPENAI_API_KEY || '',
      llmModel: process.env.LLM_MODEL || 'gpt-4o-mini',
      embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      visionModel: process.env.VISION_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini',
      fastModel: process.env.FAST_MODEL || 'deepseek-v4-flash',
      persona: process.env.PERSONA || '',
    };
  }

  get(userId: number): LlmSettings {
    const defaults = this.defaults();
    const row = this.db
      .prepare('SELECT settings FROM user_settings WHERE user_id = ?')
      .get(userId) as { settings?: string } | undefined;
    if (!row?.settings) return defaults;
    try {
      const overrides = JSON.parse(row.settings);
      return { ...defaults, ...overrides };
    } catch {
      return defaults;
    }
  }

  set(userId: number, patch: Partial<LlmSettings>): LlmSettings {
    const current = this.get(userId);
    const merged = { ...current, ...patch };
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, settings) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET settings = excluded.settings`,
      )
      .run(userId, JSON.stringify(merged));
    return merged;
  }
}
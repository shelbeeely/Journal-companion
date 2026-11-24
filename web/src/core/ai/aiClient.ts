import type { AiAvailabilityState } from '../models';

export type AiGenerationResult =
  | { kind: 'success'; text: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'busy'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'failure'; message: string };

/** JSON Schema the provider may enforce (structured outputs). The validator still checks every reply. */
export interface ResponseSchema {
  name: string;
  schema: Record<string, unknown>;
}

/** How hard the model may think before answering. The thinking itself is never returned or shown. */
export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface GenerateOptions {
  temperature?: number;
  /** Budget for the visible answer only; room for thinking is added on top. */
  maxTokens?: number;
  schema?: ResponseSchema;
  /** Thinking depth for this task (default 'low'). */
  thinking?: ThinkingLevel;
}

/** Any text-generation backend. Every failure maps to a result kind so callers can fall back to templates. */
export interface AiClient {
  checkAvailability(): Promise<AiAvailabilityState>;
  generate(systemInstruction: string, prompt: string, options?: GenerateOptions): Promise<AiGenerationResult>;
}

/** Client that never has AI: used in tests and when no provider is connected. */
export class NoAiClient implements AiClient {
  async checkAvailability(): Promise<AiAvailabilityState> {
    return { kind: 'unavailable', reason: 'Templates only.' };
  }
  async generate(): Promise<AiGenerationResult> {
    return { kind: 'unavailable', reason: 'Templates only.' };
  }
}

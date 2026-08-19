import { logger } from "../../logger.js";
import { parseJsonObject, parseJsonObjectStrict } from "../../utils/json.js";
import { emitLlmAuditEvent, type LlmInvokeAuditMetadata } from "./llm-audit-context.js";
import type { LlmClient, LlmMessage } from "./llm-client.js";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
  response?: string;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

export class OllamaLlmClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly modelName: string,
    private readonly requestTimeoutMs: number
  ) {}

  async invokeJson<T>(messages: LlmMessage[], fallback: T, audit?: LlmInvokeAuditMetadata): Promise<T> {
    return this.invoke(messages, audit, (text) => parseJsonObject(text, fallback));
  }

  async invokeJsonStrict<T>(messages: LlmMessage[], audit?: LlmInvokeAuditMetadata): Promise<T> {
    return this.invoke(messages, audit, parseJsonObjectStrict<T>);
  }

  private async invoke<T>(
    messages: LlmMessage[],
    audit: LlmInvokeAuditMetadata | undefined,
    parse: (text: string) => T
  ): Promise<T> {
    const startedAt = Date.now();
    logger.info({ provider: "ollama", model: this.modelName, message_count: messages.length }, "LLM invoke started");

    try {
      const result = await this.chat(messages);
      const text = result.text;
      const parsed = parse(text);
      logger.info({
        provider: "ollama",
        model: this.modelName,
        message_count: messages.length,
        response_chars: text.length,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        duration_ms: Date.now() - startedAt
      }, "LLM invoke completed");
      await emitLlmAuditEvent({
        provider: "ollama",
        model: this.modelName,
        operation: audit?.operation ?? "answer_evaluation",
        stage: audit?.stage,
        question_id: audit?.question_id,
        status: "completed",
        duration_ms: Date.now() - startedAt,
        message_count: messages.length,
        response_chars: text.length,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        total_tokens: result.inputTokens + result.outputTokens,
        input: messages,
        output: text
      });
      return parsed;
    } catch (error) {
      logger.error({ provider: "ollama", model: this.modelName, message_count: messages.length, duration_ms: Date.now() - startedAt, err: error }, "LLM invoke failed");
      await emitLlmAuditEvent({
        provider: "ollama",
        model: this.modelName,
        operation: audit?.operation ?? "answer_evaluation",
        stage: audit?.stage,
        question_id: audit?.question_id,
        status: "failed",
        duration_ms: Date.now() - startedAt,
        message_count: messages.length,
        input: messages,
        error_name: error instanceof Error ? error.name : "Error",
        error_message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async chat(messages: LlmMessage[]): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(new URL("/api/chat", normalizedBaseUrl(this.baseUrl)), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          stream: false,
          format: "json",
          options: {
            temperature: 0
          }
        }),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => null) as OllamaChatResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || `Ollama request failed with HTTP ${response.status}`);
      }

      const text = payload?.message?.content ?? payload?.response;
      if (!text) {
        throw new Error("Ollama returned an empty response.");
      }

      return {
        text,
        inputTokens: Number(payload?.prompt_eval_count) || 0,
        outputTokens: Number(payload?.eval_count) || 0
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Ollama request timed out after ${this.requestTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

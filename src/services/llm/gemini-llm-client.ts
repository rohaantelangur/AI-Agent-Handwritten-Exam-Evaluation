import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { logger } from "../../logger.js";
import { parseJsonObject, parseJsonObjectStrict } from "../../utils/json.js";
import { emitLlmAuditEvent, llmUsageFromResponse, type LlmInvokeAuditMetadata } from "./llm-audit-context.js";
import type { LlmClient, LlmMessage } from "./llm-client.js";

export class GeminiLlmClient implements LlmClient {
  private static nextAvailableAt = 0;
  private static adaptiveDelayMs = 0;
  private static consecutiveRateLimits = 0;

  private readonly model: ChatGoogleGenerativeAI;
  private readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.modelName = modelName;
    this.model = new ChatGoogleGenerativeAI({
      apiKey,
      model: modelName,
      temperature: 0
    });
  }

  async invokeJson<T>(messages: LlmMessage[], fallback: T, audit?: LlmInvokeAuditMetadata): Promise<T> {
    return this.invoke(messages, audit, (text) => parseJsonObject(text, fallback), fallback);
  }

  async invokeJsonStrict<T>(messages: LlmMessage[], audit?: LlmInvokeAuditMetadata): Promise<T> {
    return this.invoke(messages, audit, parseJsonObjectStrict<T>);
  }

  private async invoke<T>(
    messages: LlmMessage[],
    audit: LlmInvokeAuditMetadata | undefined,
    parse: (text: string) => T,
    fallback?: T
  ): Promise<T> {
    const startedAt = Date.now();
    logger.info({ provider: "gemini", message_count: messages.length }, "LLM invoke started");
    try {
      const response = await this.invokeWithAdaptiveRetry(messages);
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const parsed = parse(text);
      const tokenUsage = llmUsageFromResponse(response);
      logger.info({
        provider: "gemini",
        message_count: messages.length,
        response_chars: text.length,
        input_tokens: tokenUsage.input_tokens,
        output_tokens: tokenUsage.output_tokens,
        cached_tokens: tokenUsage.cached_tokens,
        total_tokens: tokenUsage.total_tokens,
        duration_ms: Date.now() - startedAt
      }, "LLM invoke completed");
      await emitLlmAuditEvent({
        provider: "gemini",
        model: this.modelName,
        operation: audit?.operation ?? "answer_evaluation",
        stage: audit?.stage,
        question_id: audit?.question_id,
        status: "completed",
        duration_ms: Date.now() - startedAt,
        message_count: messages.length,
        response_chars: text.length,
        ...tokenUsage,
        input: messages,
        output: text
      });
      return parsed;
    } catch (error) {
      logger.error({ provider: "gemini", message_count: messages.length, duration_ms: Date.now() - startedAt, err: error }, "LLM invoke failed");
      const friendlyError = friendlyGeminiError(error);
      await emitLlmAuditEvent({
        provider: "gemini",
        model: this.modelName,
        operation: audit?.operation ?? "answer_evaluation",
        stage: audit?.stage,
        question_id: audit?.question_id,
        status: "failed",
        duration_ms: Date.now() - startedAt,
        message_count: messages.length,
        input: messages,
        error_name: error instanceof Error ? error.name : "Error",
        error_message: friendlyError.message
      });
      if (isRateLimitError(error) && fallback !== undefined) {
        logger.warn({
          provider: "gemini",
          model: this.modelName,
          operation: audit?.operation,
          question_id: audit?.question_id
        }, "Gemini rate limit persisted after retries; using deterministic fallback");
        return fallback;
      }
      throw friendlyError;
    }
  }

  private async invokeWithAdaptiveRetry(messages: LlmMessage[]) {
    const maxAttempts = 4;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await GeminiLlmClient.waitForTurn(this.modelName, attempt);
      try {
        const response = await this.model.invoke(messages);
        GeminiLlmClient.recordSuccess(this.modelName);
        return response;
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error) || attempt === maxAttempts) {
          throw error;
        }
        const delayMs = GeminiLlmClient.recordRateLimit(error, this.modelName, attempt);
        logger.warn({
          provider: "gemini",
          model: this.modelName,
          attempt,
          next_attempt_in_ms: delayMs,
          err: error
        }, "Gemini rate limit hit; retry scheduled with adaptive delay");
      }
    }
    throw lastError;
  }

  private static async waitForTurn(modelName: string, attempt: number): Promise<void> {
    const now = Date.now();
    const delayMs = Math.max(0, GeminiLlmClient.nextAvailableAt - now);
    if (delayMs > 0) {
      logger.info({
        provider: "gemini",
        model: modelName,
        attempt,
        delay_ms: delayMs,
        adaptive_delay_ms: GeminiLlmClient.adaptiveDelayMs
      }, "Gemini adaptive delay before invoke");
      await sleep(delayMs);
    }
  }

  private static recordRateLimit(error: unknown, modelName: string, attempt: number): number {
    GeminiLlmClient.consecutiveRateLimits += 1;
    const providerDelayMs = extractRetryDelayMs(error);
    const exponentialMs = Math.min(
      120_000,
      1_000 * 2 ** (attempt - 1) * Math.max(1, GeminiLlmClient.consecutiveRateLimits)
    );
    const jitterMs = Math.floor(Math.random() * 1_500);
    const delayMs = providerDelayMs ?? exponentialMs + jitterMs;
    GeminiLlmClient.adaptiveDelayMs = Math.max(GeminiLlmClient.adaptiveDelayMs, delayMs);
    GeminiLlmClient.nextAvailableAt = Date.now() + GeminiLlmClient.adaptiveDelayMs;
    logger.warn({
      provider: "gemini",
      model: modelName,
      provider_delay_ms: providerDelayMs,
      adaptive_delay_ms: GeminiLlmClient.adaptiveDelayMs,
      consecutive_rate_limits: GeminiLlmClient.consecutiveRateLimits
    }, "Gemini adaptive delay increased");
    return GeminiLlmClient.adaptiveDelayMs;
  }

  private static recordSuccess(modelName: string): void {
    if (GeminiLlmClient.adaptiveDelayMs > 0 || GeminiLlmClient.consecutiveRateLimits > 0) {
      GeminiLlmClient.consecutiveRateLimits = 0;
      GeminiLlmClient.adaptiveDelayMs = Math.floor(GeminiLlmClient.adaptiveDelayMs * 0.65);
      GeminiLlmClient.nextAvailableAt = Date.now() + GeminiLlmClient.adaptiveDelayMs;
      logger.info({
        provider: "gemini",
        model: modelName,
        adaptive_delay_ms: GeminiLlmClient.adaptiveDelayMs
      }, "Gemini adaptive delay reduced after success");
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("429") || text.includes("too many requests") || text.includes("quota");
}

function extractRetryDelayMs(error: unknown): number | null {
  const text = errorText(error);
  const jsonRetry = text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i)?.[1];
  if (jsonRetry) return Math.ceil(Number(jsonRetry) * 1000);
  const proseRetry = text.match(/retry\s+in\s+([\d.]+)s/i)?.[1];
  if (proseRetry) return Math.ceil(Number(proseRetry) * 1000);
  return null;
}

function friendlyGeminiError(error: unknown): Error {
  if (isRateLimitError(error)) {
    return new Error("Gemini quota or rate limit reached. The agent retried with adaptive delay; please wait and try again, or switch model/provider.");
  }
  return error instanceof Error ? error : new Error(String(error));
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message} ${JSON.stringify(error)}`;
  }
  return String(error);
}

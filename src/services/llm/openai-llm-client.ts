import { ChatOpenAI } from "@langchain/openai";
import { logger } from "../../logger.js";
import { parseJsonObject, parseJsonObjectStrict } from "../../utils/json.js";
import { emitLlmAuditEvent, type LlmInvokeAuditMetadata } from "./llm-audit-context.js";
import type { LlmClient, LlmMessage } from "./llm-client.js";

export class OpenAiLlmClient implements LlmClient {
  private readonly model: ChatOpenAI;
  private readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.modelName = modelName;
    this.model = new ChatOpenAI({
      apiKey,
      model: modelName,
      temperature: 0
    });
  }

  async invokeJson<T>(messages: LlmMessage[], fallback: T, audit?: LlmInvokeAuditMetadata): Promise<T> {
    return this.invoke(messages, audit, (text) => parseJsonObject(text, fallback));
  }

  async invokeJsonStrict<T>(messages: LlmMessage[], audit?: LlmInvokeAuditMetadata): Promise<T> {
    return this.invoke(messages, audit, parseJsonObjectStrict<T>);
  }

  private async invoke<T>(messages: LlmMessage[], audit: LlmInvokeAuditMetadata | undefined, parse: (text: string) => T): Promise<T> {
    const startedAt = Date.now();
    logger.info({ provider: "openai", message_count: messages.length }, "LLM invoke started");
    try {
      const response = await this.model.invoke(messages);
      const text = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
      const parsed = parse(text);
      logger.info({
        provider: "openai",
        message_count: messages.length,
        response_chars: text.length,
        duration_ms: Date.now() - startedAt
      }, "LLM invoke completed");
      await emitLlmAuditEvent({
        provider: "openai",
        model: this.modelName,
        operation: audit?.operation ?? "answer_evaluation",
        stage: audit?.stage,
        question_id: audit?.question_id,
        status: "completed",
        duration_ms: Date.now() - startedAt,
        message_count: messages.length,
        response_chars: text.length
      });
      return parsed;
    } catch (error) {
      logger.error({ provider: "openai", message_count: messages.length, duration_ms: Date.now() - startedAt, err: error }, "LLM invoke failed");
      await emitLlmAuditEvent({
        provider: "openai",
        model: this.modelName,
        operation: audit?.operation ?? "answer_evaluation",
        stage: audit?.stage,
        question_id: audit?.question_id,
        status: "failed",
        duration_ms: Date.now() - startedAt,
        message_count: messages.length,
        error_name: error instanceof Error ? error.name : "Error",
        error_message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

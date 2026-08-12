import { logger } from "../../logger.js";
import { emitLlmAuditEvent, type LlmInvokeAuditMetadata } from "./llm-audit-context.js";
import type { LlmClient, LlmMessage } from "./llm-client.js";

export class MockLlmClient implements LlmClient {
  async invokeJson<T>(messages: LlmMessage[], fallback: T, audit?: LlmInvokeAuditMetadata): Promise<T> {
    const startedAt = Date.now();
    logger.info({ provider: "mock", message_count: messages.length }, "LLM invoke skipped with mock fallback");
    await emitLlmAuditEvent({
      provider: "mock",
      model: "mock",
      operation: audit?.operation ?? "answer_evaluation",
      stage: audit?.stage,
      question_id: audit?.question_id,
      status: "completed",
      duration_ms: Date.now() - startedAt,
      message_count: messages.length,
      response_chars: 0
    });
    return fallback;
  }

  async invokeJsonStrict<T>(_messages: LlmMessage[], audit?: LlmInvokeAuditMetadata): Promise<T> {
    await emitLlmAuditEvent({
      provider: "mock",
      model: "mock",
      operation: audit?.operation ?? "answer_evaluation",
      stage: audit?.stage,
      question_id: audit?.question_id,
      status: "failed",
      duration_ms: 0,
      message_count: 0,
      error_name: "MockStrictLlmError",
      error_message: "Mock LLM cannot produce strict real evaluation data."
    });
    throw new Error("Mock LLM cannot produce strict real evaluation data.");
  }
}

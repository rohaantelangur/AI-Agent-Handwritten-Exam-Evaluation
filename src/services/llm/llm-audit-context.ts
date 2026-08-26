import { AsyncLocalStorage } from "node:async_hooks";
import { fetch } from "undici";
import { logger } from "../../logger.js";

export type LlmAuditContext = {
  tenant_id: string;
  exam_id: string;
  evaluation_job_id: string;
  request_id?: string;
  log_callback_url?: string;
};

export type LlmInvokeAuditMetadata = {
  operation: "question_inventory" | "answer_mapping" | "answer_evaluation";
  stage?: string;
  question_id?: string;
};

export type LlmInvokeAuditEvent = LlmInvokeAuditMetadata & {
  provider: string;
  model: string;
  status: "completed" | "failed";
  duration_ms: number;
  message_count: number;
  response_chars?: number;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
  usage?: unknown;
  input?: unknown;
  output?: unknown;
  error_name?: string;
  error_message?: string;
};

const storage = new AsyncLocalStorage<LlmAuditContext>();

export async function runWithLlmAuditContext<T>(context: LlmAuditContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getLlmAuditContext(): LlmAuditContext | undefined {
  return storage.getStore();
}

export async function emitLlmAuditEvent(event: LlmInvokeAuditEvent): Promise<void> {
  const context = getLlmAuditContext();
  if (!context?.log_callback_url) {
    logger.debug({
      provider: event.provider,
      model: event.model,
      operation: event.operation,
      status: event.status
    }, "LLM DB audit skipped: log callback not configured");
    return;
  }

  const payload = {
    event: event.status === "completed" ? "LLM_INVOKE_COMPLETED" : "LLM_INVOKE_FAILED",
    tenant_id: context.tenant_id,
    exam_id: context.exam_id,
    evaluation_job_id: context.evaluation_job_id,
    request_id: context.request_id,
    provider: event.provider,
    model: event.model,
    operation: event.operation,
    stage: event.stage,
    question_id: event.question_id,
    status: event.status,
    duration_ms: event.duration_ms,
    message_count: event.message_count,
    response_chars: event.response_chars,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cached_tokens: event.cached_tokens,
    total_tokens: event.total_tokens,
    usage: event.usage,
    input: event.input,
    output: event.output,
    error_name: event.error_name,
    error_message: event.error_message,
    at: new Date().toISOString()
  };

  try {
    await fetch(context.log_callback_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000)
    });
    logger.info({
      evaluation_job_id: context.evaluation_job_id,
      provider: event.provider,
      model: event.model,
      operation: event.operation,
      question_id: event.question_id,
      status: event.status,
      duration_ms: event.duration_ms
    }, "LLM DB audit sent");
  } catch (error) {
    logger.warn({
      evaluation_job_id: context.evaluation_job_id,
      provider: event.provider,
      model: event.model,
      operation: event.operation,
      question_id: event.question_id,
      err: error
    }, "LLM DB audit failed");
  }
}

export function llmUsageFromResponse(response: unknown): Partial<LlmInvokeAuditEvent> {
  const record = asRecord(response) || {};
  const responseMetadata = asRecord(record.response_metadata) || asRecord(record.responseMetadata);
  const usage =
    asRecord(record.usage_metadata) ||
    asRecord(record.usageMetadata) ||
    asRecord(responseMetadata?.tokenUsage) ||
    asRecord(responseMetadata?.usage) ||
    asRecord(record.usage);

  if (!usage) return {};

  const inputTokenDetails =
    asRecord(usage.input_tokens_details) ||
    asRecord(usage.inputTokensDetails) ||
    asRecord(usage.input_token_details) ||
    asRecord(usage.inputTokenDetails) ||
    asRecord(usage.prompt_tokens_details) ||
    asRecord(usage.promptTokensDetails) ||
    {};

  const inputTokens = firstFiniteNumber(
    usage.input_tokens,
    usage.inputTokens,
    usage.input_token_count,
    usage.inputTokenCount,
    usage.prompt_tokens,
    usage.promptTokens,
    usage.prompt_token_count,
    usage.promptTokenCount
  );
  const outputTokens = firstFiniteNumber(
    usage.output_tokens,
    usage.outputTokens,
    usage.output_token_count,
    usage.outputTokenCount,
    usage.completion_tokens,
    usage.completionTokens,
    usage.completion_token_count,
    usage.completionTokenCount,
    usage.candidates_token_count,
    usage.candidatesTokenCount
  );
  const cachedTokens = firstFiniteNumber(
    usage.cached_tokens,
    usage.cachedTokens,
    usage.input_cached_tokens,
    usage.inputCachedTokens,
    usage.cached_content_token_count,
    usage.cachedContentTokenCount,
    inputTokenDetails.cached_tokens,
    inputTokenDetails.cachedTokens,
    inputTokenDetails.cache_read,
    inputTokenDetails.cacheRead
  );
  const totalTokens = firstFiniteNumber(
    usage.total_tokens,
    usage.totalTokens,
    usage.total_token_count,
    usage.totalTokenCount
  );

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: cachedTokens,
    total_tokens: totalTokens || inputTokens + outputTokens || undefined,
    usage
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function firstFiniteNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

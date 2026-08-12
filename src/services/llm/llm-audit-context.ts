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

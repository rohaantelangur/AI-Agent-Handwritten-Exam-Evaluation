import type { AppConfig } from "../config.js";
import type { EvaluationApiResponse } from "../schemas/evaluation.js";
import type { EvaluationRequest } from "../schemas/request.js";
import { createEvaluationGraph } from "../graph/evaluation-graph.js";
import { logger } from "../logger.js";
import { runWithLlmAuditContext } from "../services/llm/llm-audit-context.js";

export class EvaluationWorker {
  private readonly graph;

  constructor(config: AppConfig) {
    this.graph = createEvaluationGraph(config);
  }

  async process(request: EvaluationRequest): Promise<EvaluationApiResponse> {
    const startedAt = Date.now();
    logger.info({
      tenant_id: request.tenant_id,
      exam_id: request.exam_id,
      evaluation_job_id: request.evaluation_job_id
    }, "Evaluation worker started");
    const state = await runWithLlmAuditContext({
      tenant_id: request.tenant_id,
      exam_id: request.exam_id,
      evaluation_job_id: request.evaluation_job_id,
      log_callback_url: request.log_callback_url
    }, async () => {
      return this.graph.invoke({
        request,
        warnings: []
      });
    });
    if (!state.response) {
      logger.error({
        tenant_id: request.tenant_id,
        exam_id: request.exam_id,
        evaluation_job_id: request.evaluation_job_id,
        duration_ms: Date.now() - startedAt
      }, "Evaluation worker finished without response");
      throw new Error("Evaluation workflow completed without a response");
    }
    logger.info({
      tenant_id: request.tenant_id,
      exam_id: request.exam_id,
      evaluation_job_id: request.evaluation_job_id,
      status: state.response.status,
      duration_ms: Date.now() - startedAt
    }, "Evaluation worker completed");
    return state.response;
  }
}

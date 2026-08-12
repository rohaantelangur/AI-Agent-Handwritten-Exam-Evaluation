import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { evaluationRequestSchema } from "../schemas/request.js";
import { EvaluationWorker } from "../workers/evaluation-worker.js";

export async function registerRoutes(app: FastifyInstance<any, any, any, any>, config: AppConfig): Promise<void> {
  const worker = new EvaluationWorker(config);

  app.get("/health", async () => ({
    status: "ok",
    service: "ai-agent-handwritten-exam-evaluation"
  }));

  app.post("/api/v1/evaluations/process", async (request, reply) => {
    const startedAt = Date.now();
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${config.internalApiKey}`) {
      request.log.warn("Evaluation process rejected: unauthorized");
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const parsed = evaluationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn({ details: parsed.error.flatten() }, "Evaluation process rejected: invalid request");
      return reply.code(400).send({ error: "Invalid request", details: parsed.error.flatten() });
    }
    request.log.info({
      tenant_id: parsed.data.tenant_id,
      exam_id: parsed.data.exam_id,
      evaluation_job_id: parsed.data.evaluation_job_id,
      provider: config.llmProvider,
      callback_configured: Boolean(parsed.data.callback_url),
      log_callback_configured: Boolean(parsed.data.log_callback_url),
      options: parsed.data.options
    }, "Evaluation process request accepted");
    const result = await worker.process(parsed.data);
    request.log.info({
      tenant_id: parsed.data.tenant_id,
      exam_id: parsed.data.exam_id,
      evaluation_job_id: parsed.data.evaluation_job_id,
      status: result.status,
      progress: result.progress,
      duration_ms: Date.now() - startedAt
    }, "Evaluation process request completed");
    return reply.code(200).send(result);
  });
}

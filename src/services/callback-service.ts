import { fetch } from "undici";
import { logger } from "../logger.js";

export type ProgressStatus =
  | "validating_files"
  | "downloading_files"
  | "rendering_question_paper"
  | "extracting_question_layout"
  | "building_question_inventory"
  | "rendering_answer_sheet"
  | "extracting_answers"
  | "mapping_answers"
  | "evaluating_answers"
  | "generating_report"
  | "completed";

export class CallbackService {
  async send(callbackUrl: string | undefined, payload: {
    evaluation_job_id: string;
    status: ProgressStatus;
    progress: number;
    message: string;
  }): Promise<void> {
    if (!callbackUrl) return;
    try {
      await fetch(callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000)
      });
      logger.info({
        evaluation_job_id: payload.evaluation_job_id,
        status: payload.status,
        progress: payload.progress
      }, "Progress callback sent");
    } catch (error) {
      logger.warn({ err: error, evaluation_job_id: payload.evaluation_job_id }, "Progress callback failed");
    }
  }
}

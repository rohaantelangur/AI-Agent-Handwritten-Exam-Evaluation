import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { nanoid } from "nanoid";
import type { AppConfig } from "../config.js";
import type { EvaluationRequest } from "../schemas/request.js";
import type { PageImage, S3ObjectRef } from "../schemas/common.js";
import type { LayoutElement, QuestionInventory } from "../schemas/question.js";
import type { AnswerInventory, StudentDetails } from "../schemas/answer.js";
import type { EvaluationApiResponse, FinalEvaluation, PerQuestionEvaluation } from "../schemas/evaluation.js";
import { logger } from "../logger.js";
import { assertSafeInputUrl } from "../utils/url-security.js";
import { CallbackService } from "../services/callback-service.js";
import { DownloadService, type DownloadedFile } from "../services/download-service.js";
import { PdfService } from "../services/pdf-service.js";
import { ImageService } from "../services/image-service.js";
import { StorageService } from "../services/s3-service.js";
import { LayoutService } from "../services/layout-service.js";
import { QuestionExtractionService } from "../services/question-extraction-service.js";
import { StudentExtractionService } from "../services/student-extraction-service.js";
import { AnswerExtractionService } from "../services/answer-extraction-service.js";
import { AnswerMappingService } from "../services/answer-mapping-service.js";
import { EvaluationService } from "../services/evaluation-service.js";
import { MarksService } from "../services/marks-service.js";
import { ReportService } from "../services/report-service.js";
import { ReviewedQuestionService } from "../services/reviewed-question-service.js";
import { createLlmClient } from "../services/llm/index.js";

type Warning = { code: string; question_id?: string; message: string };

const WorkflowState = Annotation.Root({
  request: Annotation<EvaluationRequest>(),
  requestId: Annotation<string>(),
  workDir: Annotation<string>(),
  warnings: Annotation<Warning[]>({
    reducer: (left, right) => [...left, ...right],
    default: () => []
  }),
  questionPdf: Annotation<DownloadedFile | undefined>(),
  answerPdf: Annotation<DownloadedFile | undefined>(),
  questionPages: Annotation<PageImage[] | undefined>(),
  answerPages: Annotation<PageImage[] | undefined>(),
  questionLayout: Annotation<LayoutElement[] | undefined>(),
  answerLayout: Annotation<LayoutElement[] | undefined>(),
  questionInventory: Annotation<QuestionInventory | undefined>(),
  answerInventory: Annotation<AnswerInventory | undefined>(),
  student: Annotation<StudentDetails | undefined>(),
  questionEvaluations: Annotation<PerQuestionEvaluation[] | undefined>(),
  finalEvaluation: Annotation<FinalEvaluation | undefined>(),
  report: Annotation<S3ObjectRef | null | undefined>(),
  response: Annotation<EvaluationApiResponse | undefined>()
});

export type EvaluationWorkflowState = typeof WorkflowState.State;

type WorkflowNode = (state: EvaluationWorkflowState) => Promise<Partial<EvaluationWorkflowState>>;

export function createEvaluationGraph(config: AppConfig) {
  const callbackService = new CallbackService();
  const downloadService = new DownloadService(config.maxPdfBytes);
  const pdfService = new PdfService(config.maxPdfPages, config.popplerBinPath);
  const imageService = new ImageService();
  const storage = new StorageService(config);
  const layoutService = new LayoutService(pdfService, imageService, storage);
  const llm = createLlmClient(config);
  const questionExtraction = new QuestionExtractionService(llm);
  const studentExtraction = new StudentExtractionService();
  const answerExtraction = new AnswerExtractionService();
  const answerMapping = new AnswerMappingService(llm);
  const marksService = new MarksService();
  const evaluationService = new EvaluationService(llm, marksService);
  const reportService = new ReportService();
  const reviewedQuestionService = new ReviewedQuestionService();

  const notify = async (state: EvaluationWorkflowState, status: Parameters<CallbackService["send"]>[1]["status"], progress: number, message: string) => {
    logger.info({
      ...logContext(state),
      stage: status,
      progress,
      callback_configured: Boolean(state.request.callback_url),
      log_callback_configured: Boolean(state.request.log_callback_url)
    }, "Evaluation progress callback sending");
    await callbackService.send(state.request.callback_url, {
      evaluation_job_id: state.request.evaluation_job_id,
      status,
      progress,
      message
    });
  };

  const withStepLogs = (stage: string, fn: WorkflowNode): WorkflowNode => async (state) => {
    const startedAt = Date.now();
    logger.info({
      ...logContext(state),
      stage,
      provider: config.llmProvider
    }, "Evaluation workflow step started");
    try {
      const result = await fn(state);
      logger.info({
        ...logContext({ ...state, ...result }),
        stage,
        duration_ms: Date.now() - startedAt,
        summary: stepSummary(stage, result)
      }, "Evaluation workflow step completed");
      return result;
    } catch (error) {
      logger.error({
        ...logContext(state),
        stage,
        duration_ms: Date.now() - startedAt,
        err: error
      }, "Evaluation workflow step failed");
      throw error;
    }
  };

  return new StateGraph(WorkflowState)
    .addNode("validate", withStepLogs("validate", async (state) => {
      await notify(state, "validating_files", 5, "Validating request URLs");
      const validations = [assertSafeInputUrl(state.request.answer_sheet_url, config.allowHttpInputs)];
      if (!state.request.reviewed_exam) {
        validations.push(assertSafeInputUrl(requireValue(state.request.question_paper_url, "question_paper_url"), config.allowHttpInputs));
      }
      await Promise.all(validations);
      const requestId = nanoid();
      const workDir = join(config.workDir, state.request.tenant_id, state.request.exam_id, state.request.evaluation_job_id, requestId);
      await mkdir(workDir, { recursive: true });
      return { requestId, workDir };
    }))
    .addNode("download", withStepLogs("download", async (state) => {
      await notify(state, "downloading_files", 10, "Downloading source PDFs");
      const sourceDir = join(state.workDir, "source");
      const answerPdf = await downloadService.downloadPdf(state.request.answer_sheet_url, join(sourceDir, "answer-sheet.pdf"));
      const questionPdf = state.request.reviewed_exam
        ? undefined
        : await downloadService.downloadPdf(requireValue(state.request.question_paper_url, "question_paper_url"), join(sourceDir, "question-paper.pdf"));
      await Promise.all([
        questionPdf ? pdfService.validatePdf(questionPdf.path) : Promise.resolve(),
        pdfService.validatePdf(answerPdf.path)
      ]);
      const uploads = [
        storage.uploadFile(
          answerPdf.path,
          storage.keyFor(s3Base(state, "source/answer-sheet.pdf")),
          "application/pdf"
        )
      ];
      if (questionPdf) {
        uploads.push(storage.uploadFile(
          questionPdf.path,
          storage.keyFor(s3Base(state, "source/question-paper.pdf")),
          "application/pdf"
        ));
      }
      await Promise.all(uploads);
      return { questionPdf, answerPdf };
    }))
    .addNode("renderQuestionPaper", withStepLogs("renderQuestionPaper", async (state) => {
      if (state.request.reviewed_exam) return {};
      await notify(state, "rendering_question_paper", 20, "Rendering question paper pages");
      const pages = await pdfService.renderPages(
        requireValue(state.questionPdf, "questionPdf").path,
        join(state.workDir, "question-paper", "pages"),
        "qp",
        state.request.options.dpi ?? config.defaultDpi
      );
      await uploadPages(storage, state, "question-paper", pages, state.request.options.upload_all_pages ?? true);
      return { questionPages: pages };
    }))
    .addNode("extractQuestionLayout", withStepLogs("extractQuestionLayout", async (state) => {
      if (state.request.reviewed_exam) return {};
      await notify(state, "extracting_question_layout", 30, "Extracting question paper layout");
      const questionLayout = await layoutService.extractDocumentLayout({
        pdfPath: requireValue(state.questionPdf, "questionPdf").path,
        pages: requireValue(state.questionPages, "questionPages"),
        documentKind: "question-paper",
        cropDir: join(state.workDir, "question-paper", "elements"),
        s3Base: baseIds(state),
        uploadElementCrops: state.request.options.upload_element_crops ?? true
      });
      return { questionLayout };
    }))
    .addNode("buildQuestionInventory", withStepLogs("buildQuestionInventory", async (state) => {
      await notify(state, "building_question_inventory", 40, "Building question inventory");
      const questionInventory = state.request.reviewed_exam
        ? reviewedQuestionService.buildQuestionInventory(state.request.reviewed_exam)
        : await questionExtraction.buildQuestionInventory(requireValue(state.questionLayout, "questionLayout"));
      const key = storage.keyFor(s3Base(state, "question-paper/question-inventory.json"));
      await storage.uploadJson(questionInventory, key);
      return { questionInventory };
    }))
    .addNode("renderAnswerSheet", withStepLogs("renderAnswerSheet", async (state) => {
      await notify(state, "rendering_answer_sheet", 50, "Rendering answer sheet pages");
      const pages = await pdfService.renderPages(
        requireValue(state.answerPdf, "answerPdf").path,
        join(state.workDir, "answer-sheet", "pages"),
        "as",
        state.request.options.dpi ?? config.defaultDpi
      );
      await uploadPages(storage, state, "answer-sheet", pages, state.request.options.upload_all_pages ?? true);
      return { answerPages: pages };
    }))
    .addNode("extractAnswers", withStepLogs("extractAnswers", async (state) => {
      await notify(state, "extracting_answers", 60, "Extracting handwritten answer regions");
      const answerLayout = await layoutService.extractDocumentLayout({
        pdfPath: requireValue(state.answerPdf, "answerPdf").path,
        pages: requireValue(state.answerPages, "answerPages"),
        documentKind: "answer-sheet",
        cropDir: join(state.workDir, "answer-sheet", "elements"),
        s3Base: baseIds(state),
        uploadElementCrops: state.request.options.upload_element_crops ?? true
      });
      const student = studentExtraction.extract(answerLayout);
      const answerInventory = answerExtraction.buildAnswerInventory({
        answerElements: answerLayout,
        pages: requireValue(state.answerPages, "answerPages"),
        student,
        questionInventory: requireValue(state.questionInventory, "questionInventory")
      });
      return { answerLayout, student, answerInventory };
    }))
    .addNode("mapAnswers", withStepLogs("mapAnswers", async (state) => {
      await notify(state, "mapping_answers", 70, "Mapping answers to questions");
      const answerInventory = await answerMapping.mapAnswers(
        requireValue(state.questionInventory, "questionInventory"),
        requireValue(state.answerInventory, "answerInventory"),
        { strict: Boolean(state.request.reviewed_exam) }
      );
      const key = storage.keyFor(s3Base(state, "answer-sheet/answer-inventory.json"));
      await storage.uploadJson(answerInventory, key);
      return { answerInventory };
    }))
    .addNode("evaluateAnswers", withStepLogs("evaluateAnswers", async (state) => {
      await notify(state, "evaluating_answers", 80, "Evaluating answers");
      const questionEvaluations = await evaluationService.evaluateAll({
        questionInventory: requireValue(state.questionInventory, "questionInventory"),
        answerInventory: requireValue(state.answerInventory, "answerInventory"),
        marksIncrement: state.request.options.marks_increment ?? config.marksIncrement,
        strictBatch: Boolean(state.request.reviewed_exam)
      });
      const questionInventoryS3Key = storage.keyFor(s3Base(state, "question-paper/question-inventory.json"));
      const answerInventoryS3Key = storage.keyFor(s3Base(state, "answer-sheet/answer-inventory.json"));
      const evaluationJsonS3Key = storage.keyFor(s3Base(state, "evaluation/evaluation.json"));
      const reportPdfS3Key = storage.keyFor(s3Base(state, "reports/student-evaluation-report.pdf"));
      const warnings = buildWarnings(questionEvaluations);
      const finalEvaluation = marksService.buildFinalEvaluation({
        tenantId: state.request.tenant_id,
        examId: state.request.exam_id,
        evaluationJobId: state.request.evaluation_job_id,
        questionInventory: requireValue(state.questionInventory, "questionInventory"),
        answerInventory: requireValue(state.answerInventory, "answerInventory"),
        questionEvaluations,
        questionInventoryS3Key,
        answerInventoryS3Key,
        evaluationJsonS3Key,
        reportPdfS3Key,
        warnings
      });
      await storage.uploadJson(finalEvaluation, evaluationJsonS3Key);
      return { questionEvaluations, finalEvaluation, warnings };
    }))
    .addNode("generateReport", withStepLogs("generateReport", async (state) => {
      await notify(state, "generating_report", 90, "Generating PDF report");
      if (state.request.options.generate_report === false) {
        return { report: null };
      }
      const reportPath = join(state.workDir, "reports", "student-evaluation-report.pdf");
      await reportService.generatePdf(requireValue(state.finalEvaluation, "finalEvaluation"), reportPath);
      const key = storage.keyFor(s3Base(state, "reports/student-evaluation-report.pdf"));
      const report = await storage.uploadFile(reportPath, key, "application/pdf");
      report.temporary_url = await storage.temporaryUrl(key);
      return { report };
    }))
    .addNode("complete", withStepLogs("complete", async (state) => {
      await notify(state, "completed", 100, "Evaluation completed");
      const finalEvaluation = requireValue(state.finalEvaluation, "finalEvaluation");
      const response: EvaluationApiResponse = {
        evaluation_job_id: state.request.evaluation_job_id,
        status: finalEvaluation.status,
        progress: 100,
        question_paper: {
          question_inventory_s3_key: finalEvaluation.assets.question_inventory_s3_key,
          total_questions: requireValue(state.questionInventory, "questionInventory").questions.length
        },
        answer_sheet: {
          answer_inventory_s3_key: finalEvaluation.assets.answer_inventory_s3_key,
          total_detected_answers: requireValue(state.answerInventory, "answerInventory").answers.length
        },
        evaluation: {
          maximum_marks: finalEvaluation.summary.maximum_marks,
          awarded_marks: finalEvaluation.summary.awarded_marks,
          percentage: finalEvaluation.summary.percentage,
          questions_requiring_review: finalEvaluation.summary.questions_requiring_review,
          evaluation_json_s3_key: finalEvaluation.assets.evaluation_json_s3_key
        },
        report: state.report ?? null,
        warnings: state.warnings,
        student: finalEvaluation.student,
        question_evaluations: finalEvaluation.question_evaluations
      };
      return { response };
    }))
    .addEdge(START, "validate")
    .addEdge("validate", "download")
    .addEdge("download", "renderQuestionPaper")
    .addEdge("renderQuestionPaper", "extractQuestionLayout")
    .addEdge("extractQuestionLayout", "buildQuestionInventory")
    .addEdge("buildQuestionInventory", "renderAnswerSheet")
    .addEdge("renderAnswerSheet", "extractAnswers")
    .addEdge("extractAnswers", "mapAnswers")
    .addEdge("mapAnswers", "evaluateAnswers")
    .addEdge("evaluateAnswers", "generateReport")
    .addEdge("generateReport", "complete")
    .addEdge("complete", END)
    .compile();
}

function logContext(state: Partial<EvaluationWorkflowState>) {
  return {
    request_id: state.requestId,
    tenant_id: state.request?.tenant_id,
    exam_id: state.request?.exam_id,
    evaluation_job_id: state.request?.evaluation_job_id
  };
}

function stepSummary(stage: string, result: Partial<EvaluationWorkflowState>) {
  if (stage === "download") {
    return {
      question_pdf_bytes: result.questionPdf?.bytes,
      answer_pdf_bytes: result.answerPdf?.bytes
    };
  }
  if (stage === "renderQuestionPaper") return { page_count: result.questionPages?.length };
  if (stage === "renderAnswerSheet") return { page_count: result.answerPages?.length };
  if (stage === "extractQuestionLayout") return { element_count: result.questionLayout?.length };
  if (stage === "extractAnswers") {
    return {
      element_count: result.answerLayout?.length,
      answer_count: result.answerInventory?.answers.length,
      unmatched_count: result.answerInventory?.unmatched_regions.length
    };
  }
  if (stage === "buildQuestionInventory") return { question_count: result.questionInventory?.questions.length };
  if (stage === "mapAnswers") {
    return {
      answer_count: result.answerInventory?.answers.length,
      unanswered_count: result.answerInventory?.unanswered_question_ids.length
    };
  }
  if (stage === "evaluateAnswers") {
    return {
      evaluation_count: result.questionEvaluations?.length,
      warning_count: result.warnings?.length,
      final_status: result.finalEvaluation?.status
    };
  }
  if (stage === "generateReport") return { report_key: result.report?.key ?? null };
  if (stage === "complete") return { status: result.response?.status, progress: result.response?.progress };
  return {};
}

function baseIds(state: EvaluationWorkflowState) {
  return {
    tenantId: state.request.tenant_id,
    examId: state.request.exam_id,
    evaluationJobId: state.request.evaluation_job_id
  };
}

function s3Base(state: EvaluationWorkflowState, relativePath: string) {
  return {
    ...baseIds(state),
    relativePath
  };
}

async function uploadPages(
  storage: StorageService,
  state: EvaluationWorkflowState,
  documentKind: "question-paper" | "answer-sheet",
  pages: PageImage[],
  enabled: boolean
): Promise<void> {
  if (!enabled) return;
  for (const page of pages) {
    const key = storage.keyFor(s3Base(
      state,
      `${documentKind}/pages/page-${String(page.page_number).padStart(3, "0")}.png`
    ));
    page.s3_key = (await storage.uploadFile(page.localPath, key, "image/png")).key;
  }
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Workflow state missing ${name}`);
  }
  return value;
}

function buildWarnings(questionEvaluations: PerQuestionEvaluation[]): Warning[] {
  return questionEvaluations
    .filter((item) => item.requires_review)
    .map((item) => ({
      code: "QUESTION_REQUIRES_REVIEW",
      question_id: item.question_id,
      message: item.review_reason ?? "Question requires manual review"
    }));
}

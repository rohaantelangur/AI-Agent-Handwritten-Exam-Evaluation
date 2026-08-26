import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import puppeteer from "puppeteer";
import { logger } from "../logger.js";
import type { AnswerInventory } from "../schemas/answer.js";
import type { FinalEvaluation } from "../schemas/evaluation.js";
import type { QuestionInventory } from "../schemas/question.js";
import { generateEvaluationReportHtml, type EvaluationReportTemplateData } from "./report-template.js";

export type ReportGenerationContext = {
  questionInventory?: QuestionInventory;
  answerInventory?: AnswerInventory;
  resolveAssetUrl?: (key: string) => Promise<string>;
};

export class ReportService {
  async generatePdf(evaluation: FinalEvaluation, outputPath: string, context: ReportGenerationContext = {}): Promise<void> {
    const startedAt = Date.now();
    logger.info({
      evaluation_job_id: evaluation.evaluation_job_id,
      outputPath,
      question_count: evaluation.question_evaluations.length
    }, "PDF report generation started");
    await mkdir(dirname(outputPath), { recursive: true });

    const html = generateEvaluationReportHtml(await this.buildReportData(evaluation, context));
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load", timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0"
        }
      });
      await writeFile(outputPath, pdf);
    } finally {
      await browser.close();
    }

    logger.info({
      evaluation_job_id: evaluation.evaluation_job_id,
      outputPath,
      duration_ms: Date.now() - startedAt
    }, "PDF report generation completed");
  }

  private async buildReportData(evaluation: FinalEvaluation, context: ReportGenerationContext): Promise<EvaluationReportTemplateData> {
    const questionById = new Map((context.questionInventory?.questions ?? []).map((question) => [question.question_id, question]));
    const answerByQuestionId = new Map(
      (context.answerInventory?.answers ?? [])
        .filter((answer) => answer.question_id)
        .map((answer) => [answer.question_id as string, answer])
    );

    return {
      institute: {
        name: studentValue(evaluation, "school_or_institute")
      },
      exam: {
        name: evaluation.exam.title ?? evaluation.exam.subject ?? "Exam",
        subject: evaluation.exam.subject,
        className: evaluation.exam.class,
        code: evaluation.exam_id,
        date: studentValue(evaluation, "exam_date")
      },
      student: {
        name: studentValue(evaluation, "student_name"),
        rollNumber: studentValue(evaluation, "roll_number"),
        seatNumber: studentValue(evaluation, "seat_number"),
        className: studentValue(evaluation, "class")
      },
      summary: {
        totalMarks: evaluation.summary.maximum_marks,
        obtainedMarks: evaluation.summary.awarded_marks,
        percentage: evaluation.summary.percentage,
        correctAnswers: evaluation.summary.correct_questions,
        attemptedQuestions: evaluation.summary.attempted_questions,
        reviewQuestions: evaluation.summary.questions_requiring_review,
        result: evaluation.status === "completed_with_warnings" ? "Needs Review" : "Completed",
        evaluatedAt: new Date().toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }),
        strengths: evaluation.overall_feedback.strengths,
        improvements: evaluation.overall_feedback.areas_for_improvement,
        overallFeedback: [
          ...evaluation.overall_feedback.recommended_topics.map((topic) => `Recommended topic: ${topic}`),
          ...evaluation.overall_feedback.study_plan.map((step) => `Study plan: ${step}`)
        ].join("\n")
      },
      questions: await Promise.all(evaluation.question_evaluations.map(async (item, index) => {
        const question = questionById.get(item.question_id);
        const answer = answerByQuestionId.get(item.question_id);
        const primaryRegion = answer?.regions.find((region) => region.crop_s3_key) ?? answer?.regions[0] ?? null;
        const answerImageUrl = primaryRegion?.crop_s3_key && context.resolveAssetUrl
          ? await context.resolveAssetUrl(primaryRegion.crop_s3_key)
          : null;
        return {
          questionNumber: question?.question_number ?? item.question_id ?? String(index + 1),
          section: question?.section_id ?? null,
          question: question?.question_text ?? item.question_id,
          maxMarks: question?.marks ?? item.maximum_marks,
          awardedMarks: item.awarded_marks,
          page: primaryRegion?.page_number ?? null,
          answerImageUrl,
          extractedAnswer: answer?.corrected_transcription || answer?.raw_ocr_text || item.answer_summary,
          feedback: item.feedback,
          strengths: item.correct_points.map((point) => point.point),
          improvements: [
            ...item.missing_points,
            ...item.incorrect_points,
            item.improvement_suggestion
          ].filter(Boolean),
          correctAnswer: question?.expected_answer ?? null,
          rubric: item.rubric_breakdown.map((criterion) => ({
            criterion: criterion.criterion,
            maxMarks: criterion.maximum_marks,
            awardedMarks: criterion.awarded_marks,
            feedback: criterion.reason
          })),
          confidence: item.evaluation_confidence,
          requiresReview: item.requires_review
        };
      }))
    };
  }
}

function studentValue(evaluation: FinalEvaluation, field: string): string | null {
  return evaluation.student[field]?.value ?? null;
}

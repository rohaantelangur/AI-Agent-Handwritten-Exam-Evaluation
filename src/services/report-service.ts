import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { logger } from "../logger.js";
import type { FinalEvaluation } from "../schemas/evaluation.js";

export class ReportService {
  async generatePdf(evaluation: FinalEvaluation, outputPath: string): Promise<void> {
    const startedAt = Date.now();
    logger.info({
      evaluation_job_id: evaluation.evaluation_job_id,
      outputPath,
      question_count: evaluation.question_evaluations.length
    }, "PDF report generation started");
    await mkdir(dirname(outputPath), { recursive: true });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595, 842]);
    let y = 790;

    const write = (text: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
      if (y < 60) {
        page = pdf.addPage([595, 842]);
        y = 790;
      }
      page.drawText(text.slice(0, 105), {
        x: 50,
        y,
        size: options.size ?? 10,
        font: options.bold ? bold : font,
        color: options.color ?? rgb(0.08, 0.09, 0.11)
      });
      y -= (options.size ?? 10) + 8;
    };

    write("Student Evaluation Report", { size: 22, bold: true });
    write(`Exam: ${evaluation.exam.title ?? evaluation.exam.subject ?? "Exam"}`, { size: 12 });
    write(`Job: ${evaluation.evaluation_job_id}`, { size: 10 });
    write(`Marks: ${evaluation.summary.awarded_marks} / ${evaluation.summary.maximum_marks} (${evaluation.summary.percentage}%)`, { size: 14, bold: true });
    y -= 10;
    write("Performance Summary", { size: 16, bold: true });
    write(`Attempted: ${evaluation.summary.attempted_questions}`);
    write(`Unanswered: ${evaluation.summary.unanswered_questions}`);
    write(`Correct: ${evaluation.summary.correct_questions}`);
    write(`Partially correct: ${evaluation.summary.partially_correct_questions}`);
    write(`Incorrect: ${evaluation.summary.incorrect_questions}`);
    write(`Manual review: ${evaluation.summary.questions_requiring_review}`);

    y -= 10;
    write("Question-wise Evaluation", { size: 16, bold: true });
    for (const item of evaluation.question_evaluations) {
      write(`${item.question_id}: ${item.awarded_marks}/${item.maximum_marks} - ${item.status}`, { bold: true });
      write(`Feedback: ${item.feedback}`);
      write(`Improve: ${item.improvement_suggestion}`);
      if (item.requires_review) write(`Review: ${item.review_reason ?? "Manual review required"}`, { color: rgb(0.65, 0.18, 0.12) });
      y -= 4;
    }

    y -= 10;
    write("Audit Assets", { size: 16, bold: true });
    write(`Question inventory: ${evaluation.assets.question_inventory_s3_key}`);
    write(`Answer inventory: ${evaluation.assets.answer_inventory_s3_key}`);
    write(`Evaluation JSON: ${evaluation.assets.evaluation_json_s3_key}`);

    await writeFile(outputPath, await pdf.save());
    logger.info({
      evaluation_job_id: evaluation.evaluation_job_id,
      outputPath,
      duration_ms: Date.now() - startedAt
    }, "PDF report generation completed");
  }
}

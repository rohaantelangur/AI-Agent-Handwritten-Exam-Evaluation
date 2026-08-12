import type { AnswerInventory } from "../schemas/answer.js";
import type { FinalEvaluation, PerQuestionEvaluation } from "../schemas/evaluation.js";
import type { QuestionInventory } from "../schemas/question.js";
import { logger } from "../logger.js";

export class MarksService {
  clampMarks(maximum: number, recommended: number, increment: number): number {
    const safe = Math.min(maximum, Math.max(0, recommended));
    return Math.round(safe / increment) * increment;
  }

  finalizeQuestionEvaluation(
    evaluation: PerQuestionEvaluation,
    maximumMarks: number,
    increment: number
  ): PerQuestionEvaluation {
    const awarded = this.clampMarks(maximumMarks, evaluation.recommended_marks, increment);
    return {
      ...evaluation,
      maximum_marks: maximumMarks,
      awarded_marks: awarded,
      status: awarded === 0 ? evaluation.status : awarded === maximumMarks ? "correct" : "partially_correct"
    };
  }

  buildFinalEvaluation(input: {
    tenantId: string;
    examId: string;
    evaluationJobId: string;
    questionInventory: QuestionInventory;
    answerInventory: AnswerInventory;
    questionEvaluations: PerQuestionEvaluation[];
    questionInventoryS3Key: string;
    answerInventoryS3Key: string;
    evaluationJsonS3Key: string;
    reportPdfS3Key: string;
    warnings: Array<{ code: string; question_id?: string; message: string }>;
  }): FinalEvaluation {
    const startedAt = Date.now();
    const maximumMarks = input.questionInventory.questions.reduce((sum, question) => sum + question.marks, 0);
    const awardedMarks = input.questionEvaluations.reduce((sum, evaluation) => sum + evaluation.awarded_marks, 0);
    const percentage = maximumMarks === 0 ? 0 : round2((awardedMarks / maximumMarks) * 100);
    const statusCounts = countStatuses(input.questionEvaluations);
    const attemptedQuestions = input.answerInventory.answers.filter((answer) => answer.question_id).length;

    const finalEvaluation: FinalEvaluation = {
      evaluation_job_id: input.evaluationJobId,
      tenant_id: input.tenantId,
      exam_id: input.examId,
      status: input.warnings.length > 0 ? "completed_with_warnings" : "completed",
      student: input.answerInventory.student,
      exam: {
        title: input.questionInventory.document.title,
        subject: input.questionInventory.document.subject,
        class: input.questionInventory.document.class,
        maximum_marks: maximumMarks
      },
      summary: {
        maximum_marks: maximumMarks,
        awarded_marks: awardedMarks,
        percentage,
        attempted_questions: attemptedQuestions,
        unanswered_questions: input.answerInventory.unanswered_question_ids.length,
        correct_questions: statusCounts.correct,
        partially_correct_questions: statusCounts.partially_correct,
        incorrect_questions: statusCounts.incorrect,
        questions_requiring_review: input.questionEvaluations.filter((item) => item.requires_review).length
      },
      section_summary: input.questionInventory.sections.map((section) => {
        const questions = input.questionInventory.questions.filter((question) => question.section_id === section.section_id);
        const questionIds = new Set(questions.map((question) => question.question_id));
        return {
          section_id: section.section_id,
          maximum_marks: questions.reduce((sum, question) => sum + question.marks, 0),
          awarded_marks: input.questionEvaluations
            .filter((evaluation) => questionIds.has(evaluation.question_id))
            .reduce((sum, evaluation) => sum + evaluation.awarded_marks, 0)
        };
      }),
      question_evaluations: input.questionEvaluations,
      overall_feedback: {
        strengths: [],
        areas_for_improvement: input.questionEvaluations
          .filter((item) => item.status !== "correct")
          .slice(0, 5)
          .map((item) => item.improvement_suggestion)
          .filter(Boolean),
        recommended_topics: [],
        study_plan: []
      },
      assets: {
        question_inventory_s3_key: input.questionInventoryS3Key,
        answer_inventory_s3_key: input.answerInventoryS3Key,
        evaluation_json_s3_key: input.evaluationJsonS3Key,
        report_pdf_s3_key: input.reportPdfS3Key
      }
    };
    logger.info({
      evaluation_job_id: input.evaluationJobId,
      maximum_marks: maximumMarks,
      awarded_marks: awardedMarks,
      percentage,
      warning_count: input.warnings.length,
      duration_ms: Date.now() - startedAt
    }, "Final evaluation calculated");
    return finalEvaluation;
  }
}

function countStatuses(evaluations: PerQuestionEvaluation[]) {
  return evaluations.reduce(
    (counts, evaluation) => {
      if (evaluation.status === "correct") counts.correct += 1;
      else if (evaluation.status === "partially_correct") counts.partially_correct += 1;
      else if (evaluation.status === "incorrect") counts.incorrect += 1;
      return counts;
    },
    { correct: 0, partially_correct: 0, incorrect: 0 }
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

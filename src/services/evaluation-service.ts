import type { AnswerInventory } from "../schemas/answer.js";
import type { PerQuestionEvaluation } from "../schemas/evaluation.js";
import type { QuestionInventory } from "../schemas/question.js";
import { logger } from "../logger.js";
import { answerEvaluationPrompt } from "../prompts/answer-evaluation.js";
import type { LlmClient } from "./llm/llm-client.js";
import { MarksService } from "./marks-service.js";

export class EvaluationService {
  constructor(
    private readonly llm: LlmClient,
    private readonly marksService: MarksService
  ) {}

  async evaluateAll(input: {
    questionInventory: QuestionInventory;
    answerInventory: AnswerInventory;
    marksIncrement: number;
    strictBatch?: boolean;
  }): Promise<PerQuestionEvaluation[]> {
    const startedAt = Date.now();
    logger.info({
      question_count: input.questionInventory.questions.length,
      answer_count: input.answerInventory.answers.length,
      marks_increment: input.marksIncrement,
      strict_batch: Boolean(input.strictBatch)
    }, "Answer evaluation batch started");
    if (input.strictBatch) {
      return this.evaluateStrictBatch(input, startedAt);
    }
    const results: PerQuestionEvaluation[] = [];
    for (const question of input.questionInventory.questions) {
      const questionStartedAt = Date.now();
      const answer = input.answerInventory.answers.find((candidate) => candidate.question_id === question.question_id);
      logger.info({
        question_id: question.question_id,
        maximum_marks: question.marks,
        answer_mapped: Boolean(answer)
      }, "Question evaluation started");
      const fallback = buildFallbackEvaluation(question, answer);
      let rawEvaluation: PerQuestionEvaluation | Partial<PerQuestionEvaluation> = fallback;
      try {
        rawEvaluation = await this.llm.invokeJson<PerQuestionEvaluation>(
          [
            { role: "system", content: answerEvaluationPrompt },
            {
              role: "user",
              content: JSON.stringify(
                {
                  questionSnapshot: {
                    code: question.question_number,
                    text: question.question_text,
                    section: question.section_id,
                    maxMarks: question.marks,
                    expectedAnswer: question.expected_answer,
                    modelAnswer: question.expected_answer,
                    rubric: question.marking_scheme,
                    criteria: question.marking_scheme,
                    questionType: question.question_type,
                    answerType: question.question_type
                  },
                  answer: answer
                    ? {
                        ocrText: answer.corrected_transcription || answer.raw_ocr_text,
                        answerCropS3Key: answer.regions[0]?.crop_s3_key,
                        diagramCropS3Keys: answer.diagram_regions.map((region) => region.crop_s3_key).filter(Boolean),
                        bbox: answer.regions[0]?.bbox ?? null,
                        normalized_bbox: answer.regions[0]?.normalized_bbox ?? null,
                        containsDiagram: answer.contains_diagram,
                        ocrConfidence: answer.transcription_confidence,
                        mapping: answer.mapping ?? null
                      }
                    : null,
                  evaluationInstructions: "Evaluate only the supplied question against the supplied student answer. If text or diagram evidence is insufficient, mark requiresReview true.",
                  marksIncrement: input.marksIncrement
                },
                null,
                2
              )
            }
          ],
          fallback,
          { operation: "answer_evaluation", stage: "evaluating_answers", question_id: question.question_id }
        );
      } catch (error) {
        logger.warn({
          question_id: question.question_id,
          err: error
        }, "Question evaluation LLM failed; marking answer for review");
        rawEvaluation = {
          ...fallback,
          recommended_marks: 0,
          status: "requires_review",
          feedback: "AI evaluation failed for this answer. Teacher review is required.",
          improvement_suggestion: "Ask a teacher to review the original crop and OCR text.",
          evaluation_confidence: 0,
          requires_review: true,
          review_reason: error instanceof Error ? error.message : "AI evaluation failed."
        };
      }
      const llmEvaluation = normalizePerQuestionEvaluation(rawEvaluation, fallback);
      const finalized = this.marksService.finalizeQuestionEvaluation(llmEvaluation, question.marks, input.marksIncrement);
      logger.info({
        question_id: question.question_id,
        status: finalized.status,
        awarded_marks: finalized.awarded_marks,
        maximum_marks: finalized.maximum_marks,
        requires_review: finalized.requires_review,
        duration_ms: Date.now() - questionStartedAt
      }, "Question evaluation completed");
      results.push(finalized);
    }
    logger.info({
      evaluation_count: results.length,
      duration_ms: Date.now() - startedAt
    }, "Answer evaluation batch completed");
    return results;
  }

  private async evaluateStrictBatch(input: {
    questionInventory: QuestionInventory;
    answerInventory: AnswerInventory;
    marksIncrement: number;
  }, startedAt: number): Promise<PerQuestionEvaluation[]> {
    if (!this.llm.invokeJsonStrict) {
      throw new Error("Strict LLM JSON invocation is not supported by this provider.");
    }

    const readableAnswerCount = input.answerInventory.answers
      .filter((answer) => String(answer.corrected_transcription || answer.raw_ocr_text || "").trim())
      .length;
    if (readableAnswerCount === 0) {
      throw new Error("No readable student answers were extracted from this answer sheet.");
    }

    const rawEvaluations = await this.llm.invokeJsonStrict<PerQuestionEvaluation[]>(
      [
        { role: "system", content: answerBatchEvaluationPrompt },
        {
          role: "user",
          content: JSON.stringify({
            questions: input.questionInventory.questions.map((question) => ({
              question_id: question.question_id,
              question_number: question.question_number,
              question_text: question.question_text,
              maximum_marks: question.marks,
              expected_answer: question.expected_answer,
              marking_scheme: question.marking_scheme
            })),
            answers: input.answerInventory.answers.map((answer) => ({
              answer_id: answer.answer_id,
              question_id: answer.question_id,
              question_number_written: answer.question_number_written,
              corrected_transcription: answer.corrected_transcription,
              raw_ocr_text: answer.raw_ocr_text,
              region_ids: answer.regions.map((region) => region.answer_region_id),
              contains_diagram: answer.contains_diagram,
              contains_table: answer.contains_table,
              contains_calculation: answer.contains_calculation
            }))
          }, null, 2)
        }
      ],
      { operation: "answer_evaluation", stage: "evaluating_answers" }
    );

    const normalized = normalizeBatchEvaluations(rawEvaluations, input.questionInventory);
    const finalized = normalized.map((evaluation) => {
      const question = input.questionInventory.questions.find((item) => item.question_id === evaluation.question_id);
      if (!question) throw new Error(`AI evaluation returned unknown question_id: ${evaluation.question_id}`);
      return this.marksService.finalizeQuestionEvaluation(evaluation, question.marks, input.marksIncrement);
    });
    logger.info({
      evaluation_count: finalized.length,
      duration_ms: Date.now() - startedAt
    }, "Strict answer evaluation batch completed");
    return finalized;
  }
}

const answerBatchEvaluationPrompt = `
You are evaluating one student's full handwritten answer sheet against reviewed exam questions.

Rules:
1. Evaluate every supplied question exactly once.
2. Use only the supplied reviewed question text, expected answer, marking scheme, and mapped student answer text.
3. Award partial marks where justified, but never exceed maximum_marks.
4. If a mapped answer is missing or blank, return status "unanswered" and recommended_marks 0.
5. Do not invent answer content, evidence, student details, questions, or marks.
6. Cite evidence using supplied answer region IDs when available.
7. Return only a JSON array of evaluation objects with the existing PerQuestionEvaluation shape.
`;

function normalizeBatchEvaluations(
  candidate: unknown,
  questionInventory: QuestionInventory
): PerQuestionEvaluation[] {
  if (!Array.isArray(candidate)) {
    throw new Error("AI evaluation did not return an array.");
  }
  const byQuestionId = new Map(candidate.map((item) => {
    const evaluation = item as Partial<PerQuestionEvaluation>;
    return [String(evaluation.question_id || ""), evaluation];
  }));

  return questionInventory.questions.map((question) => {
    const source = byQuestionId.get(question.question_id);
    if (!source) throw new Error(`AI evaluation missing result for ${question.question_id}.`);
    if (!isEvaluationStatus(source.status)) throw new Error(`AI evaluation returned invalid status for ${question.question_id}.`);
    if (!Number.isFinite(Number(source.recommended_marks))) {
      throw new Error(`AI evaluation missing recommended_marks for ${question.question_id}.`);
    }

    return {
      question_id: question.question_id,
      maximum_marks: numberOr(source.maximum_marks, question.marks),
      recommended_marks: numberOr(source.recommended_marks, 0),
      awarded_marks: numberOr(source.awarded_marks, 0),
      status: source.status,
      answer_summary: requiredString(source.answer_summary, "answer_summary", question.question_id),
      correct_points: Array.isArray(source.correct_points) ? source.correct_points : [],
      missing_points: Array.isArray(source.missing_points) ? source.missing_points.map(String) : [],
      incorrect_points: Array.isArray(source.incorrect_points) ? source.incorrect_points.map(String) : [],
      rubric_breakdown: normalizeRubricBreakdown(source.rubric_breakdown, question.question_id),
      feedback: requiredString(source.feedback, "feedback", question.question_id),
      improvement_suggestion: requiredString(source.improvement_suggestion, "improvement_suggestion", question.question_id),
      evaluation_confidence: numberOr(source.evaluation_confidence, 0),
      requires_review: Boolean(source.requires_review),
      review_reason: source.review_reason === null || source.review_reason === undefined ? null : String(source.review_reason)
    };
  });
}

function requiredString(value: unknown, field: string, questionId: string): string {
  const text = String(value ?? "").trim();
  if (!text && field !== "answer_summary") {
    throw new Error(`AI evaluation missing ${field} for ${questionId}.`);
  }
  return text;
}

function normalizeRubricBreakdown(value: unknown, questionId: string): PerQuestionEvaluation["rubric_breakdown"] {
  if (!Array.isArray(value)) throw new Error(`AI evaluation missing rubric_breakdown for ${questionId}.`);
  return value.map((item, index) => {
    const source = item as Record<string, unknown>;
    return {
      criterion: String(source.criterion || `Criterion ${index + 1}`),
      maximum_marks: numberOr(source.maximum_marks, 0),
      awarded_marks: numberOr(source.awarded_marks, 0),
      reason: String(source.reason || "")
    };
  });
}

function normalizePerQuestionEvaluation(
  candidate: PerQuestionEvaluation | Partial<PerQuestionEvaluation> | null | undefined,
  fallback: PerQuestionEvaluation
): PerQuestionEvaluation {
  const source = candidate && typeof candidate === "object" ? candidate : fallback;
  return {
    ...fallback,
    ...source,
    question_id: source.question_id || fallback.question_id,
    maximum_marks: numberOr(source.maximum_marks, fallback.maximum_marks),
    recommended_marks: numberOr(source.recommended_marks, fallback.recommended_marks),
    awarded_marks: numberOr(source.awarded_marks, fallback.awarded_marks),
    status: isEvaluationStatus(source.status) ? source.status : fallback.status,
    answer_summary: source.answer_summary ?? fallback.answer_summary,
    correct_points: Array.isArray(source.correct_points) ? source.correct_points : fallback.correct_points,
    missing_points: Array.isArray(source.missing_points) ? source.missing_points : fallback.missing_points,
    incorrect_points: Array.isArray(source.incorrect_points) ? source.incorrect_points : fallback.incorrect_points,
    rubric_breakdown: Array.isArray(source.rubric_breakdown) ? source.rubric_breakdown : fallback.rubric_breakdown,
    feedback: source.feedback ?? fallback.feedback,
    improvement_suggestion: source.improvement_suggestion ?? fallback.improvement_suggestion,
    evaluation_confidence: numberOr(source.evaluation_confidence, fallback.evaluation_confidence),
    requires_review: Boolean(source.requires_review ?? fallback.requires_review),
    review_reason: source.review_reason ?? fallback.review_reason
  };
}

function isEvaluationStatus(value: unknown): value is PerQuestionEvaluation["status"] {
  return [
    "correct",
    "partially_correct",
    "incorrect",
    "unanswered",
    "unreadable",
    "requires_review"
  ].includes(String(value));
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildFallbackEvaluation(
  question: QuestionInventory["questions"][number],
  answer: AnswerInventory["answers"][number] | undefined
): PerQuestionEvaluation {
  if (!answer) {
    return {
      question_id: question.question_id,
      maximum_marks: question.marks,
      recommended_marks: 0,
      awarded_marks: 0,
      status: "unanswered",
      answer_summary: "",
      correct_points: [],
      missing_points: ["No mapped answer was detected."],
      incorrect_points: [],
      rubric_breakdown: [{ criterion: "Attempted answer", maximum_marks: question.marks, awarded_marks: 0, reason: "No answer found." }],
      feedback: "No answer was detected for this question.",
      improvement_suggestion: "Review this question and provide a complete answer.",
      evaluation_confidence: 0.9,
      requires_review: false,
      review_reason: null
    };
  }

  const needsReview =
    answer.mapping_confidence < 0.7 ||
    answer.transcription_confidence < 0.7 ||
    question.expected_answer_source === "ai_generated" ||
    question.marking_scheme.length === 0;

  return {
    question_id: question.question_id,
    maximum_marks: question.marks,
    recommended_marks: needsReview ? 0 : Math.min(question.marks, question.marks * 0.5),
    awarded_marks: 0,
    status: needsReview ? "requires_review" : "partially_correct",
    answer_summary: answer.corrected_transcription.slice(0, 300),
    correct_points: [],
    missing_points: question.marking_scheme.map((item) => item.criterion),
    incorrect_points: [],
    rubric_breakdown:
      question.marking_scheme.length > 0
        ? question.marking_scheme.map((item) => ({
            criterion: item.criterion,
            maximum_marks: item.marks,
            awarded_marks: 0,
            reason: "Requires model or teacher grading."
          }))
        : [{ criterion: "Semantic correctness", maximum_marks: question.marks, awarded_marks: 0, reason: "No marking scheme available." }],
    feedback: needsReview ? "This answer needs manual review before final grading." : "The answer was detected and partially evaluated.",
    improvement_suggestion: "Compare your answer with the marking points and add any missing steps or key terms.",
    evaluation_confidence: needsReview ? 0.45 : 0.7,
    requires_review: needsReview,
    review_reason: needsReview ? "Low confidence, missing marking scheme, or AI-generated reference answer." : null
  };
}

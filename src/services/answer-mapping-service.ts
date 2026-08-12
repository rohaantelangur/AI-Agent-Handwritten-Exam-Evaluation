import type { AnswerInventory } from "../schemas/answer.js";
import type { QuestionInventory } from "../schemas/question.js";
import { logger } from "../logger.js";
import { answerMappingPrompt } from "../prompts/answer-mapping.js";
import type { LlmClient } from "./llm/llm-client.js";

export class AnswerMappingService {
  constructor(private readonly llm: LlmClient) {}

  async mapAnswers(
    questionInventory: QuestionInventory,
    answerInventory: AnswerInventory,
    options: { strict?: boolean } = {}
  ): Promise<AnswerInventory> {
    const startedAt = Date.now();
    logger.info({
      question_count: questionInventory.questions.length,
      answer_count: answerInventory.answers.length,
      strict: Boolean(options.strict)
    }, "Answer mapping started");
    const fallback = deterministicMapping(questionInventory, answerInventory);
    const messages = [
      { role: "system" as const, content: answerMappingPrompt },
      { role: "user" as const, content: JSON.stringify({ questionInventory, answerInventory }, null, 2) }
    ];
    const rawMapped = options.strict
      ? await invokeStrict<AnswerInventory>(this.llm, messages, { operation: "answer_mapping", stage: "mapping_answers" })
      : await this.llm.invokeJson<AnswerInventory>(
          messages,
          fallback,
          { operation: "answer_mapping", stage: "mapping_answers" }
        );
    if (options.strict && !Array.isArray((rawMapped as Partial<AnswerInventory>)?.answers)) {
      throw new Error("AI answer mapping did not return an answers array.");
    }
    const mapped = normalizeAnswerInventory(rawMapped, fallback, questionInventory);
    logger.info({
      answer_count: mapped.answers.length,
      unmatched_count: mapped.unmatched_regions.length,
      unanswered_count: mapped.unanswered_question_ids.length,
      duration_ms: Date.now() - startedAt
    }, "Answer mapping completed");
    return mapped;
  }
}

function invokeStrict<T>(
  llm: LlmClient,
  messages: Parameters<LlmClient["invokeJson"]>[0],
  audit: Parameters<LlmClient["invokeJson"]>[2]
): Promise<T> {
  if (!llm.invokeJsonStrict) throw new Error("Strict LLM JSON invocation is not supported by this provider.");
  return llm.invokeJsonStrict<T>(messages, audit);
}

function normalizeAnswerInventory(
  candidate: AnswerInventory | Partial<AnswerInventory> | null | undefined,
  fallback: AnswerInventory,
  questionInventory: QuestionInventory
): AnswerInventory {
  const source = candidate && typeof candidate === "object" ? candidate : fallback;
  const fallbackById = new Map(fallback.answers.map((answer) => [answer.answer_id, answer]));
  const answersSource = Array.isArray(source.answers) ? source.answers : fallback.answers;
  const answers = answersSource.map((answer, index) => {
    const fallbackAnswer = fallbackById.get(answer?.answer_id || "") ?? fallback.answers[index];
    const regions = Array.isArray(answer?.regions)
      ? answer.regions
      : fallbackAnswer?.regions ?? [];
    return {
      ...(fallbackAnswer ?? {}),
      ...answer,
      answer_id: answer?.answer_id || fallbackAnswer?.answer_id || `answer-${index + 1}`,
      question_id: answer?.question_id ?? fallbackAnswer?.question_id ?? null,
      question_number_written: answer?.question_number_written ?? fallbackAnswer?.question_number_written ?? null,
      regions,
      raw_ocr_text: answer?.raw_ocr_text ?? fallbackAnswer?.raw_ocr_text ?? "",
      corrected_transcription: answer?.corrected_transcription ?? fallbackAnswer?.corrected_transcription ?? "",
      contains_diagram: Boolean(answer?.contains_diagram ?? fallbackAnswer?.contains_diagram),
      diagram_regions: Array.isArray(answer?.diagram_regions) ? answer.diagram_regions : fallbackAnswer?.diagram_regions ?? [],
      contains_table: Boolean(answer?.contains_table ?? fallbackAnswer?.contains_table),
      contains_calculation: Boolean(answer?.contains_calculation ?? fallbackAnswer?.contains_calculation),
      crossed_out: Boolean(answer?.crossed_out ?? fallbackAnswer?.crossed_out),
      mapping_confidence: numberOr(answer?.mapping_confidence, fallbackAnswer?.mapping_confidence ?? 0),
      transcription_confidence: numberOr(answer?.transcription_confidence, fallbackAnswer?.transcription_confidence ?? 0),
      requires_review: Boolean(answer?.requires_review ?? fallbackAnswer?.requires_review)
    };
  });
  const answeredQuestionIds = new Set(answers.map((answer) => answer.question_id).filter(Boolean));
  const unmatchedRegions = Array.isArray(source.unmatched_regions)
    ? source.unmatched_regions
    : answers.flatMap((answer) => (answer.question_id ? [] : answer.regions));
  const unansweredQuestionIds = Array.isArray(source.unanswered_question_ids)
    ? source.unanswered_question_ids
    : questionInventory.questions
        .map((question) => question.question_id)
        .filter((questionId) => !answeredQuestionIds.has(questionId));

  return {
    student: source.student && typeof source.student === "object" ? source.student : fallback.student,
    answers,
    unmatched_regions: unmatchedRegions,
    unanswered_question_ids: unansweredQuestionIds
  };
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deterministicMapping(questionInventory: QuestionInventory, answerInventory: AnswerInventory): AnswerInventory {
  const byNumber = new Map(questionInventory.questions.map((question) => [question.question_number, question.question_id]));
  const answers = answerInventory.answers.map((answer) => {
    const written = answer.question_number_written?.match(/\d+/)?.[0] ?? null;
    const questionId = written ? byNumber.get(written) ?? answer.question_id : answer.question_id;
    const regions = answer.regions.map((region) => ({
      ...region,
      detected_question_id: questionId,
      mapping_confidence: questionId ? Math.max(region.mapping_confidence, 0.78) : region.mapping_confidence,
      requires_review: region.requires_review || !questionId
    }));
    return {
      ...answer,
      question_id: questionId,
      regions,
      mapping_confidence: questionId ? Math.max(answer.mapping_confidence, 0.78) : answer.mapping_confidence,
      requires_review: answer.requires_review || !questionId
    };
  });
  const answeredQuestionIds = new Set(answers.map((answer) => answer.question_id).filter(Boolean));
  return {
    ...answerInventory,
    answers,
    unmatched_regions: answers.flatMap((answer) => (answer.question_id ? [] : answer.regions)),
    unanswered_question_ids: questionInventory.questions
      .map((question) => question.question_id)
      .filter((questionId) => !answeredQuestionIds.has(questionId))
  };
}

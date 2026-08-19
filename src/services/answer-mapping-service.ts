import type { AnswerInventory, AnswerMappingMetadata } from "../schemas/answer.js";
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
    const unresolvedCount = fallback.answers.filter((answer) => !answer.question_id).length;
    if (unresolvedCount === 0 && !options.strict) {
      logger.info({
        answer_count: fallback.answers.length,
        unmatched_count: fallback.unmatched_regions.length,
        unanswered_count: fallback.unanswered_question_ids.length,
        llm_fallback_used: false,
        duration_ms: Date.now() - startedAt
      }, "Answer mapping completed");
      return fallback;
    }
    let rawMapped: AnswerInventory | Partial<AnswerInventory> = fallback;
    try {
      const messages = [
        { role: "system" as const, content: answerMappingPrompt },
        {
          role: "user" as const,
          content: JSON.stringify({
            instruction: "Map only unclear answers. Keep existing deterministic/fuzzy mappings unless clearly wrong.",
            questionInventory,
            answerInventory: fallback
          }, null, 2)
        }
      ];
      rawMapped = options.strict
        ? await invokeStrict<AnswerInventory>(this.llm, messages, { operation: "answer_mapping", stage: "mapping_answers" })
        : await this.llm.invokeJson<AnswerInventory>(
            messages,
            fallback,
            { operation: "answer_mapping", stage: "mapping_answers" }
          );
      if (options.strict && !Array.isArray((rawMapped as Partial<AnswerInventory>)?.answers)) {
        throw new Error("AI answer mapping did not return an answers array.");
      }
    } catch (error) {
      if (options.strict) throw error;
      logger.warn({ err: error, unresolved_count: unresolvedCount }, "Answer mapping LLM fallback failed; unresolved answers require review");
    }
    const mapped = normalizeAnswerInventory(rawMapped, fallback, questionInventory);
    logger.info({
      answer_count: mapped.answers.length,
      unmatched_count: mapped.unmatched_regions.length,
      unanswered_count: mapped.unanswered_question_ids.length,
      llm_fallback_used: unresolvedCount > 0 || Boolean(options.strict),
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
      requires_review: Boolean(answer?.requires_review ?? fallbackAnswer?.requires_review),
      mapping: normalizeMappingMetadata(answer?.mapping, fallbackAnswer?.mapping, answer?.question_id ?? fallbackAnswer?.question_id ?? null)
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
  const byNormalized = new Map<string, QuestionInventory["questions"][number]>();
  const byDigits = new Map<string, QuestionInventory["questions"][number][]>();
  for (const question of questionInventory.questions) {
    for (const key of [question.question_number, question.question_id, question.sub_question_number].filter(Boolean)) {
      byNormalized.set(normalizeQuestionCode(String(key)), question);
    }
    const digits = firstDigits(question.question_number || question.question_id);
    if (digits) byDigits.set(digits, [...(byDigits.get(digits) ?? []), question]);
  }
  const answers = answerInventory.answers.map((answer) => {
    const detectedText = answer.question_number_written ?? answer.regions[0]?.question_reference_text ?? null;
    const normalized = detectedText ? normalizeQuestionCode(detectedText) : "";
    const exact = normalized ? byNormalized.get(normalized) : undefined;
    const digits = detectedText ? firstDigits(detectedText) : null;
    const fuzzyCandidates = digits ? byDigits.get(digits) ?? [] : [];
    const fuzzy = !exact && fuzzyCandidates.length === 1 ? fuzzyCandidates[0] : undefined;
    const question = exact ?? fuzzy;
    const questionId = question?.question_id ?? answer.question_id;
    const mappingSource: AnswerMappingMetadata["source"] = exact ? "deterministic" : fuzzy ? "fuzzy" : questionId ? "deterministic" : "manual_required";
    const mappingConfidence = exact ? 0.96 : fuzzy ? 0.84 : questionId ? Math.max(answer.mapping_confidence, 0.78) : 0;
    const mappingReason = exact
      ? "Question label matched reviewed question code exactly after normalization."
      : fuzzy
        ? "Question label matched a single reviewed question after removing OCR punctuation/noise."
        : questionId
          ? "Existing question mapping was retained."
          : "Question label could not be mapped deterministically.";
    const regions = answer.regions.map((region) => ({
      ...region,
      detected_question_id: questionId,
      mapping_confidence: questionId ? Math.max(region.mapping_confidence, mappingConfidence) : region.mapping_confidence,
      requires_review: region.requires_review || !questionId
    }));
    return {
      ...answer,
      question_id: questionId,
      regions,
      diagram_regions: answer.diagram_regions.map((region) => ({ ...region, detected_question_id: questionId })),
      mapping_confidence: questionId ? Math.max(answer.mapping_confidence, mappingConfidence) : answer.mapping_confidence,
      requires_review: answer.requires_review || !questionId,
      mapping: {
        source: mappingSource,
        confidence: questionId ? mappingConfidence : 0,
        detectedQuestionText: detectedText,
        mappedQuestionCode: question?.question_number ?? questionId ?? null,
        reason: mappingReason
      }
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

function normalizeMappingMetadata(
  candidate: AnswerInventory["answers"][number]["mapping"] | undefined,
  fallback: AnswerInventory["answers"][number]["mapping"] | undefined,
  questionId: string | null
): AnswerInventory["answers"][number]["mapping"] {
  const source = candidate ?? fallback;
  if (!source) {
    return {
      source: questionId ? "llm" : "manual_required",
      confidence: questionId ? 0.65 : 0,
      detectedQuestionText: null,
      mappedQuestionCode: questionId,
      reason: questionId ? "Question was mapped by LLM fallback." : "Question mapping requires manual review."
    };
  }
  const validSource = ["deterministic", "fuzzy", "llm", "manual_required"].includes(source.source)
    ? source.source
    : questionId ? "llm" : "manual_required";
  return {
    source: validSource,
    confidence: numberOr(source.confidence, questionId ? 0.65 : 0),
    detectedQuestionText: source.detectedQuestionText ?? null,
    mappedQuestionCode: source.mappedQuestionCode ?? questionId,
    reason: source.reason || (validSource === "manual_required" ? "Question mapping requires manual review." : "Question was mapped.")
  };
}

function normalizeQuestionCode(value: string): string {
  const upper = value.toUpperCase().replace(/\s+/g, "");
  const match = upper.match(/(?:Q|QUESTION)?\.?0*(\d+)(?:[\.\-]?\(?([A-ZIVX]+)\)?)?/);
  if (!match) return upper.replace(/[^A-Z0-9]/g, "");
  return `Q${Number(match[1])}${match[2] ? `.${match[2].replace(/[^A-Z0-9]/g, "")}` : ""}`;
}

function firstDigits(value: string): string | null {
  const match = value.match(/\d+/);
  if (!match) return null;
  return String(Number(match[0]));
}

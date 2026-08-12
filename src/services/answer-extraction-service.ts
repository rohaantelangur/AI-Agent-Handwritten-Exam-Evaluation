import type { PageImage } from "../schemas/common.js";
import type { AnswerInventory, AnswerRegion, StudentDetails } from "../schemas/answer.js";
import type { LayoutElement, QuestionInventory } from "../schemas/question.js";
import { logger } from "../logger.js";
import { makeBBox, normalizeBBox } from "../utils/bbox.js";

export class AnswerExtractionService {
  buildAnswerInventory(input: {
    answerElements: LayoutElement[];
    pages: PageImage[];
    student: StudentDetails;
    questionInventory: QuestionInventory;
  }): AnswerInventory {
    const startedAt = Date.now();
    logger.info({
      answer_element_count: input.answerElements.length,
      page_count: input.pages.length,
      question_count: input.questionInventory.questions.length
    }, "Answer inventory extraction started");
    const regions = this.detectRegions(input.answerElements, input.pages);
    const answers = regions.map((region) => ({
      answer_id: region.detected_question_id ? `answer-${region.detected_question_id}` : `answer-${region.answer_region_id}`,
      question_id: region.detected_question_id,
      question_number_written: region.question_reference_text,
      regions: [region],
      raw_ocr_text: region.raw_ocr_text,
      corrected_transcription: region.corrected_transcription,
      contains_diagram: /diagram|figure|graph/i.test(region.raw_ocr_text),
      diagram_regions: [],
      contains_table: /\|.+\||\t/.test(region.raw_ocr_text),
      contains_calculation: /[=+\-*/]|\btherefore\b/i.test(region.raw_ocr_text),
      crossed_out: /crossed\s*out|\bwrong\b/i.test(region.raw_ocr_text),
      mapping_confidence: region.mapping_confidence,
      transcription_confidence: region.transcription_confidence,
      requires_review: region.requires_review
    }));

    const answeredQuestionIds = new Set(answers.map((answer) => answer.question_id).filter(Boolean));
    const inventory = {
      student: input.student,
      answers,
      unmatched_regions: regions.filter((region) => !region.detected_question_id),
      unanswered_question_ids: input.questionInventory.questions
        .map((question) => question.question_id)
        .filter((questionId) => !answeredQuestionIds.has(questionId))
    };
    logger.info({
      region_count: regions.length,
      answer_count: inventory.answers.length,
      unmatched_count: inventory.unmatched_regions.length,
      unanswered_count: inventory.unanswered_question_ids.length,
      duration_ms: Date.now() - startedAt
    }, "Answer inventory extraction completed");
    return inventory;
  }

  private detectRegions(elements: LayoutElement[], pages: PageImage[]): AnswerRegion[] {
    const textElements = elements.filter((element) => element.text.trim());
    if (textElements.length > 0) {
      return textElements.map((element, index) => {
        const reference = extractQuestionReference(element.text);
        return {
          answer_region_id: `region-${String(index + 1).padStart(3, "0")}`,
          page_number: element.page_number,
          bbox: element.bbox,
          normalized_bbox: element.normalized_bbox,
          crop_s3_key: element.s3_key,
          raw_ocr_text: element.text,
          corrected_transcription: element.text,
          question_reference_text: reference,
          detected_question_id: reference ? `q${reference.replace(/\W+/g, "_").replace(/_$/, "")}` : null,
          mapping_confidence: reference ? 0.82 : 0.4,
          transcription_confidence: element.confidence,
          continued_on_next_page: false,
          continuation_region_ids: [],
          crossed_out: /crossed\s*out|\bwrong\b/i.test(element.text),
          blank: element.text.trim().length === 0,
          requires_review: !reference || element.confidence < 0.7
        };
      });
    }

    return pages.map((page, index) => {
      const marginX = Math.round(page.width * 0.04);
      const marginY = Math.round(page.height * 0.04);
      const bbox = makeBBox(marginX, marginY, page.width - marginX, page.height - marginY);
      return {
        answer_region_id: `region-${String(index + 1).padStart(3, "0")}`,
        page_number: page.page_number,
        bbox,
        normalized_bbox: normalizeBBox(bbox, page.width, page.height),
        raw_ocr_text: "",
        corrected_transcription: "",
        question_reference_text: null,
        detected_question_id: null,
        mapping_confidence: 0,
        transcription_confidence: 0,
        continued_on_next_page: false,
        continuation_region_ids: [],
        crossed_out: false,
        blank: false,
        requires_review: true
      };
    });
  }
}

function extractQuestionReference(text: string): string | null {
  return text.match(/^\s*(?:Q\.?\s*)?(\d+(?:\s*[\(\.]?\s*[a-zivx]+\)?)?)/i)?.[1]?.replace(/\s+/g, "") ?? null;
}

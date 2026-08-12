import { describe, expect, it } from "vitest";
import { AnswerMappingService } from "../src/services/answer-mapping-service.js";
import type { LlmClient, LlmMessage } from "../src/services/llm/llm-client.js";

class PartialJsonLlm implements LlmClient {
  async invokeJson<T>(_messages: LlmMessage[], _fallback: T): Promise<T> {
    return {
      answers: [
        {
          answer_id: "answer-q1",
          question_id: "q1",
          question_number_written: "1",
          regions: [],
          raw_ocr_text: "1 answer",
          corrected_transcription: "1 answer",
          mapping_confidence: 0.91,
          transcription_confidence: 0.8,
          requires_review: false
        }
      ]
    } as T;
  }
}

describe("AnswerMappingService", () => {
  it("normalizes partial LLM JSON instead of crashing on missing arrays", async () => {
    const service = new AnswerMappingService(new PartialJsonLlm());
    const mapped = await service.mapAnswers(
      {
        document: {
          title: null,
          board: null,
          class: null,
          subject: null,
          language: null,
          duration_minutes: null,
          maximum_marks: 1,
          instructions: []
        },
        sections: [],
        questions: [
          {
            question_id: "q1",
            section_id: null,
            question_number: "1",
            sub_question_number: null,
            question_type: "short",
            page_start: 1,
            page_end: 1,
            question_text: "Question 1",
            marks: 1,
            options: [],
            elements: [],
            visuals: [],
            expected_answer: null,
            marking_scheme: [],
            extraction_confidence: 1,
            requires_review: false
          }
        ]
      },
      {
        student: {},
        answers: [
          {
            answer_id: "answer-q1",
            question_id: "q1",
            question_number_written: "1",
            regions: [],
            raw_ocr_text: "1 answer",
            corrected_transcription: "1 answer",
            contains_diagram: false,
            diagram_regions: [],
            contains_table: false,
            contains_calculation: false,
            crossed_out: false,
            mapping_confidence: 0.8,
            transcription_confidence: 0.8,
            requires_review: false
          }
        ],
        unmatched_regions: [],
        unanswered_question_ids: []
      }
    );

    expect(mapped.answers).toHaveLength(1);
    expect(mapped.unmatched_regions).toEqual([]);
    expect(mapped.unanswered_question_ids).toEqual([]);
  });
});

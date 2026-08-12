import { describe, expect, it } from "vitest";
import { evaluationRequestSchema, type ReviewedExam } from "../src/schemas/request.js";
import type { AnswerInventory } from "../src/schemas/answer.js";
import type { PerQuestionEvaluation } from "../src/schemas/evaluation.js";
import { AnswerMappingService } from "../src/services/answer-mapping-service.js";
import { EvaluationService } from "../src/services/evaluation-service.js";
import type { LlmClient, LlmMessage } from "../src/services/llm/llm-client.js";
import { MarksService } from "../src/services/marks-service.js";
import { ReviewedQuestionService } from "../src/services/reviewed-question-service.js";

const reviewedExam: ReviewedExam = {
  title: "Midterm",
  subject: "Science",
  className: "10",
  totalMarks: 10,
  instructions: "Answer all questions.",
  questions: [
    {
      code: "Q1",
      text: "Define photosynthesis.",
      section: "A",
      order: 1,
      questionType: "Short",
      answerType: "Text",
      optional: false,
      maxMarks: 5,
      rubric: "Award marks for sunlight, chlorophyll, carbon dioxide, water, and glucose/oxygen.",
      modelAnswer: "Photosynthesis is the process by which plants use sunlight, chlorophyll, carbon dioxide, and water to make glucose and oxygen.",
      expectedAnswer: "Plants prepare food using sunlight, chlorophyll, carbon dioxide, and water.",
      requiredKeywords: ["sunlight", "chlorophyll"],
      acceptedMethods: [],
      criteria: [{ title: "Core definition", description: "Correct process", maxMarks: 5, requiredEvidence: "Mentions inputs and output", sequence: 1 }]
    },
    {
      code: "Q2",
      text: "Name one product of photosynthesis.",
      section: "A",
      order: 2,
      questionType: "Short",
      answerType: "Text",
      optional: false,
      maxMarks: 5,
      rubric: "Award marks for glucose or oxygen.",
      modelAnswer: "Glucose or oxygen.",
      expectedAnswer: "Glucose or oxygen.",
      requiredKeywords: [],
      acceptedMethods: [],
      criteria: []
    }
  ]
};

const answerInventory: AnswerInventory = {
  student: {},
  answers: [{
    answer_id: "answer-Q1",
    question_id: "Q1",
    question_number_written: "1",
    regions: [{
      answer_region_id: "region-001",
      page_number: 1,
      bbox: null,
      normalized_bbox: null,
      raw_ocr_text: "Photosynthesis uses sunlight and chlorophyll.",
      corrected_transcription: "Photosynthesis uses sunlight and chlorophyll.",
      question_reference_text: "1",
      detected_question_id: "Q1",
      mapping_confidence: 0.9,
      transcription_confidence: 0.9,
      continued_on_next_page: false,
      continuation_region_ids: [],
      crossed_out: false,
      blank: false,
      requires_review: false
    }],
    raw_ocr_text: "Photosynthesis uses sunlight and chlorophyll.",
    corrected_transcription: "Photosynthesis uses sunlight and chlorophyll.",
    contains_diagram: false,
    diagram_regions: [],
    contains_table: false,
    contains_calculation: false,
    crossed_out: false,
    mapping_confidence: 0.9,
    transcription_confidence: 0.9,
    requires_review: false
  }],
  unmatched_regions: [],
  unanswered_question_ids: ["Q2"]
};

class ReviewedFlowLlm implements LlmClient {
  strictCalls = 0;

  async invokeJson<T>(_messages: LlmMessage[], fallback: T): Promise<T> {
    return fallback;
  }

  async invokeJsonStrict<T>(_messages: LlmMessage[], audit?: { operation: string }): Promise<T> {
    this.strictCalls += 1;
    if (audit?.operation === "answer_mapping") return answerInventory as T;
    return [
      evaluation("Q1", 3, "partially_correct"),
      evaluation("Q2", 0, "unanswered")
    ] as T;
  }
}

class FailingStrictLlm implements LlmClient {
  async invokeJson<T>(_messages: LlmMessage[], fallback: T): Promise<T> {
    return fallback;
  }

  async invokeJsonStrict<T>(): Promise<T> {
    throw new Error("provider rate limit");
  }
}

describe("reviewed question evaluation flow", () => {
  it("accepts reviewed exam payloads without a question paper URL", () => {
    const parsed = evaluationRequestSchema.safeParse({
      tenant_id: "tenant",
      exam_id: "exam",
      evaluation_job_id: "job",
      answer_sheet_url: "https://example.com/answer.pdf",
      reviewed_exam: reviewedExam,
      options: { evaluation_mode: "balanced" }
    });

    expect(parsed.success).toBe(true);
  });

  it("still requires either reviewed questions or a legacy question paper URL", () => {
    const parsed = evaluationRequestSchema.safeParse({
      tenant_id: "tenant",
      exam_id: "exam",
      evaluation_job_id: "job",
      answer_sheet_url: "https://example.com/answer.pdf"
    });

    expect(parsed.success).toBe(false);
  });

  it("builds question inventory from reviewed DB questions", () => {
    const inventory = new ReviewedQuestionService().buildQuestionInventory(reviewedExam);

    expect(inventory.questions.map((question) => question.question_id)).toEqual(["Q1", "Q2"]);
    expect(inventory.questions[0].expected_answer_source).toBe("provided_answer_key");
    expect(inventory.questions[0].marking_scheme).toEqual([{ criterion: "Core definition: Correct process: Mentions inputs and output", marks: 5 }]);
  });

  it("uses two strict LLM calls for reviewed student evaluation", async () => {
    const llm = new ReviewedFlowLlm();
    const questionInventory = new ReviewedQuestionService().buildQuestionInventory(reviewedExam);
    const mapped = await new AnswerMappingService(llm).mapAnswers(questionInventory, answerInventory, { strict: true });
    const results = await new EvaluationService(llm, new MarksService()).evaluateAll({
      questionInventory,
      answerInventory: mapped,
      marksIncrement: 0.5,
      strictBatch: true
    });

    expect(llm.strictCalls).toBe(2);
    expect(results).toHaveLength(2);
    expect(results[0].awarded_marks).toBe(3);
  });

  it("fails provider errors instead of returning dummy evaluations", async () => {
    const questionInventory = new ReviewedQuestionService().buildQuestionInventory(reviewedExam);
    await expect(new EvaluationService(new FailingStrictLlm(), new MarksService()).evaluateAll({
      questionInventory,
      answerInventory,
      marksIncrement: 0.5,
      strictBatch: true
    })).rejects.toThrow("provider rate limit");
  });
});

function evaluation(questionId: string, marks: number, status: PerQuestionEvaluation["status"]): PerQuestionEvaluation {
  return {
    question_id: questionId,
    maximum_marks: 5,
    recommended_marks: marks,
    awarded_marks: 0,
    status,
    answer_summary: questionId === "Q1" ? "Student mentioned sunlight and chlorophyll." : "",
    correct_points: questionId === "Q1" ? [{ point: "Mentions sunlight", evidence_region_ids: ["region-001"] }] : [],
    missing_points: questionId === "Q1" ? ["Missing carbon dioxide and water"] : ["No mapped answer"],
    incorrect_points: [],
    rubric_breakdown: [{ criterion: "Core", maximum_marks: 5, awarded_marks: marks, reason: "Partial evidence" }],
    feedback: status === "unanswered" ? "No answer was provided." : "Partially correct.",
    improvement_suggestion: "Add all key points from the marking scheme.",
    evaluation_confidence: 0.8,
    requires_review: false,
    review_reason: null
  };
}

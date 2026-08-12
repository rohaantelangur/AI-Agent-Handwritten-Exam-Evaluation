import type { QuestionInventory } from "../schemas/question.js";
import { logger } from "../logger.js";
import { questionInventoryPrompt } from "../prompts/question-inventory.js";
import type { LlmClient } from "./llm/llm-client.js";
import type { LayoutElement } from "../schemas/question.js";

export class QuestionExtractionService {
  constructor(private readonly llm: LlmClient) {}

  async buildQuestionInventory(elements: LayoutElement[]): Promise<QuestionInventory> {
    const startedAt = Date.now();
    logger.info({ element_count: elements.length }, "Question inventory extraction started");
    const fallback = deterministicQuestionInventory(elements);
    const rawInventory = await this.llm.invokeJson<QuestionInventory>(
      [
        { role: "system", content: questionInventoryPrompt },
        { role: "user", content: JSON.stringify({ elements }, null, 2) }
      ],
      fallback,
      { operation: "question_inventory", stage: "building_question_inventory" }
    );
    const inventory = normalizeQuestionInventory(rawInventory, fallback);
    logger.info({
      element_count: elements.length,
      question_count: inventory.questions.length,
      duration_ms: Date.now() - startedAt
    }, "Question inventory extraction completed");
    return inventory;
  }
}

function normalizeQuestionInventory(
  candidate: QuestionInventory | Partial<QuestionInventory> | null | undefined,
  fallback: QuestionInventory
): QuestionInventory {
  const source = candidate && typeof candidate === "object" ? candidate : fallback;
  const document = source.document && typeof source.document === "object" ? source.document : fallback.document;
  const sections = Array.isArray(source.sections) ? source.sections : fallback.sections;
  const questionsSource = Array.isArray(source.questions) ? source.questions : fallback.questions;
  const fallbackById = new Map(fallback.questions.map((question) => [question.question_id, question]));
  const questions = questionsSource.map((question, index) => {
    const fallbackQuestion = fallbackById.get(question?.question_id || "") ?? fallback.questions[index];
    const maximumMarks = numberOr(question?.marks, fallbackQuestion?.marks ?? 1);
    return {
      ...(fallbackQuestion ?? {}),
      ...question,
      question_id: question?.question_id || fallbackQuestion?.question_id || `q${index + 1}`,
      section_id: question?.section_id ?? fallbackQuestion?.section_id ?? null,
      question_number: question?.question_number || fallbackQuestion?.question_number || String(index + 1),
      sub_question_number: question?.sub_question_number ?? fallbackQuestion?.sub_question_number ?? null,
      question_type: question?.question_type || fallbackQuestion?.question_type || "unknown",
      page_start: numberOr(question?.page_start, fallbackQuestion?.page_start ?? 1),
      page_end: numberOr(question?.page_end, fallbackQuestion?.page_end ?? fallbackQuestion?.page_start ?? 1),
      question_text: question?.question_text || fallbackQuestion?.question_text || "",
      marks: maximumMarks,
      options: Array.isArray(question?.options) ? question.options : fallbackQuestion?.options ?? [],
      elements: Array.isArray(question?.elements) ? question.elements : fallbackQuestion?.elements ?? [],
      visuals: Array.isArray(question?.visuals) ? question.visuals : fallbackQuestion?.visuals ?? [],
      expected_answer: question?.expected_answer ?? fallbackQuestion?.expected_answer ?? null,
      expected_answer_source: question?.expected_answer_source ?? fallbackQuestion?.expected_answer_source ?? "unavailable",
      marking_scheme: Array.isArray(question?.marking_scheme) ? question.marking_scheme : fallbackQuestion?.marking_scheme ?? [],
      extraction_confidence: numberOr(question?.extraction_confidence, fallbackQuestion?.extraction_confidence ?? 0),
      requires_review: Boolean(question?.requires_review ?? fallbackQuestion?.requires_review)
    };
  });
  return {
    document: {
      ...fallback.document,
      ...document,
      instructions: Array.isArray(document.instructions) ? document.instructions : fallback.document.instructions
    },
    sections,
    questions
  };
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deterministicQuestionInventory(elements: LayoutElement[]): QuestionInventory {
  const sections = [{ section_id: "A", title: "Section A", instructions: [], marks: null }];
  const questions: QuestionInventory["questions"] = [];
  let questionIndex = 0;

  for (const element of elements) {
    const matches = [...element.text.matchAll(/(?:^|\n)\s*(?:Q\.?\s*)?(\d+)(?:[\).:-]|\s)\s+([\s\S]*?)(?=(?:\n\s*(?:Q\.?\s*)?\d+(?:[\).:-]|\s)\s+)|$)/gi)];
    for (const match of matches) {
      questionIndex += 1;
      const questionNumber = match[1];
      const questionText = match[2]?.trim() || element.text.trim();
      const marksMatch = questionText.match(/\[(\d+(?:\.\d+)?)\s*(?:marks?|m)\]/i) ?? questionText.match(/(\d+(?:\.\d+)?)\s*marks?/i);
      const marks = marksMatch ? Number(marksMatch[1]) : 1;
      questions.push({
        question_id: `q${questionNumber}`,
        section_id: "A",
        question_number: questionNumber,
        sub_question_number: null,
        question_type: detectQuestionType(questionText),
        page_start: element.page_number,
        page_end: element.page_number,
        question_text: questionText,
        marks,
        options: extractOptions(questionText),
        elements: [element],
        visuals: element.type === "figure" || element.type === "table" || element.type === "formula"
          ? [{
              element_id: element.element_id,
              type: element.type,
              description: "",
              page_number: element.page_number,
              bbox: element.bbox,
              normalized_bbox: element.normalized_bbox,
              s3_key: element.s3_key
            }]
          : [],
        expected_answer: null,
        expected_answer_source: "unavailable",
        marking_scheme: [],
        extraction_confidence: 0.72,
        requires_review: marksMatch === null
      });
    }
  }

  if (questions.length === 0 && elements.length > 0) {
    const text = elements.map((element) => element.text).join("\n\n").trim();
    questions.push({
      question_id: "q1",
      section_id: "A",
      question_number: "1",
      sub_question_number: null,
      question_type: "unknown",
      page_start: elements[0].page_number,
      page_end: elements.at(-1)?.page_number ?? elements[0].page_number,
      question_text: text,
      marks: 1,
      options: [],
      elements,
      visuals: [],
      expected_answer: null,
      expected_answer_source: "unavailable",
      marking_scheme: [],
      extraction_confidence: 0.45,
      requires_review: true
    });
  }

  return {
    document: {
      title: inferTitle(elements),
      board: null,
      class: inferField(elements, /\bclass\s*[:.-]?\s*([A-Za-z0-9 -]+)/i),
      subject: inferField(elements, /\bsubject\s*[:.-]?\s*([A-Za-z0-9 -]+)/i),
      language: null,
      duration_minutes: null,
      maximum_marks: questions.reduce((sum, question) => sum + question.marks, 0) || null,
      instructions: elements
        .filter((element) => /instruction|attempt|answer all/i.test(element.text))
        .map((element) => element.text)
    },
    sections,
    questions
  };
}

function detectQuestionType(text: string): QuestionInventory["questions"][number]["question_type"] {
  if (extractOptions(text).length >= 2) return "mcq";
  if (/diagram|draw|label/i.test(text)) return "diagram";
  if (/calculate|solve|find/i.test(text)) return "calculation";
  if (text.length > 240) return "long";
  return "short";
}

function extractOptions(text: string): Array<{ option_id: string; text: string }> {
  return [...text.matchAll(/(?:^|\n|\s)([a-dA-D])[\).]\s*([^A-D\n]+)/g)].map((match) => ({
    option_id: match[1].toLowerCase(),
    text: match[2].trim()
  }));
}

function inferTitle(elements: LayoutElement[]): string | null {
  return elements.find((element) => element.type === "title")?.text.split("\n")[0]?.trim() ?? elements[0]?.text.split("\n")[0]?.trim() ?? null;
}

function inferField(elements: LayoutElement[], regex: RegExp): string | null {
  const text = elements.map((element) => element.text).join("\n");
  return text.match(regex)?.[1]?.trim() ?? null;
}

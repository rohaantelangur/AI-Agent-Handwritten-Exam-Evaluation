import type { ReviewedExam } from "../schemas/request.js";
import type { QuestionInventory } from "../schemas/question.js";

export class ReviewedQuestionService {
  buildQuestionInventory(exam: ReviewedExam): QuestionInventory {
    const sections = buildSections(exam);
    const sectionIds = new Set(sections.map((section) => section.section_id));

    return {
      document: {
        title: exam.title || null,
        board: null,
        class: exam.className || null,
        subject: exam.subject || null,
        language: null,
        duration_minutes: null,
        maximum_marks: exam.totalMarks || exam.questions.reduce((sum, question) => sum + question.maxMarks, 0),
        instructions: exam.instructions ? [exam.instructions] : []
      },
      sections,
      questions: exam.questions
        .slice()
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map((question, index) => {
          const sectionId = sectionIdFor(question.section);
          return {
            question_id: question.code,
            section_id: sectionIds.has(sectionId) ? sectionId : null,
            question_number: question.code,
            sub_question_number: null,
            question_type: normalizeQuestionType(question.questionType),
            page_start: 1,
            page_end: 1,
            question_text: question.text,
            marks: question.maxMarks,
            options: [],
            elements: [],
            visuals: [],
            expected_answer: question.expectedAnswer || question.modelAnswer,
            expected_answer_source: "provided_answer_key" as const,
            marking_scheme: buildMarkingScheme(question),
            extraction_confidence: 1,
            requires_review: false
          };
        })
    };
  }
}

function buildSections(exam: ReviewedExam): QuestionInventory["sections"] {
  const byId = new Map<string, QuestionInventory["sections"][number]>();
  exam.questions.forEach((question) => {
    const sectionId = sectionIdFor(question.section);
    if (byId.has(sectionId)) return;
    byId.set(sectionId, {
      section_id: sectionId,
      title: question.section || "General",
      instructions: [],
      marks: null
    });
  });
  return byId.size ? [...byId.values()] : [{ section_id: "General", title: "General", instructions: [], marks: null }];
}

function sectionIdFor(section: string | undefined): string {
  const value = String(section || "").trim();
  return value || "General";
}

function normalizeQuestionType(value: string): QuestionInventory["questions"][number]["question_type"] {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("mcq") || normalized.includes("multiple")) return "mcq";
  if (normalized.includes("diagram")) return "diagram";
  if (normalized.includes("calculation") || normalized.includes("numeric")) return "calculation";
  if (normalized.includes("short")) return "short";
  if (normalized.includes("long") || normalized.includes("descriptive")) return "long";
  return "unknown";
}

function buildMarkingScheme(question: ReviewedExam["questions"][number]): QuestionInventory["questions"][number]["marking_scheme"] {
  const criteria = (question.criteria || [])
    .map((criterion) => ({
      criterion: [criterion.title, criterion.description, criterion.requiredEvidence].filter(Boolean).join(": "),
      marks: Number(criterion.maxMarks) || 0
    }))
    .filter((criterion) => criterion.criterion && criterion.marks > 0);

  if (criteria.length) return criteria;

  return [{
    criterion: question.rubric,
    marks: question.maxMarks
  }];
}

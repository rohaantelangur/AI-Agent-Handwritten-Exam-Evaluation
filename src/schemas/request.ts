import { z } from "zod";

export const evaluationOptionsSchema = z.object({
  dpi: z.number().int().min(72).max(400).optional(),
  generate_report: z.boolean().optional(),
  upload_all_pages: z.boolean().optional(),
  upload_element_crops: z.boolean().optional(),
  evaluation_mode: z.enum(["fast", "balanced", "strict"]).optional(),
  marks_increment: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]).optional()
});

export const reviewedExamQuestionSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1),
  text: z.string().optional().default(""),
  section: z.string().optional().default(""),
  order: z.number().optional(),
  questionType: z.string().optional().default("Descriptive"),
  answerType: z.string().optional().default("Text"),
  optional: z.boolean().optional().default(false),
  maxMarks: z.number().positive(),
  rubric: z.string().min(1),
  modelAnswer: z.string().optional().default(""),
  expectedAnswer: z.string().optional().default(""),
  requiredKeywords: z.array(z.string()).optional().default([]),
  acceptedMethods: z.array(z.string()).optional().default([]),
  criteria: z.array(z.object({
    title: z.string().optional().default(""),
    description: z.string().optional().default(""),
    maxMarks: z.number().nonnegative().optional().default(0),
    requiredEvidence: z.string().optional().default(""),
    sequence: z.number().optional()
  })).optional().default([])
}).refine((question) => String(question.modelAnswer || question.expectedAnswer).trim().length > 0, {
  message: "modelAnswer or expectedAnswer is required"
});

export const reviewedExamSchema = z.object({
  title: z.string().optional().default(""),
  subject: z.string().optional().default(""),
  className: z.string().optional().default(""),
  totalMarks: z.number().nonnegative().optional().default(0),
  instructions: z.string().optional().default(""),
  questions: z.array(reviewedExamQuestionSchema).min(1)
});

export const evaluationRequestSchema = z.object({
  tenant_id: z.string().min(1).max(160),
  exam_id: z.string().min(1).max(160),
  evaluation_job_id: z.string().min(1).max(160),
  question_paper_url: z.string().url().optional(),
  answer_sheet_url: z.string().url(),
  reviewed_exam: reviewedExamSchema.optional(),
  callback_url: z.string().url().optional(),
  log_callback_url: z.string().url().optional(),
  options: evaluationOptionsSchema.default({})
}).refine((request) => request.reviewed_exam || request.question_paper_url, {
  message: "Either reviewed_exam or question_paper_url is required.",
  path: ["reviewed_exam"]
});

export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type EvaluationOptions = z.infer<typeof evaluationOptionsSchema>;
export type ReviewedExam = z.infer<typeof reviewedExamSchema>;

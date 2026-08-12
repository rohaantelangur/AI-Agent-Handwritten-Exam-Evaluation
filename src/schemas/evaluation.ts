import type { S3ObjectRef } from "./common.js";
import type { StudentDetails } from "./answer.js";

export type PerQuestionEvaluation = {
  question_id: string;
  maximum_marks: number;
  recommended_marks: number;
  awarded_marks: number;
  status: "correct" | "partially_correct" | "incorrect" | "unanswered" | "unreadable" | "requires_review";
  answer_summary: string;
  correct_points: Array<{ point: string; evidence_region_ids: string[] }>;
  missing_points: string[];
  incorrect_points: string[];
  rubric_breakdown: Array<{
    criterion: string;
    maximum_marks: number;
    awarded_marks: number;
    reason: string;
  }>;
  feedback: string;
  improvement_suggestion: string;
  evaluation_confidence: number;
  requires_review: boolean;
  review_reason: string | null;
};

export type FinalEvaluation = {
  evaluation_job_id: string;
  tenant_id: string;
  exam_id: string;
  status: "completed" | "completed_with_warnings" | "failed";
  student: StudentDetails;
  exam: {
    title: string | null;
    subject: string | null;
    class: string | null;
    maximum_marks: number;
  };
  summary: {
    maximum_marks: number;
    awarded_marks: number;
    percentage: number;
    attempted_questions: number;
    unanswered_questions: number;
    correct_questions: number;
    partially_correct_questions: number;
    incorrect_questions: number;
    questions_requiring_review: number;
  };
  section_summary: Array<{ section_id: string; maximum_marks: number; awarded_marks: number }>;
  question_evaluations: PerQuestionEvaluation[];
  overall_feedback: {
    strengths: string[];
    areas_for_improvement: string[];
    recommended_topics: string[];
    study_plan: string[];
  };
  assets: {
    question_inventory_s3_key: string;
    answer_inventory_s3_key: string;
    evaluation_json_s3_key: string;
    report_pdf_s3_key: string;
  };
};

export type EvaluationApiResponse = {
  evaluation_job_id: string;
  status: "completed" | "completed_with_warnings" | "failed";
  progress: number;
  question_paper: {
    question_inventory_s3_key: string;
    total_questions: number;
  };
  answer_sheet: {
    answer_inventory_s3_key: string;
    total_detected_answers: number;
  };
  evaluation: {
    maximum_marks: number;
    awarded_marks: number;
    percentage: number;
    questions_requiring_review: number;
    evaluation_json_s3_key: string;
  };
  report: S3ObjectRef | null;
  warnings: Array<{ code: string; question_id?: string; message: string }>;
  student: StudentDetails;
  question_evaluations: PerQuestionEvaluation[];
};

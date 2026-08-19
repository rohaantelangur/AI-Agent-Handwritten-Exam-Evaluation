import type { BBox, NormalizedBBox } from "./common.js";

export type LayoutOcrLine = {
  text: string;
  confidence: number;
  bbox: BBox | null;
  normalized_bbox: NormalizedBBox | null;
};

export type LayoutDiagramRegion = {
  diagram_region_id: string;
  bbox: BBox | null;
  normalized_bbox: NormalizedBBox | null;
  confidence: number;
  crop_s3_key?: string;
};

export type LayoutElement = {
  element_id: string;
  type: "title" | "text" | "table" | "figure" | "formula" | "answer_region" | "unknown";
  page_number: number;
  text: string;
  confidence: number;
  reading_order: number;
  bbox: BBox | null;
  normalized_bbox: NormalizedBBox | null;
  s3_key?: string;
  question_reference_text?: string | null;
  diagram_regions?: LayoutDiagramRegion[];
  ocr_lines?: LayoutOcrLine[];
};

export type QuestionInventory = {
  document: {
    title: string | null;
    board: string | null;
    class: string | null;
    subject: string | null;
    language: string | null;
    duration_minutes: number | null;
    maximum_marks: number | null;
    instructions: string[];
  };
  sections: Array<{
    section_id: string;
    title: string;
    instructions: string[];
    marks: number | null;
  }>;
  questions: Array<{
    question_id: string;
    section_id: string | null;
    question_number: string;
    sub_question_number: string | null;
    question_type: "mcq" | "short" | "long" | "diagram" | "calculation" | "unknown";
    page_start: number;
    page_end: number;
    question_text: string;
    marks: number;
    options: Array<{ option_id: string; text: string }>;
    elements: LayoutElement[];
    visuals: Array<{
      element_id: string;
      type: string;
      description: string;
      page_number: number;
      bbox: BBox | null;
      normalized_bbox: NormalizedBBox | null;
      s3_key?: string;
    }>;
    expected_answer: string | null;
    expected_answer_source?: "provided_answer_key" | "ai_generated" | "unavailable";
    marking_scheme: Array<{ criterion: string; marks: number }>;
    extraction_confidence: number;
    requires_review: boolean;
  }>;
};

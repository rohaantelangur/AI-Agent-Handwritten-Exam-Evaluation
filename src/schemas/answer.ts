import type { BBox, NormalizedBBox } from "./common.js";

export type StudentDetails = Record<
  string,
  {
    value: string | null;
    confidence: number;
    page_number: number | null;
    bbox: BBox | null;
    s3_key?: string;
  }
>;

export type AnswerRegion = {
  answer_region_id: string;
  page_number: number;
  bbox: BBox | null;
  normalized_bbox: NormalizedBBox | null;
  crop_s3_key?: string;
  cropLocalPath?: string;
  raw_ocr_text: string;
  corrected_transcription: string;
  question_reference_text: string | null;
  detected_question_id: string | null;
  mapping_confidence: number;
  transcription_confidence: number;
  continued_on_next_page: boolean;
  continuation_region_ids: string[];
  crossed_out: boolean;
  blank: boolean;
  requires_review: boolean;
};

export type AnswerInventory = {
  student: StudentDetails;
  answers: Array<{
    answer_id: string;
    question_id: string | null;
    question_number_written: string | null;
    regions: AnswerRegion[];
    raw_ocr_text: string;
    corrected_transcription: string;
    contains_diagram: boolean;
    diagram_regions: AnswerRegion[];
    contains_table: boolean;
    contains_calculation: boolean;
    crossed_out: boolean;
    mapping_confidence: number;
    transcription_confidence: number;
    requires_review: boolean;
  }>;
  unmatched_regions: AnswerRegion[];
  unanswered_question_ids: string[];
};

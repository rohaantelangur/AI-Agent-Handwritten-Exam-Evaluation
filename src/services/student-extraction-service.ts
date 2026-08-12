import type { StudentDetails } from "../schemas/answer.js";
import type { LayoutElement } from "../schemas/question.js";
import { logger } from "../logger.js";

const studentFields = {
  student_name: /\b(?:student\s*)?name\s*[:.-]\s*([A-Za-z .'-]+)/i,
  roll_number: /\broll\s*(?:no|number)?\s*[:.-]\s*([A-Za-z0-9/-]+)/i,
  seat_number: /\bseat\s*(?:no|number)?\s*[:.-]\s*([A-Za-z0-9/-]+)/i,
  registration_number: /\bregistration\s*(?:no|number)?\s*[:.-]\s*([A-Za-z0-9/-]+)/i,
  student_id: /\bstudent\s*id\s*[:.-]\s*([A-Za-z0-9/-]+)/i,
  class: /\bclass\s*[:.-]\s*([A-Za-z0-9 -]+)/i,
  section: /\bsection\s*[:.-]\s*([A-Za-z0-9 -]+)/i,
  subject: /\bsubject\s*[:.-]\s*([A-Za-z0-9 -]+)/i,
  exam_name: /\bexam\s*(?:name)?\s*[:.-]\s*([A-Za-z0-9 -]+)/i,
  exam_date: /\bdate\s*[:.-]\s*([A-Za-z0-9, /-]+)/i,
  school_or_institute: /\b(?:school|institute)\s*[:.-]\s*([A-Za-z0-9 .'-]+)/i
};

export class StudentExtractionService {
  extract(elements: LayoutElement[]): StudentDetails {
    const startedAt = Date.now();
    logger.info({ element_count: elements.length }, "Student detail extraction started");
    const firstPages = elements.filter((element) => element.page_number <= 2);
    const details: StudentDetails = {};
    for (const [field, regex] of Object.entries(studentFields)) {
      const evidence = firstPages.find((element) => regex.test(element.text));
      const value = evidence?.text.match(regex)?.[1]?.trim() ?? null;
      details[field] = {
        value,
        confidence: value ? 0.78 : 0,
        page_number: evidence?.page_number ?? null,
        bbox: evidence?.bbox ?? null,
        s3_key: evidence?.s3_key
      };
    }
    logger.info({
      field_count: Object.keys(details).length,
      populated_field_count: Object.values(details).filter((detail) => detail.value).length,
      duration_ms: Date.now() - startedAt
    }, "Student detail extraction completed");
    return details;
  }
}

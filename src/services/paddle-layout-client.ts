import type { BBox, NormalizedBBox, PageImage } from "../schemas/common.js";
import type { LayoutElement } from "../schemas/question.js";

export type PaddleStudentField = {
  value: string | null;
  confidence: number;
  bbox: BBox | null;
  normalized_bbox: NormalizedBBox | null;
};

export type PaddleLayoutResponse = {
  student_fields: Record<string, PaddleStudentField>;
  pages: Array<{
    page_number: number;
    width: number;
    height: number;
    elements: LayoutElement[];
  }>;
};

export class PaddleLayoutClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number
  ) {}

  async extract(input: {
    documentKind: "answer-sheet" | "question-paper";
    pages: PageImage[];
    detectStudentFields: boolean;
    detectAnswerRegions: boolean;
    detectDiagrams: boolean;
  }): Promise<PaddleLayoutResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/v1/layout/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          document_kind: input.documentKind,
          pages: input.pages.map((page) => ({
            page_number: page.page_number,
            local_path: page.localPath,
            width: page.width,
            height: page.height,
            dpi: page.dpi
          })),
          options: {
            detect_student_fields: input.detectStudentFields,
            detect_answer_regions: input.detectAnswerRegions,
            detect_diagrams: input.detectDiagrams
          }
        })
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Paddle layout service failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
      }
      return await response.json() as PaddleLayoutResponse;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(`Paddle layout request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

import { join } from "node:path";
import type { PageImage } from "../schemas/common.js";
import type { LayoutElement } from "../schemas/question.js";
import { logger } from "../logger.js";
import { makeBBox, normalizeBBox } from "../utils/bbox.js";
import { ImageService } from "./image-service.js";
import { PdfService } from "./pdf-service.js";
import { StorageService } from "./s3-service.js";

export class LayoutService {
  constructor(
    private readonly pdfService: PdfService,
    private readonly imageService: ImageService,
    private readonly storage: StorageService
  ) {}

  async extractDocumentLayout(input: {
    pdfPath: string;
    pages: PageImage[];
    documentKind: "question-paper" | "answer-sheet";
    cropDir: string;
    s3Base: { tenantId: string; examId: string; evaluationJobId: string };
    uploadElementCrops: boolean;
  }): Promise<LayoutElement[]> {
    const startedAt = Date.now();
    logger.info({
      document_kind: input.documentKind,
      page_count: input.pages.length,
      upload_element_crops: input.uploadElementCrops
    }, "Document layout extraction started");
    const elements: LayoutElement[] = [];
    for (const page of input.pages) {
      const pageStartedAt = Date.now();
      const text = await this.pdfService.extractPageText(input.pdfPath, page.page_number);
      const blocks = splitTextIntoBlocks(text);
      logger.info({
        document_kind: input.documentKind,
        page_number: page.page_number,
        block_count: blocks.length,
        text_chars: text.length
      }, "Document layout page text split");
      let order = 0;
      for (const block of blocks) {
        order += 1;
        const pageBandHeight = Math.max(80, Math.floor(page.height / Math.max(blocks.length, 1)));
        const y1 = Math.min(page.height - 1, (order - 1) * pageBandHeight);
        const y2 = Math.min(page.height, order * pageBandHeight);
        const bbox = makeBBox(0, y1, page.width, y2);
        const type = classifyBlock(block);
        const element: LayoutElement = {
          element_id: `${input.documentKind === "question-paper" ? "qp" : "as"}-page-${String(page.page_number).padStart(3, "0")}-element-${String(order).padStart(4, "0")}`,
          type,
          page_number: page.page_number,
          text: block,
          confidence: 0.82,
          reading_order: order,
          bbox,
          normalized_bbox: normalizeBBox(bbox, page.width, page.height)
        };
        if (input.uploadElementCrops) {
          const cropPath = join(input.cropDir, `page-${String(page.page_number).padStart(3, "0")}`, `${element.element_id}-${type}.png`);
          await this.imageService.crop(page.localPath, bbox, cropPath);
          const key = this.storage.keyFor({
            ...input.s3Base,
            relativePath: `${input.documentKind}/elements/page-${String(page.page_number).padStart(3, "0")}/${element.element_id}-${type}.png`
          });
          element.s3_key = (await this.storage.uploadFile(cropPath, key, "image/png")).key;
        }
        elements.push(element);
      }
      logger.info({
        document_kind: input.documentKind,
        page_number: page.page_number,
        element_count: blocks.length,
        duration_ms: Date.now() - pageStartedAt
      }, "Document layout page completed");
    }
    logger.info({
      document_kind: input.documentKind,
      element_count: elements.length,
      duration_ms: Date.now() - startedAt
    }, "Document layout extraction completed");
    return elements;
  }
}

function splitTextIntoBlocks(text: string): string[] {
  const normalized = text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+\n/g, "\n").trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

function classifyBlock(text: string): LayoutElement["type"] {
  if (/section\s+[a-z]/i.test(text)) return "title";
  if (/\|.+\||\t/.test(text)) return "table";
  if (/figure|diagram|graph|map/i.test(text)) return "figure";
  if (/[∑√π=]|formula/i.test(text)) return "formula";
  return "text";
}

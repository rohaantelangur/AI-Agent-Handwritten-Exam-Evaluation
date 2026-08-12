import { mkdir, readFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { logger } from "../logger.js";
import type { PageImage } from "../schemas/common.js";
import { runProcess } from "../utils/process.js";

export type PdfMetadata = {
  pageCount: number;
  magicBytesValid: boolean;
};

export class PdfService {
  constructor(
    private readonly maxPages: number,
    private readonly popplerBinPath?: string
  ) {}

  async validatePdf(path: string): Promise<PdfMetadata> {
    const startedAt = Date.now();
    logger.info({ path }, "PDF validation started");
    const header = await readFile(path, { encoding: null });
    const magicBytesValid = header.subarray(0, 5).toString("utf8") === "%PDF-";
    if (!magicBytesValid) {
      throw new Error("Invalid PDF magic bytes");
    }
    const document = await PDFDocument.load(header, { ignoreEncryption: true });
    const pageCount = document.getPageCount();
    if (pageCount < 1) throw new Error("PDF has no pages");
    if (pageCount > this.maxPages) throw new Error("PDF exceeds maximum page count");
    const result = { pageCount, magicBytesValid };
    logger.info({ path, pageCount, duration_ms: Date.now() - startedAt }, "PDF validation completed");
    return result;
  }

  async renderPages(pdfPath: string, outputDir: string, prefix: string, dpi: number): Promise<PageImage[]> {
    const startedAt = Date.now();
    logger.info({ pdfPath, outputDir, prefix, dpi }, "PDF render started");
    await mkdir(outputDir, { recursive: true });
    await this.runPoppler("pdftoppm", ["-png", "-r", String(dpi), pdfPath, join(outputDir, prefix)], 180_000);
    const files = (await readdir(outputDir))
      .filter((file) => file.startsWith(prefix) && file.endsWith(".png"))
      .sort((a, b) => pageNumberFromPopplerName(a) - pageNumberFromPopplerName(b));

    const pages: PageImage[] = [];
    for (const [index, file] of files.entries()) {
      const pageNumber = index + 1;
      const stablePath = join(outputDir, `page-${String(pageNumber).padStart(3, "0")}.png`);
      const currentPath = join(outputDir, file);
      if (currentPath !== stablePath) {
        await rename(currentPath, stablePath);
      }
      const metadata = await sharp(stablePath).metadata();
      if (!metadata.width || !metadata.height) {
        throw new Error(`Unable to detect rendered page dimensions for page ${pageNumber}`);
      }
      pages.push({
        page_number: pageNumber,
        width: metadata.width,
        height: metadata.height,
        dpi,
        localPath: stablePath
      });
    }
    if (pages.length === 0) {
      throw new Error("PDF rendering produced no page images");
    }
    logger.info({ pdfPath, outputDir, prefix, dpi, page_count: pages.length, duration_ms: Date.now() - startedAt }, "PDF render completed");
    return pages;
  }

  async extractPageText(pdfPath: string, pageNumber: number): Promise<string> {
    const startedAt = Date.now();
    const { stdout } = await this.runPoppler("pdftotext", [
      "-layout",
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      pdfPath,
      "-"
    ]);
    const text = stdout.trim();
    logger.info({ pdfPath, page_number: pageNumber, chars: text.length, duration_ms: Date.now() - startedAt }, "PDF page text extracted");
    return text;
  }

  private async runPoppler(command: "pdftoppm" | "pdftotext", args: string[], timeoutMs = 120_000) {
    const executable = popplerExecutable(command, this.popplerBinPath);
    try {
      return await runProcess(executable, args, { timeoutMs });
    } catch (error) {
      if (isMissingExecutableError(error)) {
        throw new Error(
          [
            `Poppler executable "${command}" was not found.`,
            "Install Poppler and make its bin folder available on PATH, or set POPPLER_BIN_PATH to that folder.",
            "Windows example: POPPLER_BIN_PATH=C:\\poppler\\Library\\bin",
            "Docker image users already get Poppler from poppler-utils."
          ].join(" ")
        );
      }
      throw error;
    }
  }
}

function pageNumberFromPopplerName(name: string): number {
  const match = name.match(/-(\d+)\.png$/);
  return match ? Number(match[1]) : 0;
}

function popplerExecutable(command: string, popplerBinPath?: string): string {
  const executable = process.platform === "win32" ? `${command}.exe` : command;
  return popplerBinPath ? join(popplerBinPath, executable) : executable;
}

function isMissingExecutableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

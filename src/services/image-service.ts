import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import { logger } from "../logger.js";
import type { BBox } from "../schemas/common.js";

export class ImageService {
  async crop(inputPath: string, bbox: BBox, outputPath: string): Promise<void> {
    const startedAt = Date.now();
    logger.info({ inputPath, outputPath, bbox }, "Image crop started");
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(inputPath)
      .extract({
        left: bbox.x1,
        top: bbox.y1,
        width: bbox.width,
        height: bbox.height
      })
      .png({ compressionLevel: 9 })
      .toFile(outputPath);
    logger.info({ outputPath, width: bbox.width, height: bbox.height, duration_ms: Date.now() - startedAt }, "Image crop completed");
  }

  async compressPng(inputPath: string, outputPath: string): Promise<void> {
    const startedAt = Date.now();
    logger.info({ inputPath, outputPath }, "PNG compression started");
    await mkdir(dirname(outputPath), { recursive: true });
    await sharp(inputPath).png({ compressionLevel: 9 }).toFile(outputPath);
    logger.info({ outputPath, duration_ms: Date.now() - startedAt }, "PNG compression completed");
  }
}

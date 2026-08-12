import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fetch } from "undici";
import { logger } from "../logger.js";
import { sha256File } from "../utils/hashing.js";

export type DownloadedFile = {
  url: string;
  path: string;
  bytes: number;
  sha256: string;
  contentType: string | null;
};

export class DownloadService {
  constructor(private readonly maxBytes: number) {}

  async downloadPdf(url: string, destinationPath: string): Promise<DownloadedFile> {
    const startedAt = Date.now();
    logger.info({ destinationPath }, "PDF download started");
    await mkdir(dirname(destinationPath), { recursive: true });
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/pdf,*/*" },
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download PDF: ${response.status}`);
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > this.maxBytes) {
      throw new Error("PDF exceeds maximum allowed size");
    }

    let bytes = 0;
    const limiter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        bytes += chunk.byteLength;
        if (bytes > this.maxBytes) {
          callback(new Error("PDF exceeds maximum allowed size"));
          return;
        }
        callback(null, chunk);
      }
    });

    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(destinationPath));
    const fileStat = await stat(destinationPath);
    const result = {
      url,
      path: destinationPath,
      bytes: fileStat.size,
      sha256: await sha256File(destinationPath),
      contentType: response.headers.get("content-type")
    };
    logger.info({
      destinationPath,
      bytes: result.bytes,
      contentType: result.contentType,
      duration_ms: Date.now() - startedAt
    }, "PDF download completed");
    return result;
  }
}

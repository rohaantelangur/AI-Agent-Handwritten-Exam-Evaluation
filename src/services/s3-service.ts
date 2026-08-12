import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "../config.js";
import { logger } from "../logger.js";
import type { S3ObjectRef } from "../schemas/common.js";

export class StorageService {
  private readonly client: S3Client | null;

  constructor(private readonly config: AppConfig) {
    this.client =
      config.storageProvider === "s3"
        ? new S3Client({
            region: config.awsRegion,
            endpoint: config.s3Endpoint,
            forcePathStyle: config.s3ForcePathStyle
          })
        : null;
  }

  keyFor(input: {
    tenantId: string;
    examId: string;
    evaluationJobId: string;
    relativePath: string;
  }): string {
    const safeRelativePath = input.relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
    return `tenants/${input.tenantId}/exams/${input.examId}/evaluations/${input.evaluationJobId}/${safeRelativePath}`;
  }

  async uploadFile(localPath: string, key: string, contentType: string): Promise<S3ObjectRef> {
    const startedAt = Date.now();
    logger.info({ storage_provider: this.config.storageProvider, key, contentType }, "Storage upload started");
    if (this.client) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.s3Bucket,
          Key: key,
          Body: await import("node:fs").then((fs) => fs.createReadStream(localPath)),
          ContentType: contentType
        })
      );
    } else {
      const destination = join(this.config.workDir, "local-s3", key);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(localPath, destination);
    }
    logger.info({
      storage_provider: this.config.storageProvider,
      bucket: this.config.s3Bucket,
      key,
      contentType,
      duration_ms: Date.now() - startedAt
    }, "Storage upload completed");
    return { bucket: this.config.s3Bucket, key };
  }

  async uploadJson(value: unknown, key: string): Promise<S3ObjectRef> {
    const safeKey = key.replaceAll("\\", "/").replace(/^\/+/, "");
    const tmpPath = join(this.config.workDir, "tmp-json", safeKey);
    await mkdir(dirname(tmpPath), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(value, null, 2), "utf8");
    return this.uploadFile(tmpPath, key, "application/json");
  }

  async temporaryUrl(key: string, expiresSeconds = 900): Promise<string> {
    logger.info({ storage_provider: this.config.storageProvider, key, expiresSeconds }, "Temporary URL requested");
    if (!this.client) {
      return `local://${join(this.config.workDir, "local-s3", key).replaceAll("\\", "/")}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.s3Bucket, Key: key }),
      { expiresIn: expiresSeconds }
    );
  }
}

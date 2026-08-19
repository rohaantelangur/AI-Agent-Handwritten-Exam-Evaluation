import { z } from "zod";

const booleanFromEnv = z
  .string()
  .optional()
  .transform((value) => value === "true");

const configSchema = z.object({
  nodeEnv: z.string().default("development"),
  host: z.string().default("localhost"),
  port: z.coerce.number().int().positive().default(8081),
  internalApiKey: z.string().min(1).default("change-me"),
  llmProvider: z.enum(["mock", "openai", "gemini", "ollama"]).default("mock"),
  openAiApiKey: z.string().optional(),
  openAiModel: z.string().default("gpt-4.1-mini"),
  geminiApiKey: z.string().optional(),
  geminiModel: z.string().default("gemini-3.6-flash"),
  ollamaBaseUrl: z.string().url().default("http://localhost:11434"),
  ollamaModel: z.string().default("qwen2.5vl:3b"),
  ollamaRequestTimeoutMs: z.coerce.number().int().positive().default(180_000),
  ocrLayoutProvider: z.enum(["poppler", "paddle"]).default("poppler"),
  paddleLayoutServiceUrl: z.string().url().default("http://localhost:8091"),
  paddleLayoutTimeoutMs: z.coerce.number().int().positive().default(180_000),
  awsRegion: z.string().default("ap-south-1"),
  s3Bucket: z.string().default("private-exam-evaluation"),
  s3Endpoint: z.string().optional(),
  s3ForcePathStyle: booleanFromEnv.default("false"),
  storageProvider: z.enum(["local", "s3"]).default("local"),
  maxPdfBytes: z.coerce.number().int().positive().default(52_428_800),
  maxPdfPages: z.coerce.number().int().positive().default(80),
  defaultDpi: z.coerce.number().int().positive().default(200),
  marksIncrement: z.coerce.number().positive().default(0.5),
  allowHttpInputs: booleanFromEnv.default("false"),
  popplerBinPath: z.string().optional(),
  workDir: z.string().default("./work")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  return configSchema.parse({
    nodeEnv: process.env.NODE_ENV,
    host: process.env.HOST,
    port: process.env.PORT,
    internalApiKey: process.env.INTERNAL_API_KEY,
    llmProvider: process.env.LLM_PROVIDER,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL,
    geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
    ollamaModel: process.env.OLLAMA_MODEL,
    ollamaRequestTimeoutMs: process.env.OLLAMA_REQUEST_TIMEOUT_MS,
    ocrLayoutProvider: process.env.OCR_LAYOUT_PROVIDER,
    paddleLayoutServiceUrl: process.env.PADDLE_LAYOUT_SERVICE_URL,
    paddleLayoutTimeoutMs: process.env.PADDLE_LAYOUT_TIMEOUT_MS,
    awsRegion: process.env.AWS_REGION,
    s3Bucket: process.env.S3_BUCKET,
    s3Endpoint: process.env.S3_ENDPOINT || undefined,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE,
    storageProvider: process.env.STORAGE_PROVIDER,
    maxPdfBytes: process.env.MAX_PDF_BYTES,
    maxPdfPages: process.env.MAX_PDF_PAGES,
    defaultDpi: process.env.DEFAULT_DPI,
    marksIncrement: process.env.MARKS_INCREMENT,
    allowHttpInputs: process.env.ALLOW_HTTP_INPUTS,
    popplerBinPath: process.env.POPPLER_BIN_PATH || process.env.POPPLER_PATH || undefined,
    workDir: process.env.WORK_DIR
  });
}

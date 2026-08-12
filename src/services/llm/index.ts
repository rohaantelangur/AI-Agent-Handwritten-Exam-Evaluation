import type { AppConfig } from "../../config.js";
import { logger } from "../../logger.js";
import type { LlmClient } from "./llm-client.js";
import { GeminiLlmClient } from "./gemini-llm-client.js";
import { MockLlmClient } from "./mock-llm-client.js";
import { OpenAiLlmClient } from "./openai-llm-client.js";

export function createLlmClient(config: AppConfig): LlmClient {
  logger.info({ provider: config.llmProvider }, "Creating LLM client");
  if (config.llmProvider === "openai") {
    if (!config.openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
    }
    return new OpenAiLlmClient(config.openAiApiKey, config.openAiModel);
  }
  if (config.llmProvider === "gemini") {
    if (!config.geminiApiKey) {
      throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is required when LLM_PROVIDER=gemini");
    }
    return new GeminiLlmClient(config.geminiApiKey, config.geminiModel);
  }
  return new MockLlmClient();
}

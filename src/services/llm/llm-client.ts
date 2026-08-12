import type { LlmInvokeAuditMetadata } from "./llm-audit-context.js";

export type LlmMessage = {
  role: "system" | "user";
  content: string;
};

export interface LlmClient {
  invokeJson<T>(messages: LlmMessage[], fallback: T, audit?: LlmInvokeAuditMetadata): Promise<T>;
  invokeJsonStrict?<T>(messages: LlmMessage[], audit?: LlmInvokeAuditMetadata): Promise<T>;
}

export function parseJsonObject<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(stripCodeFence(text)) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonObjectStrict<T>(text: string): T {
  const candidate = extractJsonCandidate(stripCodeFence(text));
  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    throw new Error(`LLM returned malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractJsonCandidate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart && (objectStart === -1 || arrayStart < objectStart)) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }
  if (objectStart >= 0 && objectEnd > objectStart) return trimmed.slice(objectStart, objectEnd + 1);
  return trimmed;
}

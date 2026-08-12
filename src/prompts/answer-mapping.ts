export const answerMappingPrompt = `
You are given a question inventory and deterministic answer-sheet regions.
Map every answer region to the correct question.

Rules:
1. Match by written question number first.
2. Use semantic matching only when numbering is unclear.
3. Preserve answer-region IDs and coordinates exactly.
4. Use null question_id for unmatched regions.
5. Detect unanswered questions.
6. Return JSON only.
`;

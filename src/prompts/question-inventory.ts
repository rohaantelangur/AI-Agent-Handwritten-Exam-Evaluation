export const questionInventoryPrompt = `
You are given deterministic PDF text/layout results from an examination question paper.
Create a complete question inventory.

Rules:
1. Preserve question numbers, sub-question labels, MCQ options, marks, section names, instructions, and order.
2. Copy coordinates exactly when present.
3. Never estimate or invent coordinates.
4. If coordinates are null, keep them null.
5. Fix only obvious OCR spacing errors.
6. Mark uncertain fields with lower confidence and requires_review=true.
7. Return JSON only.
`;

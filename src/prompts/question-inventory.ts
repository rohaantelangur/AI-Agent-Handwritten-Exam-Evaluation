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
7. Include a complete marking_scheme/rubric for every question; never leave rubric empty.
8. If the paper includes a rubric, preserve all criteria and marks. If it does not, generate a fair teacher rubric from the question and marks.
9. Rubric criteria must cover all valid answer paths, including alternate solution methods, partial-credit steps, formulas, units, diagrams, reasoning, and final answer where applicable.
10. If marks are known, rubric marks must add up exactly to the question marks.
11. Return JSON only.
`;

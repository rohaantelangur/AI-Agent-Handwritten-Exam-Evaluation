# Node.js Integration Example

```ts
export async function requestEvaluationAgent(input: {
  tenant_id: string;
  exam_id: string;
  evaluation_job_id: string;
  question_paper_url: string;
  answer_sheet_url: string;
}) {
  const response = await fetch(`${process.env.EVALUATION_AGENT_URL}/api/v1/evaluations/process`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.EVALUATION_AGENT_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...input,
      options: {
        dpi: 200,
        generate_report: true,
        upload_all_pages: true,
        upload_element_crops: true,
        marks_increment: 0.5,
        evaluation_mode: "balanced"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Evaluation agent failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}
```

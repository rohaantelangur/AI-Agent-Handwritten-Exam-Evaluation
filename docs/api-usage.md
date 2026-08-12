# API Usage

```bash
curl -X POST http://localhost:8080/api/v1/evaluations/process \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "tenant-1001",
    "exam_id": "exam-5001",
    "evaluation_job_id": "evaluation-9001",
    "question_paper_url": "https://signed-url/question-paper.pdf",
    "answer_sheet_url": "https://signed-url/answer-sheet.pdf",
    "options": {
      "dpi": 200,
      "generate_report": true,
      "upload_all_pages": true,
      "upload_element_crops": true,
      "marks_increment": 0.5,
      "evaluation_mode": "balanced"
    }
  }'
```

Progress callbacks are optional. Add `callback_url` to the request. Callback failures are logged but do not fail the job.

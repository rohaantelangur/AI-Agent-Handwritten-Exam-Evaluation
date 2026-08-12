# AI Agent Handwritten Exam Evaluation

Node.js, LangChain, and LangGraph service for evaluating handwritten answer sheets against a question paper.

The API accepts signed PDF URLs, processes documents through deterministic services, uses LLMs only for structure/mapping/evaluation reasoning, stores evidence assets in S3, and returns evaluation JSON plus an optional PDF report.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Endpoint:

```http
POST /api/v1/evaluations/process
Authorization: Bearer change-me
Content-Type: application/json
```

```json
{
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
}
```

## Local PDF Rendering

This service renders PDFs with Poppler. On Windows, install Poppler and set `POPPLER_BIN_PATH` to the folder that contains `pdftoppm.exe` and `pdftotext.exe`.

Example:

```bash
POPPLER_BIN_PATH=C:\poppler\Library\bin
```

If you run the Docker image, Poppler is already installed through `poppler-utils`.

## Production Notes

- Install Poppler (`pdftoppm`, `pdftotext`, `pdfinfo`) for deterministic PDF rendering and text extraction.
- Keep the S3 bucket private. Persist S3 keys, not presigned URLs.
- Set `LLM_PROVIDER=openai` and `OPENAI_API_KEY` for OpenAI-backed live LLM evaluation.
- Set `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and optionally `GEMINI_MODEL` for Gemini-backed live LLM evaluation.
- Use `LLM_PROVIDER=mock` for local development and tests.
- The LLM never creates bounding boxes, file hashes, page dimensions, S3 keys, final totals, or crops.

## Scripts

```bash
npm run build
npm test
npm run dev
```

## Architecture

```text
Fastify API
  -> LangGraph workflow
    -> validate request and URLs
    -> stream PDFs to disk
    -> validate PDF magic/page count/hash
    -> render pages with Poppler
    -> extract layout and crops
    -> upload pages/crops/JSON/PDF to S3
    -> build question inventory with LLM
    -> extract student details and answer regions
    -> map answers to questions with LLM
    -> evaluate answers with LLM
    -> clamp and total marks in code
    -> generate evidence-linked report
```

See [docs/api-usage.md](docs/api-usage.md) and [docs/node-integration-example.md](docs/node-integration-example.md).

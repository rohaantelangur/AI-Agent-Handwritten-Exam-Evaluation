# AI Agent Handwritten Exam Evaluation

Node.js, LangChain, and LangGraph service for evaluating handwritten answer sheets against a question paper.

The API accepts signed PDF URLs, renders pages locally, calls a Python PaddleOCR/OpenCV layout service for answer and diagram coordinates, stores evidence assets in S3/local storage, and returns evaluation JSON plus an optional PDF report.

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

For the full two-service OCR pipeline:

```bash
docker compose up -d --force-recreate
```

`handwritten-exam-evaluation-agent` calls `paddle-ocr-service` at `http://paddle-ocr-service:8091`. If you use local Ollama from Docker Desktop on Windows, keep `OLLAMA_BASE_URL=http://host.docker.internal:11434`.

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
- Set `LLM_PROVIDER=ollama`, `OLLAMA_MODEL=qwen2.5vl:3b`, and optionally `OLLAMA_BASE_URL` for local Ollama-backed live LLM evaluation.
- Set `OCR_LAYOUT_PROVIDER=paddle` and `PADDLE_LAYOUT_SERVICE_URL=http://paddle-ocr-service:8091` when running the Docker Compose OCR service.
- Use `LLM_PROVIDER=mock` for local development and tests.
- The LLM never creates bounding boxes, file hashes, page dimensions, S3 keys, final totals, or crops. PaddleOCR/OpenCV creates coordinates; Node creates/uploads crops.

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
    -> call PaddleOCR/OpenCV layout service for answer and diagram coordinates
    -> crop answer/diagram evidence with sharp
    -> upload pages/crops/JSON/PDF to S3
    -> build reviewed question inventory
    -> extract student details and answer regions
    -> map answers deterministically/fuzzy, using LLM only for unclear labels
    -> evaluate mapped answers one by one with LLM
    -> clamp and total marks in code
    -> generate evidence-linked report and callback payload for backend persistence
```

See [docs/api-usage.md](docs/api-usage.md) and [docs/node-integration-example.md](docs/node-integration-example.md).

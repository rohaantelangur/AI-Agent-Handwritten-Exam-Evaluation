from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    from paddleocr import PaddleOCR
except Exception:  # pragma: no cover - lets the API start in stripped local test environments
    PaddleOCR = None  # type: ignore[assignment]


app = FastAPI(title="Paddle Layout Service", version="1.0.0")


class PageInput(BaseModel):
    page_number: int
    local_path: str
    width: int
    height: int
    dpi: int | None = None


class ExtractOptions(BaseModel):
    detect_student_fields: bool = True
    detect_answer_regions: bool = True
    detect_diagrams: bool = True


class ExtractRequest(BaseModel):
    document_kind: Literal["answer-sheet", "question-paper"] = "answer-sheet"
    pages: list[PageInput] = Field(default_factory=list)
    options: ExtractOptions = Field(default_factory=ExtractOptions)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "paddle-ocr-service", "paddleocr_available": PaddleOCR is not None}


@app.post("/api/v1/layout/extract")
def extract_layout(request: ExtractRequest) -> dict[str, Any]:
    if not request.pages:
        raise HTTPException(status_code=422, detail="pages must contain at least one rendered page")

    all_student_fields: dict[str, Any] = {}
    response_pages: list[dict[str, Any]] = []
    for page in request.pages:
        path = Path(page.local_path)
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Rendered page was not found: {page.local_path}")

        image = cv2.imread(str(path))
        if image is None:
            raise HTTPException(status_code=422, detail=f"Rendered page is not a readable image: {page.local_path}")

        height, width = image.shape[:2]
        page_width = page.width or width
        page_height = page.height or height
        lines = run_ocr(str(path), page_width, page_height)

        if request.options.detect_student_fields and page.page_number <= 2:
            all_student_fields.update(detect_student_fields(lines, page_width, page_height))

        elements = detect_answer_regions(
            image=image,
            page=page,
            page_width=page_width,
            page_height=page_height,
            lines=lines,
            detect_diagrams=request.options.detect_diagrams,
        ) if request.options.detect_answer_regions else []

        response_pages.append({
            "page_number": page.page_number,
            "width": page_width,
            "height": page_height,
            "elements": elements,
        })

    return {"student_fields": all_student_fields, "pages": response_pages}


@lru_cache(maxsize=1)
def get_ocr() -> Any:
    if PaddleOCR is None:
        return None
    return PaddleOCR(use_angle_cls=True, lang="en", show_log=False)


def run_ocr(path: str, page_width: int, page_height: int) -> list[dict[str, Any]]:
    ocr = get_ocr()
    if ocr is None:
        return []
    try:
        result = ocr.ocr(path, cls=True)
    except Exception:
        return []

    raw_lines: list[Any] = []
    if result and isinstance(result, list):
        if len(result) == 1 and isinstance(result[0], list):
            raw_lines = result[0]
        else:
            raw_lines = result

    lines: list[dict[str, Any]] = []
    for item in raw_lines:
        parsed = parse_ocr_item(item)
        if not parsed:
            continue
        box, text, confidence = parsed
        bbox = bbox_from_points(box)
        if bbox is None:
            continue
        lines.append({
            "text": text,
            "confidence": confidence,
            "bbox": bbox,
            "normalized_bbox": normalize_bbox(bbox, page_width, page_height),
        })
    return sorted(lines, key=lambda line: (line["bbox"]["y1"], line["bbox"]["x1"]))


def parse_ocr_item(item: Any) -> tuple[list[list[float]], str, float] | None:
    try:
        box = item[0]
        text_conf = item[1]
        text = str(text_conf[0]).strip()
        confidence = float(text_conf[1])
        if not text:
            return None
        return box, text, confidence
    except Exception:
        return None


def detect_student_fields(lines: list[dict[str, Any]], width: int, height: int) -> dict[str, Any]:
    top_lines = [line for line in lines if line["bbox"]["y1"] <= height * 0.2]
    top_text = " ".join(line["text"] for line in top_lines)
    fields: dict[str, Any] = {}

    roll_match = re.search(r"roll\s*(?:no|number)?\.?\s*([0-9](?:\s*[0-9]){4,})", top_text, re.I)
    if not roll_match:
        roll_match = re.search(r"\b([0-9](?:\s*[0-9]){4,})\b", top_text, re.I)
    if roll_match:
        value = re.sub(r"\s+", "", roll_match.group(1))
        fields["roll_number"] = field_payload(value, 0.8, union_line_bbox(top_lines, roll_match.group(1)), width, height)

    name_match = re.search(r"(?:candidate'?s|student)\s*name\s*[:.-]?\s*([A-Za-z][A-Za-z .'-]{2,}?)(?:\s+class|\s+subject|\s+invigilator|\s+q\d|\s+section|$)", top_text, re.I)
    if name_match:
        fields["candidate_name"] = field_payload(name_match.group(1).strip(), 0.72, union_line_bbox(top_lines, name_match.group(1)), width, height)

    return fields


def detect_answer_regions(
    image: np.ndarray,
    page: PageInput,
    page_width: int,
    page_height: int,
    lines: list[dict[str, Any]],
    detect_diagrams: bool,
) -> list[dict[str, Any]]:
    labels = [
        line for line in lines
        if line["bbox"]["y1"] > page_height * 0.03 and question_reference(line["text"], require_q_prefix=True)
    ]
    labels = sorted(labels, key=lambda line: (line["bbox"]["y1"], line["bbox"]["x1"]))

    if not labels:
        bbox = make_bbox(round(page_width * 0.03), round(page_height * 0.12), round(page_width * 0.97), round(page_height * 0.98))
        return [answer_element(page, 1, bbox, lines, None, page_width, page_height, image, detect_diagrams, 0.35)]

    elements: list[dict[str, Any]] = []
    order = 0
    for column_labels, column_bbox in label_columns(labels, page_width, page_height):
        for index, label in enumerate(column_labels):
            order += 1
            top = max(column_bbox["y1"], label["bbox"]["y1"] - 12)
            bottom = column_labels[index + 1]["bbox"]["y1"] - 8 if index + 1 < len(column_labels) else column_bbox["y2"]
            if bottom - top < 35:
                continue
            bbox = make_bbox(column_bbox["x1"], top, column_bbox["x2"], bottom)
            elements.append(answer_element(
                page=page,
                index=order,
                bbox=bbox,
                lines=[line for line in lines if bbox_contains(bbox, line["bbox"])],
                reference=question_reference(label["text"], require_q_prefix=True),
                page_width=page_width,
                page_height=page_height,
                image=image,
                detect_diagrams=detect_diagrams,
                confidence=max(0.45, float(label["confidence"])),
            ))
    return elements


def label_columns(
    labels: list[dict[str, Any]],
    page_width: int,
    page_height: int,
) -> list[tuple[list[dict[str, Any]], dict[str, int]]]:
    if page_width / max(page_height, 1) < 1.25:
        return [(labels, make_bbox(0, 0, round(page_width * 0.97), page_height - 12))]

    midpoint = page_width / 2
    left = [line for line in labels if (line["bbox"]["x1"] + line["bbox"]["x2"]) / 2 < midpoint]
    right = [line for line in labels if (line["bbox"]["x1"] + line["bbox"]["x2"]) / 2 >= midpoint]
    if not left or not right:
        return [(labels, make_bbox(0, 0, round(page_width * 0.97), page_height - 12))]

    gutter = round(page_width * 0.5)
    return [
        (sorted(left, key=lambda line: (line["bbox"]["y1"], line["bbox"]["x1"])), make_bbox(0, 0, gutter - 8, page_height - 12)),
        (sorted(right, key=lambda line: (line["bbox"]["y1"], line["bbox"]["x1"])), make_bbox(gutter + 8, 0, round(page_width * 0.99), page_height - 12)),
    ]


def answer_element(
    page: PageInput,
    index: int,
    bbox: dict[str, int],
    lines: list[dict[str, Any]],
    reference: str | None,
    page_width: int,
    page_height: int,
    image: np.ndarray,
    detect_diagrams: bool,
    confidence: float,
) -> dict[str, Any]:
    text = "\n".join(line["text"] for line in lines).strip()
    element_id = f"as-page-{page.page_number:03d}-answer-{index:04d}"
    diagrams = detect_diagram_regions(image, bbox, lines, page_width, page_height, element_id) if detect_diagrams else []
    return {
        "element_id": element_id,
        "type": "answer_region",
        "text": text,
        "confidence": min(1.0, confidence),
        "reading_order": index,
        "bbox": bbox,
        "normalized_bbox": normalize_bbox(bbox, page_width, page_height),
        "question_reference_text": reference,
        "diagram_regions": diagrams,
        "ocr_lines": lines,
        "page_number": page.page_number,
    }


def detect_diagram_regions(
    image: np.ndarray,
    answer_bbox: dict[str, int],
    lines: list[dict[str, Any]],
    page_width: int,
    page_height: int,
    element_id: str,
) -> list[dict[str, Any]]:
    x1, y1, x2, y2 = answer_bbox["x1"], answer_bbox["y1"], answer_bbox["x2"], answer_bbox["y2"]
    roi = image[y1:y2, x1:x2]
    if roi.size == 0:
        return []

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 12)
    mask = remove_form_ruling(binary)
    for line in lines:
        box = line["bbox"]
        cv2.rectangle(
            mask,
            (max(0, box["x1"] - x1 - 4), max(0, box["y1"] - y1 - 4)),
            (min(mask.shape[1], box["x2"] - x1 + 4), min(mask.shape[0], box["y2"] - y1 + 4)),
            0,
            thickness=-1,
        )

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    merged = cv2.dilate(mask, kernel, iterations=2)
    contours, _ = cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    diagrams: list[dict[str, Any]] = []
    roi_area = max(1, roi.shape[0] * roi.shape[1])
    for contour in contours:
        cx, cy, cw, ch = cv2.boundingRect(contour)
        area = cw * ch
        if area < max(1400, roi_area * 0.012) or cw < 45 or ch < 45:
            continue
        if cw > roi.shape[1] * 0.45 and ch < 80:
            continue
        if ch > roi.shape[0] * 0.7 and cw < 80:
            continue
        bbox = make_bbox(x1 + cx, y1 + cy, x1 + cx + cw, y1 + cy + ch)
        diagrams.append({
            "diagram_region_id": f"{element_id}-diagram-{len(diagrams) + 1:02d}",
            "bbox": bbox,
            "normalized_bbox": normalize_bbox(bbox, page_width, page_height),
            "confidence": 0.62,
        })

    return sorted(diagrams, key=lambda item: (item["bbox"]["y1"], item["bbox"]["x1"]))[:4]


def remove_form_ruling(binary: np.ndarray) -> np.ndarray:
    mask = binary.copy()
    contours, _ = cv2.findContours(binary.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    height, width = binary.shape[:2]
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        is_long_horizontal = w > width * 0.55 and h <= 8
        is_long_vertical = h > height * 0.65 and w <= 8
        if is_long_horizontal or is_long_vertical:
            cv2.rectangle(mask, (x, y), (x + w, y + h), 0, thickness=-1)
    return mask


def question_reference(text: str, require_q_prefix: bool = False) -> str | None:
    pattern = r"^\s*Q\s*\.?\s*0*(\d{1,2}(?:\s*[\(\.]\s*[a-zivx]+\)?)?)\b" if require_q_prefix else r"^\s*(?:Q\s*\.?\s*)?0*(\d{1,2}(?:\s*[\(\.]\s*[a-zivx]+\)?)?)\b"
    match = re.match(pattern, text, re.I)
    if not match:
        return None
    value = re.sub(r"\s+", "", match.group(1))
    return f"Q{value}" if not value.upper().startswith("Q") else value.upper()


def field_payload(value: str, confidence: float, bbox: dict[str, int] | None, width: int, height: int) -> dict[str, Any]:
    return {
        "value": value,
        "confidence": confidence,
        "bbox": bbox,
        "normalized_bbox": normalize_bbox(bbox, width, height) if bbox else None,
    }


def union_line_bbox(lines: list[dict[str, Any]], text_hint: str) -> dict[str, int] | None:
    lowered = text_hint.lower().replace(" ", "")
    candidates = [line["bbox"] for line in lines if lowered[:3] in line["text"].lower().replace(" ", "") or any(ch.isdigit() for ch in text_hint)]
    if not candidates:
        candidates = [line["bbox"] for line in lines[:3]]
    if not candidates:
        return None
    return make_bbox(
        min(box["x1"] for box in candidates),
        min(box["y1"] for box in candidates),
        max(box["x2"] for box in candidates),
        max(box["y2"] for box in candidates),
    )


def parse_points(points: list[list[float]]) -> tuple[int, int, int, int] | None:
    if not points:
        return None
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))


def bbox_from_points(points: list[list[float]]) -> dict[str, int] | None:
    parsed = parse_points(points)
    if parsed is None:
        return None
    return make_bbox(*parsed)


def make_bbox(x1: int, y1: int, x2: int, y2: int) -> dict[str, int]:
    x1, y1, x2, y2 = int(x1), int(y1), int(max(x2, x1 + 1)), int(max(y2, y1 + 1))
    return {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "width": x2 - x1, "height": y2 - y1}


def normalize_bbox(bbox: dict[str, int], width: int, height: int) -> dict[str, float]:
    return {
        "left": round(bbox["x1"] / width, 4),
        "top": round(bbox["y1"] / height, 4),
        "width": round(bbox["width"] / width, 4),
        "height": round(bbox["height"] / height, 4),
    }


def bbox_contains(outer: dict[str, int], inner: dict[str, int]) -> bool:
    center_x = (inner["x1"] + inner["x2"]) / 2
    center_y = (inner["y1"] + inner["y2"]) / 2
    return outer["x1"] <= center_x <= outer["x2"] and outer["y1"] <= center_y <= outer["y2"]

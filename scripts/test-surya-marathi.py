#!/usr/bin/env python3
"""Run Surya 2 OCR on the same PDF page or image used by the PaddleOCR test.

Example:
    python scripts/test-surya-marathi.py paddleocr-vl15-output/first-page-original.png
"""

import argparse
import hashlib
import json
import shutil
import time
from importlib.metadata import version
from pathlib import Path

from PIL import Image, ImageDraw
from surya.inference import SuryaInferenceManager
from surya.recognition import RecognitionPredictor


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Original PDF or page image")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("surya-output/gpu-pdf-firstpage"),
        help="Directory for Surya JSON, Markdown, and visual output",
    )
    parser.add_argument(
        "--first-page", action="store_true", help="Render only PDF page 1 at 2x"
    )
    args = parser.parse_args()

    source = args.input.resolve()
    if not source.is_file():
        parser.error(f"Input file does not exist: {source}")
    if args.first_page and source.suffix.lower() != ".pdf":
        parser.error("--first-page requires a PDF")
    if source.suffix.lower() == ".pdf" and not args.first_page:
        parser.error("For this comparison, pass --first-page for PDF input")

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    image_path = output / "first-page-original.png"
    if args.first_page:
        import pypdfium2

        pdf = pypdfium2.PdfDocument(str(source))
        try:
            pdf[0].render(scale=2).to_pil().save(image_path)
        finally:
            pdf.close()
    elif source != image_path:
        shutil.copy2(source, image_path)

    image_hash = hashlib.sha256(image_path.read_bytes()).hexdigest()
    image = Image.open(image_path).convert("RGB")
    started = time.perf_counter()
    manager = SuryaInferenceManager()
    backend = manager.method
    try:
        prediction = RecognitionPredictor(manager)([image])[0]
    finally:
        manager.stop()
    elapsed = time.perf_counter() - started

    result = prediction.model_dump(mode="json")
    (output / "first-page-original_res.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    blocks = result.get("blocks", [])
    markdown = "\n\n".join(
        block["html"].strip()
        for block in blocks
        if not block.get("skipped") and block.get("html", "").strip()
    )
    (output / "first-page-original.md").write_text(markdown + "\n", encoding="utf-8")

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay)
    for index, block in enumerate(blocks, start=1):
        bbox = block.get("bbox")
        if bbox:
            draw.rectangle(bbox, outline="red", width=3)
            draw.text((bbox[0], max(0, bbox[1] - 14)), str(index), fill="red")
    overlay.save(output / "first-page-original_layout.png")

    (output / "run.json").write_text(
        json.dumps(
            {
                "surya_version": version("surya-ocr"),
                "backend": backend,
                "input": str(source),
                "image_sha256": image_hash,
                "pages": 1,
                "blocks": len(blocks),
                "elapsed_seconds": round(elapsed, 2),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Surya {version('surya-ocr')}: {len(blocks)} blocks in {elapsed:.1f}s")
    print(f"Results: {output}")


if __name__ == "__main__":
    main()

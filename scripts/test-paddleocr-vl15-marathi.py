#!/usr/bin/env python3
"""Run the full PaddleOCR-VL 1.5 pipeline on a PDF or image."""

import argparse
import threading
import time
from pathlib import Path

import paddle
from paddleocr import PaddleOCRVL


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="PDF or image to parse")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("paddleocr-vl15-output"),
        help="Directory for Markdown, JSON, and visualization files",
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="auto (requires a GPU), gpu:0, or cpu (slow; explicit opt-in)",
    )
    parser.add_argument(
        "--preprocess",
        action="store_true",
        help="Enable document orientation and unwarping (uses more memory)",
    )
    parser.add_argument(
        "--first-page",
        action="store_true",
        help="Render only the first page of a PDF for a quick comparison",
    )
    args = parser.parse_args()

    source = args.input.resolve()
    if not source.is_file():
        parser.error(f"Input file does not exist: {source}")
    if source.name.endswith("_preprocessed_img.png"):
        parser.error("This is a three-panel OCR diagnostic image; use the original PDF")
    if args.first_page and source.suffix.lower() != ".pdf":
        parser.error("--first-page requires a PDF input")
    if args.device == "auto":
        if not paddle.is_compiled_with_cuda() or paddle.device.cuda.device_count() == 0:
            parser.error("No Paddle GPU is available; pass --device cpu to opt into a slow CPU run")
        args.device = "gpu:0"
    args.output.mkdir(parents=True, exist_ok=True)
    if args.first_page:
        import pypdfium2

        pdf = pypdfium2.PdfDocument(str(source))
        source = args.output / "first-page-original.png"
        try:
            pdf[0].render(scale=2).to_pil().save(source)
        finally:
            pdf.close()
        print(f"Rendered PDF page 1 to {source.resolve()}", flush=True)

    started = time.perf_counter()
    print(f"Using {args.device} for {source}", flush=True)
    pipeline = PaddleOCRVL(
        pipeline_version="v1.5",  # Do not silently use the newer default.
        device=args.device,
        use_doc_orientation_classify=args.preprocess,
        use_doc_unwarping=args.preprocess,
        enable_mkldnn=False,  # Matches the existing Windows CPU test.
    )
    print(f"Model initialization: {time.perf_counter() - started:.1f}s", flush=True)

    processing_started = time.perf_counter()
    finished = threading.Event()

    def report_progress() -> None:
        while not finished.wait(30):
            print(
                f"Still processing ({time.perf_counter() - processing_started:.0f}s elapsed)",
                flush=True,
            )

    threading.Thread(target=report_progress, daemon=True).start()
    page_count = 0
    try:
        for result in pipeline.predict(str(source)):
            result.save_to_json(save_path=args.output)
            result.save_to_markdown(save_path=args.output)
            result.save_to_img(save_path=args.output)
            page_count += 1
            print(f"Saved page {page_count}", flush=True)
    finally:
        finished.set()

    print(
        f"Processed {page_count} page(s) in {time.perf_counter() - processing_started:.1f}s "
        f"after initialization ({time.perf_counter() - started:.1f}s total)"
    )
    print(f"Results: {args.output.resolve()}")


if __name__ == "__main__":
    main()

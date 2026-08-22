#!/usr/bin/env python3

import sys

from paddleocr import PaddleOCR


if len(sys.argv) != 2:
    raise SystemExit(f"Usage: {sys.executable} {sys.argv[0]} <pdf-or-image>")

ocr = PaddleOCR(
    # Accuracy-first detector plus the Marathi-capable PP-OCRv5 recognizer.
    text_detection_model_name="PP-OCRv5_server_det",
    text_recognition_model_name="devanagari_PP-OCRv5_mobile_rec",
    use_doc_orientation_classify=True,
    use_doc_unwarping=True,
    use_textline_orientation=True,
    device="cpu",  # Change to "gpu:0" after installing paddlepaddle-gpu.
    enable_mkldnn=False,  # Avoid a Paddle 3.3 oneDNN inference failure on Windows.
)

for result in ocr.predict(sys.argv[1]):
    result.print()
    result.save_to_json("paddleocr-output")
    result.save_to_img("paddleocr-output")
